import http from 'http'
import fs from 'fs'
import path from 'path'
import { URL } from 'url'

import type { AxiomConfig } from '../config/index.js'
import { getStatus, listPages, readPage } from '../core/wiki.js'
import { searchWiki } from '../core/search.js'
import { buildGraph, getBacklinks } from '../core/graph.js'
import { openUrlInBrowser } from '../auth/command.js'
import {
  layout,
  renderDashboard,
  renderPageList,
  renderWikiPage,
  renderSearchResults,
  renderGraphPage,
  renderErrorPage,
} from './render.js'
import { handleApi, isSafeSegment, parseFrontmatter } from './api.js'
import { resolveWebDir, serveStatic } from './static.js'

export { parseFrontmatter } from './api.js'

export interface ServeOptions {
  config: AxiomConfig
  port?: number
  host?: string
  open?: boolean
  /** Suppress the startup log (used by tests). */
  quiet?: boolean
  /**
   * Directory with the built SPA. `false` disables the frontend and falls back
   * to the legacy server-rendered pages (used by the SSR integration tests).
   */
  staticDir?: string | false
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(html)
}

async function handlePage(config: AxiomConfig, url: URL, res: http.ServerResponse): Promise<void> {
  const segments = url.pathname.split('/').filter(Boolean).slice(1) // drop "page"
  if (segments.length < 2 || segments.some((s) => !isSafeSegment(s))) {
    sendHtml(res, 404, renderErrorPage('Not found', 'Unknown page address.'))
    return
  }
  const id = segments.join('/')
  const pagePath = path.join('wiki', 'pages', `${id}.md`)
  const abs = path.join(config.wikiDir, pagePath)
  if (!fs.existsSync(abs)) {
    sendHtml(res, 404, renderErrorPage('Page not found', `No wiki page at “${id}”.`))
    return
  }
  const raw = await readPage(config.wikiDir, pagePath)
  const { data, body } = parseFrontmatter(raw, segments[segments.length - 1])
  sendHtml(res, 200, renderWikiPage(id, data, body, getBacklinks(config.wikiDir, id)))
}

export function createHandler(config: AxiomConfig, webDir: string | null = null) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' })
        res.end('Method not allowed — the web UI is read-only.')
        return
      }

      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }

      if (await handleApi(config, url, req, res)) return

      // The built SPA owns every remaining route when it exists.
      if (webDir && serveStatic(webDir, url, req, res)) return

      // Legacy server-rendered fallback (used when `pnpm build:web` has not run).
      if (url.pathname === '/') {
        const [status, pages] = await Promise.all([
          getStatus(config),
          listPages(config.wikiDir),
        ])
        const recent = [...pages]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 10)
        sendHtml(res, 200, renderDashboard(status, recent))
        return
      }

      if (url.pathname === '/pages') {
        const pages = await listPages(config.wikiDir)
        sendHtml(res, 200, renderPageList(pages))
        return
      }

      if (url.pathname === '/search') {
        const q = (url.searchParams.get('q') ?? '').trim()
        if (!q) {
          sendHtml(res, 200, renderSearchResults('', []))
          return
        }
        const results = await searchWiki(config.wikiDir, q, { limit: 25, config })
        sendHtml(res, 200, renderSearchResults(q, results))
        return
      }

      if (url.pathname === '/graph') {
        const graph = buildGraph(config.wikiDir)
        sendHtml(res, 200, renderGraphPage(graph))
        return
      }

      if (url.pathname.startsWith('/page/')) {
        await handlePage(config, url, res)
        return
      }

      sendHtml(res, 404, renderErrorPage('Not found', `No route for “${url.pathname}”.`))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) {
        sendHtml(res, 500, renderErrorPage('Something went wrong', message))
      } else {
        res.end()
      }
    }
  }
}

export function startServer(options: ServeOptions): Promise<http.Server> {
  const { config, port = 1717, host = '127.0.0.1', open = false, quiet = false } = options

  const explicitWebDir = options.staticDir === false ? '' : options.staticDir
  const webDir = options.staticDir === false ? null : resolveWebDir(explicitWebDir)

  return new Promise((resolve) => {
    const handler = createHandler(config, webDir)
    const server = http.createServer((req, res) => {
      void handler(req, res)
    })

    server.listen(port, host, () => {
      const addr = server.address()
      const actualPort = typeof addr === 'object' && addr ? addr.port : port
      const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`
      if (!quiet) {
        const mode = webDir ? 'web UI' : 'read-only fallback UI'
        console.log(`Axiom Wiki ${mode} at ${url}  (Ctrl+C to stop)`)
      }
      if (open) openUrlInBrowser(url)
      resolve(server)
    })

    server.on('error', (err) => {
      console.error(`Failed to start server: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    })
  })
}
