import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type http from 'http'
import { URL } from 'url'

import type { AxiomConfig } from '../config/index.js'
import { getStatus, readPage } from '../core/wiki.js'
import { searchWiki } from '../core/search.js'
import { backlinksFromGraph, type WikiGraph } from '../core/graph.js'
import type { WikiSnapshot } from '../core/snapshot.js'
import { listSources } from '../core/sources.js'
import { loadState } from '../core/state.js'
import { getLockInfo } from '../core/lock.js'
import { checkEmbeddingConsistency, loadSearchManifest } from '../core/search/orama-store.js'
import { analyzeLinks, type PageLinkEntry } from '../core/links.js'
import { getPageDiff, getPageHistory } from '../core/history.js'
import { renderMarkdown } from './render.js'
import type { PageFrontmatter } from './render.js'
import { BadRequestError, actionRequiresWrite, handleAction, readJsonBody } from './actions.js'
import { jobs as defaultJobs, type JobManager } from './jobs.js'
import type { WatchController } from './watch.js'

/**
 * JSON API consumed by the web frontend in `apps/web`.
 *
 * Read routes are thin wrappers over the same core functions the CLI uses, so
 * the browser sees exactly what `axiom-wiki status|graph|query` sees. Mutations
 * live under `/actions/*`, require write mode, and delegate to `actions.ts`.
 * All paths are namespaced under `/api/v1`. Page bodies are read fresh from
 * disk; the page list and link graph come from the watched snapshot cache.
 */

const API_PREFIX = '/api/v1'
const SEGMENT_RE = /^[\w][\w.-]*$/

export function isSafeSegment(segment: string): boolean {
  return SEGMENT_RE.test(segment) && !segment.includes('..')
}

interface JsonHeaders {
  etag?: string
  lastModified?: string
  cacheControl?: string
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headOnly = false,
  options: JsonHeaders = {},
): void {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': options.cacheControl ?? 'no-store',
  }
  if (options.etag) headers['ETag'] = options.etag
  if (options.lastModified) headers['Last-Modified'] = options.lastModified
  res.writeHead(status, headers)
  res.end(headOnly ? undefined : JSON.stringify(body))
}

function fail(res: http.ServerResponse, status: number, message: string, headOnly = false): void {
  sendJson(res, status, { error: message }, headOnly)
}

/**
 * Weak validator derived from the file's mtime and size. The page body is read
 * immediately after stat, so a client that revalidates saves the read, YAML
 * parse, Markdown render, and graph lookup on every navigation it repeats.
 */
function statEtag(stat: fs.Stats): string {
  return `W/"${Math.trunc(stat.mtimeMs).toString(36)}-${stat.size.toString(36)}"`
}

function matchesEtag(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false
  const value = Array.isArray(header) ? header.join(',') : header
  return value.split(',').some((candidate) => {
    const trimmed = candidate.trim()
    return trimmed === '*' || trimmed === etag
  })
}

function sendNotModified(
  res: http.ServerResponse,
  etag: string,
  lastModified: string,
): void {
  res.writeHead(304, {
    ETag: etag,
    'Last-Modified': lastModified,
    'Cache-Control': 'no-cache',
  })
  res.end()
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
    body,
    html: renderMarkdown(body),
    backlinks: graph ? backlinksFromGraph(graph, id) : [],
  }
}

export interface ApiOptions {
  /** Enables POST/DELETE action routes. Off by default. */
  allowWrite?: boolean
  /** Wiki-change subscription used by the SSE endpoint. */
  subscribe?: (listener: () => void) => () => void
  jobs?: JobManager
  watch?: WatchController
  /** Shared corpus link index, cached by the read cache. */
  linkIndex?: () => Map<string, PageLinkEntry>
  /** Called after a successful write so cached derivations refresh at once. */
  onWrite?: () => void
}

function openSse(req: http.IncomingMessage, res: http.ServerResponse): {
  send: (event: string, data: unknown) => void
  close: () => void
} {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()

  let closed = false
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n')
  }, 20_000)
  heartbeat.unref?.()

  const close = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    res.end()
  }
  req.on('close', close)

  return {
    send(event, data) {
      if (closed) return
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      } catch {
        close()
      }
    },
    close,
  }
}

function checkWriteRequest(
  req: http.IncomingMessage,
  allowWrite: boolean,
): string | null {
  if (!allowWrite) {
    return 'Write mode is disabled. Restart with: axiom-wiki serve --allow-write'
  }
  if (req.headers['x-axiom-write'] !== '1') {
    return 'Missing X-Axiom-Write: 1 header.'
  }
  const origin = req.headers.origin
  if (origin) {
    try {
      const parsed = new URL(origin)
      if (!req.headers.host || parsed.host !== req.headers.host) {
        return 'Cross-origin writes are not allowed.'
      }
    } catch {
      return 'Cross-origin writes are not allowed.'
    }
  }
  return null
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
  options: ApiOptions = {},
): Promise<boolean> {
  const { pathname } = url
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return false

  const headOnly = req.method === 'HEAD'
  const method = req.method ?? 'GET'
  const jobManager = options.jobs ?? defaultJobs
  const isActionRoute = pathname.startsWith(`${API_PREFIX}/actions/`)
  const isJobRoute = pathname.startsWith(`${API_PREFIX}/jobs`)

  if (!['GET', 'HEAD', 'POST', 'DELETE'].includes(method)) {
    res.writeHead(405, { Allow: 'GET, HEAD, POST, DELETE', 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Method not allowed.' }))
    return true
  }

  if (method === 'POST' && !isActionRoute) {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'POST is only allowed under /api/v1/actions/.' }))
    return true
  }

  if (method === 'DELETE' && !(isJobRoute && pathname !== `${API_PREFIX}/jobs`)) {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'DELETE is only allowed for a job id.' }))
    return true
  }

  const actionName = isActionRoute
    ? pathname.slice(`${API_PREFIX}/actions/`.length)
    : ''
  const requiresWrite =
    method === 'DELETE' || (method === 'POST' && actionRequiresWrite(actionName))
  if (requiresWrite) {
    const problem = checkWriteRequest(req, Boolean(options.allowWrite))
    if (problem) {
      fail(res, 403, problem, headOnly)
      return true
    }
  }

  if (pathname !== API_PREFIX && !pathname.startsWith(`${API_PREFIX}/`)) {
    fail(res, 404, `Unknown API path “${pathname}”. Use /api/v1.`, headOnly)
    return true
  }

  const route = pathname.slice(API_PREFIX.length) || '/'

  try {
    if (route.startsWith('/actions/')) {
      const action = route.slice('/actions/'.length)
      const body = await readJsonBody(req)
      const result = await handleAction(action, body, {
        config,
        snapshot,
        jobs: jobManager,
        watch: options.watch,
        allowWrite: options.allowWrite,
        invalidate: options.onWrite,
        linkIndex: options.linkIndex,
      })
      sendJson(res, result.status, result.body, headOnly)
      return true
    }

    if (route === '/jobs') {
      // Jobs can contain query answers and ingest logs. A LAN-safe read-only
      // server should not expose its process-local work queue.
      sendJson(res, 200, { jobs: options.allowWrite ? jobManager.list() : [] }, headOnly)
      return true
    }

    if (route.startsWith('/jobs/')) {
      if (!options.allowWrite) {
        fail(res, 404, 'No such job.', headOnly)
        return true
      }
      const rest = route.slice('/jobs/'.length)
      const slash = rest.indexOf('/')
      const id = slash === -1 ? rest : rest.slice(0, slash)
      const suffix = slash === -1 ? '' : rest.slice(slash + 1)
      const job = id ? jobManager.get(id) : null
      if (!job) {
        fail(res, 404, 'No such job.', headOnly)
        return true
      }

      if (method === 'DELETE') {
        sendJson(res, 200, { job: jobManager.cancel(id) }, headOnly)
        return true
      }

      if (suffix === 'events') {
        const stream = openSse(req, res)
        let unsubscribe = () => {}
        unsubscribe = jobManager.subscribe(id, (event) => {
          if (event.type === 'snapshot' || event.type === 'status') {
            stream.send('job', event.job)
          } else if (event.type === 'log') {
            stream.send('log', { line: event.line })
          } else if (event.type === 'delta') {
            stream.send('delta', { text: event.text })
          } else if (event.type === 'done') {
            stream.send('done', event.job)
            unsubscribe()
            stream.close()
          }
        })
        req.on('close', () => unsubscribe())
        if (job.status !== 'running' && job.status !== 'queued') {
          unsubscribe()
          stream.close()
        }
        return true
      }

      if (suffix) {
        fail(res, 404, 'Unknown job route.', headOnly)
        return true
      }

      sendJson(res, 200, { job }, headOnly)
      return true
    }

    if (route === '/events') {
      const stream = openSse(req, res)
      stream.send('ready', { at: new Date().toISOString() })
      const unsubscribe = options.subscribe?.(() => {
        stream.send('wiki-changed', { at: new Date().toISOString() })
      })
      req.on('close', () => unsubscribe?.())
      return true
    }

    if (route === '/config') {
      sendJson(
        res,
        200,
        {
          provider: config.provider,
          model: config.model,
          wikiDir: path.basename(config.wikiDir),
          rawDir: path.basename(config.rawDir),
          obsidianCompat: Boolean(config.obsidianCompat),
          forensicCitations: Boolean(config.forensicCitations),
          writeMode: Boolean(options.allowWrite),
          embeddings: {
            provider: config.embeddings?.provider ?? 'none',
            model: config.embeddings?.model ?? null,
            dimensions: config.embeddings?.dimensions ?? null,
            manifest: loadSearchManifest(config.wikiDir),
            consistency: checkEmbeddingConsistency(config),
          },
        },
        headOnly,
      )
      return true
    }

    if (route === '/watch') {
      sendJson(
        res,
        200,
        options.watch?.status() ?? { running: false, startedAt: null, lastEvent: null },
        headOnly,
      )
      return true
    }

    if (route === '/sources') {
      const records = await listSources(config.wikiDir)
      const state = loadState(config.wikiDir)
      const rawFiles = fs.existsSync(config.rawDir)
        ? fs.readdirSync(config.rawDir).filter((name) => fs.statSync(path.join(config.rawDir, name)).isFile())
        : []
      sendJson(
        res,
        200,
        {
          sources: records.map((record) => ({
            ...record,
            sha256: state.sources[record.filename]?.sha256 ?? '',
            lastIngestedAt: state.sources[record.filename]?.lastIngestedAt ?? record.ingestedAt,
            truncated: state.sources[record.filename]?.truncated ?? false,
            concepts: state.sources[record.filename]?.concepts.length ?? 0,
          })),
          rawFiles,
          lock: getLockInfo(config.wikiDir),
        },
        headOnly,
      )
      return true
    }

    if (route === '/integrity') {
      const snap = await snapshot()
      const pagesWithoutSummary = snap.pages.filter((page) => !page.summary).map((page) => page.path)
      const pagesWithoutTags = snap.pages.filter((page) => page.tags.length === 0).map((page) => page.path)
      const contradictions: Array<{ path: string; title: string }> = []
      for (const page of snap.pages) {
        try {
          const content = await readPage(config.wikiDir, page.path)
          if (content.includes('⚠️ Contradiction:')) {
            contradictions.push({ path: page.path, title: page.title })
          }
        } catch {
          // vanished mid-scan
        }
      }
      sendJson(
        res,
        200,
        {
          generatedAt: new Date().toISOString(),
          counts: {
            pages: snap.pages.length,
            deadLinks: snap.graph.deadLinks.length,
            orphans: snap.graph.orphans.length,
            pagesWithoutSummary: pagesWithoutSummary.length,
            pagesWithoutTags: pagesWithoutTags.length,
            contradictions: contradictions.length,
          },
          deadLinks: snap.graph.deadLinks,
          orphans: snap.graph.orphans,
          pagesWithoutSummary,
          pagesWithoutTags,
          contradictions,
        },
        headOnly,
      )
      return true
    }

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
      const tagFilter = url.searchParams.get('tag')?.trim().toLowerCase() ?? ''
      const needle = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      const sort = url.searchParams.get('sort') ?? 'category'

      const facets: Record<string, number> = {}
      const tagFacets: Record<string, number> = {}
      for (const page of snap.pages) {
        facets[page.category] = (facets[page.category] ?? 0) + 1
        for (const tag of page.tags) {
          tagFacets[tag] = (tagFacets[tag] ?? 0) + 1
        }
      }

      const filtered = snap.pages.filter((page) => {
        if (category && page.category !== category) return false
        if (tagFilter && !page.tags.some((tag) => tag.toLowerCase() === tagFilter)) return false
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
          facets: {
            categories: facets,
            tags: Object.fromEntries(
              Object.entries(tagFacets).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
            ),
          },
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

    const pageSubroute = /^\/pages\/(.+)\/(links|history|diff)$/.exec(route)
    if (pageSubroute) {
      const segments = pageSubroute[1].split('/').filter(Boolean)
      if (segments.length < 2 || segments.some((segment) => !isSafeSegment(segment))) {
        fail(res, 404, 'Unknown page address.', headOnly)
        return true
      }
      const id = segments.join('/')
      const view = pageSubroute[2]
      const abs = path.join(config.wikiDir, 'wiki', 'pages', `${id}.md`)

      if (!fs.existsSync(abs)) {
        fail(res, 404, `No wiki page at “${id}”.`, headOnly)
        return true
      }

      if (view === 'links') {
        const intelligence = analyzeLinks(config.wikiDir, id, options.linkIndex?.())
        if (!intelligence) {
          fail(res, 404, `No wiki page at “${id}”.`, headOnly)
          return true
        }
        sendJson(res, 200, intelligence, headOnly, { cacheControl: 'no-cache' })
        return true
      }

      if (view === 'history') {
        const limitParam = Number(url.searchParams.get('limit') ?? 40)
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 40
        sendJson(res, 200, getPageHistory(config.wikiDir, id, limit), headOnly, {
          cacheControl: 'no-cache',
        })
        return true
      }

      const rev = url.searchParams.get('rev') ?? ''
      const diff = getPageDiff(config.wikiDir, id, rev)
      if (!diff) {
        fail(res, 400, 'A valid “rev” commit hash is required.', headOnly)
        return true
      }
      sendJson(res, 200, diff, headOnly, { cacheControl: 'no-cache' })
      return true
    }

    if (route.startsWith('/pages/')) {
      const segments = route.slice('/pages/'.length).split('/').filter(Boolean)
      if (segments.length < 2 || segments.some((s) => !isSafeSegment(s))) {
        fail(res, 404, 'Unknown page address.', headOnly)
        return true
      }
      const id = segments.join('/')
      const abs = path.join(config.wikiDir, 'wiki', 'pages', `${id}.md`)

      let stat: fs.Stats
      try {
        stat = fs.statSync(abs)
      } catch {
        fail(res, 404, `No wiki page at “${id}”.`, headOnly)
        return true
      }

      const etag = statEtag(stat)
      const lastModified = stat.mtime.toUTCString()
      if (matchesEtag(req.headers['if-none-match'], etag)) {
        sendNotModified(res, etag, lastModified)
        return true
      }

      const { graph } = await snapshot()
      const payload = await readPagePayload(config, id, graph)
      if (!payload) {
        fail(res, 404, `No wiki page at “${id}”.`, headOnly)
        return true
      }
      sendJson(res, 200, payload, headOnly, {
        etag,
        lastModified,
        // Storeable, but every reuse must revalidate — a page body can change
        // while the SPA is open.
        cacheControl: 'no-cache',
      })
      return true
    }

    fail(res, 404, `No API route for “${pathname}”.`, headOnly)
    return true
  } catch (err) {
    if (err instanceof BadRequestError) {
      fail(res, 400, err.message, headOnly)
      return true
    }
    fail(res, 500, err instanceof Error ? err.message : String(err), headOnly)
    return true
  }
}
