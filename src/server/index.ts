import http from 'http'
import fs from 'fs'
import path from 'path'
import { URL } from 'url'
import matter from 'gray-matter'

import type { AxiomConfig } from '../config/index.js'
import { getStatus, listPages, readPage } from '../core/wiki.js'
import { searchWiki } from '../core/search.js'
import { buildGraph } from '../core/graph.js'
import { openUrlInBrowser } from '../auth/command.js'
import {
  layout,
  renderDashboard,
  renderPageList,
  renderWikiPage,
  renderSearchResults,
  renderGraphPage,
  renderErrorPage,
  type PageFrontmatter,
} from './render.js'

export interface ServeOptions {
  config: AxiomConfig
  port?: number
  host?: string
  open?: boolean
  /** Suppress the startup log (used by tests). */
  quiet?: boolean
}

const SEGMENT_RE = /^[\w][\w.-]*$/

function isSafeSegment(segment: string): boolean {
  return SEGMENT_RE.test(segment) && !segment.includes('..')
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(html)
}

/** Parses frontmatter into the header fields the page view needs. */
export function parseFrontmatter(raw: string, fallbackTitle: string): { data: PageFrontmatter; body: string } {
  const parsed = matter(raw)
  const d = parsed.data as Record<string, unknown>
  return {
    data: {
      title: String(d['title'] ?? fallbackTitle),
      summary: String(d['summary'] ?? ''),
      tags: Array.isArray(d['tags']) ? d['tags'].map(String) : [],
      category: String(d['category'] ?? ''),
      updatedAt: String(d['updatedAt'] ?? ''),
      sources: Array.isArray(d['sources']) ? d['sources'].map(String) : [],
    },
    body: parsed.content,
  }
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
  sendHtml(res, 200, renderWikiPage(id, data, body))
}

export function createHandler(config: AxiomConfig) {
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

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      void createHandler(config)(req, res)
    })

    server.listen(port, host, () => {
      const addr = server.address()
      const actualPort = typeof addr === 'object' && addr ? addr.port : port
      const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`
      if (!quiet) {
        console.log(`Axiom Wiki served read-only at ${url}  (Ctrl+C to stop)`)
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
