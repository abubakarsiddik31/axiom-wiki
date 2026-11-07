import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type http from 'http'
import type { URL } from 'url'

import type { AxiomConfig } from '../config/index.js'
import { getStatus, readPage } from '../core/wiki.js'
import { searchWiki } from '../core/search.js'
import { backlinksFromGraph, type WikiGraph } from '../core/graph.js'
import type { WikiSnapshot } from '../core/snapshot.js'
import { renderMarkdown } from './render.js'
import type { PageFrontmatter } from './render.js'

/**
 * Read-only JSON API consumed by the web frontend in `apps/web`.
 *
 * Every route is a thin wrapper over the same core functions the CLI uses, so
 * the browser sees exactly what `axiom-wiki status|graph|query` sees. All paths
 * are namespaced under `/api/v1`. Page bodies are read fresh from disk; the
 * page list and link graph come from the server's watched snapshot cache.
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

async function readPagePayload(config: AxiomConfig, id: string, graph?: WikiGraph) {
  const pagePath = path.join('wiki', 'pages', `${id}.md`)
  const abs = path.join(config.wikiDir, pagePath)
  if (!fs.existsSync(abs)) return null

  const raw = await readPage(config.wikiDir, pagePath)
  const { data, body } = parseFrontmatter(raw, id.split('/').pop() ?? id)
  return {
    id,
    frontmatter: data,
    html: renderMarkdown(body),
    backlinks: graph ? backlinksFromGraph(graph, id) : [],
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
  snapshot: () => Promise<WikiSnapshot>,
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
      const snap = await snapshot()
      const status = await getStatus(config, snap.pages, snap.wikiSizeBytes)
      const recent = [...snap.pages]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 10)
      sendJson(res, 200, { status, recent }, headOnly)
      return true
    }

    if (route === '/pages') {
      const snap = await snapshot()
      const limitParam = Number(url.searchParams.get('limit') ?? 100)
      const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 500) : 100
      const cursorParam = Number(url.searchParams.get('cursor') ?? 0)
      const offset = Number.isFinite(cursorParam) ? Math.max(0, Math.trunc(cursorParam)) : 0
      const category = url.searchParams.get('cat')?.trim() ?? ''
      const needle = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      const sort = url.searchParams.get('sort') ?? 'category'

      const facets: Record<string, number> = {}
      for (const page of snap.pages) {
        facets[page.category] = (facets[page.category] ?? 0) + 1
      }

      const filtered = snap.pages.filter((page) => {
        if (category && page.category !== category) return false
        if (!needle) return true
        return (
          page.title.toLowerCase().includes(needle) ||
          page.summary.toLowerCase().includes(needle) ||
          page.tags.some((tag) => tag.toLowerCase().includes(needle))
        )
      })

      filtered.sort((a, b) => {
        if (sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt)
        if (sort === 'title') return a.title.localeCompare(b.title)
        return a.category.localeCompare(b.category) || a.title.localeCompare(b.title)
      })

      const page = filtered.slice(offset, offset + limit)
      const next = offset + limit < filtered.length ? String(offset + limit) : null

      sendJson(
        res,
        200,
        {
          pages: page,
          total: filtered.length,
          nextCursor: next,
          facets: { categories: facets },
        },
        headOnly,
      )
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
      const { graph, rankedIds } = await snapshot()

      const limitParam = Number(url.searchParams.get('limit') ?? 2000)
      const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 10000) : 2000
      const focus = url.searchParams.get('focus') ?? ''
      const depthParam = Number(url.searchParams.get('depth') ?? 1)
      const depth = Number.isFinite(depthParam) ? Math.min(Math.max(Math.trunc(depthParam), 1), 3) : 1

      const existingCount = rankedIds.length
      let selected: Set<string>

      if (focus && graph.nodes.get(focus)?.exists) {
        const adjacency = new Map<string, Set<string>>()
        const link = (from: string, to: string) => {
          const set = adjacency.get(from) ?? new Set<string>()
          set.add(to)
          adjacency.set(from, set)
        }
        for (const edge of graph.edges) {
          link(edge.from, edge.to)
          link(edge.to, edge.from)
        }
        const seen = new Set<string>([focus])
        const queue: Array<{ id: string; level: number }> = [{ id: focus, level: 0 }]
        while (queue.length && seen.size < limit) {
          const current = queue.shift()!
          if (current.level >= depth) continue
          for (const next of adjacency.get(current.id) ?? []) {
            if (seen.size >= limit) break
            if (seen.has(next)) continue
            seen.add(next)
            queue.push({ id: next, level: current.level + 1 })
          }
        }
        selected = seen
      } else {
        // Seed with highly-connected pages, then grow along real edges so the
        // overview keeps its structure instead of collapsing into loose dots.
        const seedCount = Math.min(existingCount, Math.max(1, Math.ceil(limit * 0.6)))
        selected = new Set(rankedIds.slice(0, seedCount))
        for (const edge of graph.edges) {
          if (selected.size >= limit) break
          if (selected.has(edge.from)) selected.add(edge.to)
          else if (selected.has(edge.to)) selected.add(edge.from)
        }
        if (selected.size < limit) {
          for (const id of rankedIds) {
            if (selected.size >= limit) break
            selected.add(id)
          }
        }
      }

      const nodes = [...selected]
        .map((id) => graph.nodes.get(id))
        .filter((node): node is NonNullable<typeof node> => Boolean(node))
      const edges = graph.edges.filter(
        (edge) => selected.has(edge.from) && selected.has(edge.to),
      )
      const orphans = graph.orphans.filter((id) => selected.has(id)).slice(0, 500)
      const deadLinks = graph.deadLinks
        .filter((link) => selected.has(link.from))
        .slice(0, 200)
      const selectedExisting = rankedIds.reduce(
        (count, id) => count + (selected.has(id) ? 1 : 0),
        0,
      )

      sendJson(
        res,
        200,
        {
          nodes,
          edges,
          orphans,
          deadLinks,
          totalNodes: existingCount,
          totalEdges: graph.edges.length,
          orphanCount: graph.orphans.length,
          deadLinkCount: graph.deadLinks.length,
          truncated: selectedExisting < existingCount,
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
      const { graph } = await snapshot()
      const payload = await readPagePayload(config, segments.join('/'), graph)
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
