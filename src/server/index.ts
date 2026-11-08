import http from 'http'
import fs from 'fs'
import path from 'path'
import { URL } from 'url'

import type { AxiomConfig } from '../config/index.js'
import { getStatus, readPage } from '../core/wiki.js'
import { searchWiki } from '../core/search.js'
import { backlinksFromGraph, type WikiGraph } from '../core/graph.js'
import { buildWikiSnapshot, type WikiSnapshot } from '../core/snapshot.js'
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
import { WikiReadCache } from './cache.js'
import { JobManager } from './jobs.js'
import { WatchController } from './watch.js'

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
  /** Enable POST/DELETE action routes. Read-only when false (the default). */
  allowWrite?: boolean
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(html)
}

async function handlePage(
  config: AxiomConfig,
  url: URL,
  res: http.ServerResponse,
  graph: WikiGraph,
): Promise<void> {
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
  sendHtml(res, 200, renderWikiPage(id, data, body, backlinksFromGraph(graph, id)))
}

export function createHandler(
  config: AxiomConfig,
  webDir: string | null = null,
  cache?: WikiReadCache,
  options: { allowWrite?: boolean; jobs?: JobManager; watch?: WatchController } = {},
) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    // One snapshot per request, shared by every route that needs pages/graph.
    let snapshotPromise: Promise<WikiSnapshot> | null = null
    const snapshot = () =>
      (snapshotPromise ??= cache
        ? cache.get()
        : Promise.resolve(buildWikiSnapshot(config.wikiDir)))

    try {
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }

      // API routes own their own method checks (actions + SSE); everything
      // below is a read-only HTML surface.
      if (await handleApi(config, url, req, res, snapshot, {
        allowWrite: options.allowWrite,
        subscribe: cache ? (listener) => cache.onChange(listener) : undefined,
        linkIndex: cache ? () => cache.getLinkIndex() : undefined,
        onWrite: cache ? () => cache.refresh() : undefined,
        jobs: options.jobs,
        watch: options.watch,
      })) return

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' })
        res.end('Method not allowed — the web UI is read-only.')
        return
      }

      // The built SPA owns every remaining route when it exists.
      if (webDir && serveStatic(webDir, url, req, res)) return

      // Legacy server-rendered fallback (used when `pnpm build:web` has not run).
      if (url.pathname === '/') {
        const snap = await snapshot()
        const status = await getStatus(config, snap.pages, snap.wikiSizeBytes)
        const recent = [...snap.pages]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 10)
        sendHtml(res, 200, renderDashboard(status, recent))
        return
      }

      if (url.pathname === '/pages') {
        const snap = await snapshot()
        sendHtml(res, 200, renderPageList(snap.pages))
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
        const snap = await snapshot()
        sendHtml(res, 200, renderGraphPage(snap.graph))
        return
      }

      if (url.pathname.startsWith('/page/')) {
        const snap = await snapshot()
        await handlePage(config, url, res, snap.graph)
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
  const { config, port = 1717, host = '127.0.0.1', open = false, quiet = false, allowWrite = false } = options

  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
  if (allowWrite && !loopback) {
    return Promise.reject(
      new Error('--allow-write only works with a loopback --host (127.0.0.1, localhost, or ::1).'),
    )
  }

  const explicitWebDir = options.staticDir === false ? '' : options.staticDir
  const webDir = options.staticDir === false ? null : resolveWebDir(explicitWebDir)
  const cache = new WikiReadCache(config.wikiDir)
  cache.start()
  const jobManager = new JobManager()
  const watch = new WatchController(config, jobManager)

  return new Promise((resolve) => {
    const handler = createHandler(config, webDir, cache, { allowWrite, jobs: jobManager, watch })
    const server = http.createServer((req, res) => {
      void handler(req, res)
    })

    server.on('close', () => {
      void watch.stop()
      void cache.close()
    })

    server.listen(port, host, () => {
      const addr = server.address()
      const actualPort = typeof addr === 'object' && addr ? addr.port : port
      const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`
      if (!quiet) {
        const mode = webDir ? 'web UI' : 'read-only fallback UI'
        const write = allowWrite ? ' · write enabled' : ' · read-only'
        console.log(`Axiom Wiki ${mode} at ${url}${write}  (Ctrl+C to stop)`)
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
