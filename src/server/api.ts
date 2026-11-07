import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type http from 'http'
import type { URL } from 'url'

import type { AxiomConfig } from '../config/index.js'
import { getStatus, listPages, readPage } from '../core/wiki.js'
import { searchWiki } from '../core/search.js'
import { buildGraph, getBacklinks } from '../core/graph.js'
import { renderMarkdown } from './render.js'
import type { PageFrontmatter } from './render.js'

/**
 * Read-only JSON API consumed by the web frontend in `apps/web`.
 *
 * Every route is a thin wrapper over the same core functions the CLI uses, so
 * the browser sees exactly what `axiom-wiki status|graph|query` sees. All paths
 * are namespaced under `/api/v1` and read fresh from disk on every request.
 */

const API_PREFIX = '/api/v1'
const SEGMENT_RE = /^[\w][\w.-]*$/

export function isSafeSegment(segment: string): boolean {
  return SEGMENT_RE.test(segment) && !segment.includes('..')
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headOnly = false,
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(headOnly ? undefined : JSON.stringify(body))
}

function fail(res: http.ServerResponse, status: number, message: string, headOnly = false): void {
  sendJson(res, status, { error: message }, headOnly)
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

async function readPagePayload(config: AxiomConfig, id: string) {
  const pagePath = path.join('wiki', 'pages', `${id}.md`)
  const abs = path.join(config.wikiDir, pagePath)
  if (!fs.existsSync(abs)) return null

  const raw = await readPage(config.wikiDir, pagePath)
  const { data, body } = parseFrontmatter(raw, id.split('/').pop() ?? id)
  return {
    id,
    frontmatter: data,
    html: renderMarkdown(body),
    backlinks: getBacklinks(config.wikiDir, id),
  }
}

/**
 * Handles a request if it targets the JSON API.
 * Returns true when the response was written, false otherwise.
 */
export async function handleApi(
  config: AxiomConfig,
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const { pathname } = url
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return false

  const headOnly = req.method === 'HEAD'

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Method not allowed — the API is read-only.' }))
    return true
  }

  if (pathname !== API_PREFIX && !pathname.startsWith(`${API_PREFIX}/`)) {
    fail(res, 404, `Unknown API path “${pathname}”. Use /api/v1.`, headOnly)
    return true
  }

  const route = pathname.slice(API_PREFIX.length) || '/'

  try {
    if (route === '/overview') {
      const [status, pages] = await Promise.all([getStatus(config), listPages(config.wikiDir)])
      const recent = [...pages]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 10)
      sendJson(res, 200, { status, recent }, headOnly)
      return true
    }

    if (route === '/pages') {
      const pages = await listPages(config.wikiDir)
      sendJson(res, 200, { pages }, headOnly)
      return true
    }

    if (route === '/search') {
      const q = (url.searchParams.get('q') ?? '').trim()
      const limitParam = Number(url.searchParams.get('limit') ?? 25)
      const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 25
      const category = url.searchParams.get('category') ?? undefined
      if (!q) {
        sendJson(res, 200, { query: '', results: [] }, headOnly)
        return true
      }
      const results = await searchWiki(config.wikiDir, q, { limit, category, config })
      sendJson(res, 200, { query: q, results }, headOnly)
      return true
    }

    if (route === '/graph') {
      const graph = buildGraph(config.wikiDir)
      sendJson(
        res,
        200,
        {
          nodes: [...graph.nodes.values()],
          edges: graph.edges,
          orphans: graph.orphans,
          deadLinks: graph.deadLinks,
        },
        headOnly,
      )
      return true
    }

    if (route.startsWith('/pages/')) {
      const segments = route.slice('/pages/'.length).split('/').filter(Boolean)
      if (segments.length < 2 || segments.some((s) => !isSafeSegment(s))) {
        fail(res, 404, 'Unknown page address.', headOnly)
        return true
      }
      const payload = await readPagePayload(config, segments.join('/'))
      if (!payload) {
        fail(res, 404, `No wiki page at “${segments.join('/')}”.`, headOnly)
        return true
      }
      sendJson(res, 200, payload, headOnly)
      return true
    }

    fail(res, 404, `No API route for “${pathname}”.`, headOnly)
    return true
  } catch (err) {
    fail(res, 500, err instanceof Error ? err.message : String(err), headOnly)
    return true
  }
}
