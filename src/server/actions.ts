import fs from 'fs'
import path from 'path'
import type http from 'http'
import matter from 'gray-matter'

import type { AxiomConfig } from '../config/index.js'
import { createAxiomAgent } from '../agent/index.js'
import { clipUrl } from '../core/clip.js'
import { ingest, type IngestRequest } from '../core/ingest.js'
import { indexWikiPage, persistOrama, reindexWiki } from '../core/indexing.js'
import { deletePageChunks } from '../core/search/orama-store.js'
import { markForReingest, removeSource } from '../core/sources.js'
import { loadState, saveState } from '../core/state.js'
import { acquireLock, getLockInfo, releaseLock } from '../core/lock.js'
import { listPages, readPage, updateIndex, updateMOC, writePage, appendLog } from '../core/wiki.js'
import { verifyCitations } from '../core/citations.js'
import { withRetry } from '../core/retry.js'
import type { WikiSnapshot } from '../core/snapshot.js'
import { slugifyHeading } from '../core/slug.js'
import {
  buildLinkIndex,
  linkFirstMentionInBody,
} from '../core/links.js'
import { getPageVersionAt } from '../core/history.js'
import {
  PageOpError,
  deletePage,
  isValidPageId,
  mergePages,
  pagePathForId,
  renamePage,
  savePage,
} from '../core/page-ops.js'
import { commitPaths } from '../core/git.js'
import type { JobManager } from './jobs.js'
import type { WatchController } from './watch.js'
import { renderMarkdown } from './render.js'

export interface ActionDeps {
  config: AxiomConfig
  snapshot: () => Promise<WikiSnapshot>
  jobs: JobManager
  watch?: WatchController
  allowWrite?: boolean
  /** Refresh server-side caches after a successful write. */
  invalidate?: () => void
}

export interface ActionResult {
  status: number
  body: unknown
}

/**
 * Actions that change files must be gated behind write mode. Read-only checks
 * (integrity, citation audit) stay available on a LAN-exposed read-only server.
 */
const WRITE_ACTIONS = new Set([
  'ingest',
  'clip',
  'query',
  'sources/delete',
  'sources/reingest',
  'embeddings/reindex',
  'analysis/save',
  'contradiction/resolve',
  'watch/start',
  'watch/stop',
  'page/save',
  'page/rename',
  'page/merge',
  'page/delete',
  'page/restore',
  'link/insert',
])

export function actionRequiresWrite(action: string): boolean {
  return WRITE_ACTIONS.has(action)
}

const MAX_BODY_BYTES = 1_000_000

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadRequestError'
  }
}

export async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new BadRequestError('Request body is too large.')
    chunks.push(buf)
  }
  if (size === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  } catch {
    throw new BadRequestError('Request body must be valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestError('Request body must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new BadRequestError(`“${key}” must be a string.`)
  return value.trim()
}

function boolField(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new BadRequestError(`“${key}” must be a boolean.`)
  return value
}

function stringArrayField(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new BadRequestError(`“${key}” must be an array of strings.`)
  }
  return (value as string[]).map((entry) => entry.trim()).filter(Boolean)
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function assertUrl(value: string): string {
  if (!isUrl(value)) throw new BadRequestError('“url” must be an http(s) URL.')
  try {
    new URL(value)
  } catch {
    throw new BadRequestError('“url” is not a valid URL.')
  }
  return value
}

/**
 * Web writes stay inside `raw/`. The CLI can ingest any path, but a browser
 * request must not be able to point the LLM at arbitrary local files.
 */
function resolveRawPath(config: AxiomConfig, value: string): string {
  const rawRoot = path.resolve(config.rawDir)
  const candidate = path.isAbsolute(value) ? path.resolve(value) : path.resolve(rawRoot, value)
  if (candidate !== rawRoot && !candidate.startsWith(rawRoot + path.sep)) {
    throw new BadRequestError('Files must live inside the raw/ directory.')
  }
  if (!fs.existsSync(candidate)) throw new BadRequestError(`File not found: ${path.basename(candidate)}`)
  if (!fs.statSync(candidate).isFile()) throw new BadRequestError('Path is not a file.')
  return path.basename(candidate)
}

function assertFilename(value: string | undefined): string {
  if (!value) throw new BadRequestError('“filename” is required.')
  if (value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new BadRequestError('“filename” must be a bare file name.')
  }
  return value
}

function lockBusy(config?: AxiomConfig): ActionResult {
  const { info } = config ? getLockInfo(config.wikiDir) : { info: null }
  return {
    status: 409,
    body: {
      error: info
        ? `Another operation is running (pid ${info.pid} since ${info.acquiredAt}).`
        : 'Another operation is running. Try again when it finishes.',
      holder: info,
    },
  }
}

function requireLock(config: AxiomConfig): ActionResult | null {
  const { locked, info } = getLockInfo(config.wikiDir)
  if (!locked) return null
  return {
    status: 409,
    body: {
      error: info
        ? `Another operation is running (pid ${info.pid} since ${info.acquiredAt}).`
        : 'Another operation is running.',
    },
  }
}

function analysisSlug(title: string): string {
  const slug = slugifyHeading(title)
  return slug || `analysis-${Date.now()}`
}

/**
 * Keeps the generated artifacts in step after a page write: rebuild index/MOC,
 * refresh the semantic index for changed pages, and drop deleted ones.
 */
async function syncPages(
  config: AxiomConfig,
  options: { index?: string[]; removed?: string[] },
  onWrite?: () => void,
): Promise<void> {
  await updateIndex(config.wikiDir)
  await updateMOC(config.wikiDir)
  onWrite?.()

  if (!config.embeddings || config.embeddings.provider === 'none') return

  for (const id of options.index ?? []) {
    try {
      await indexWikiPage(config, pagePathForId(id))
    } catch {
      // Indexing is best effort; the page stays readable without a vector.
    }
  }
  for (const id of options.removed ?? []) {
    try {
      await deletePageChunks(config, pagePathForId(id))
    } catch {
      // Semantic index is optional.
    }
  }
  try {
    await persistOrama(config)
  } catch {
    // Persisting is best effort; the next reindex will catch up.
  }
}

/** Converts a core page error into an HTTP result, leaving other errors loud. */
async function pageOp(run: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof PageOpError) {
      return { status: err.status, body: { error: err.message } }
    }
    throw err
  }
}

function assertPageId(value: string | undefined, label = 'id'): string {
  if (!value) throw new BadRequestError(`“${label}” is required.`)
  if (!isValidPageId(value)) {
    throw new BadRequestError(`“${label}” must look like “category/slug”.`)
  }
  return value
}

async function findContradictions(
  config: AxiomConfig,
): Promise<Array<{ path: string; title: string }>> {
  const pages = await listPages(config.wikiDir)
  const found: Array<{ path: string; title: string }> = []
  for (const page of pages) {
    try {
      const content = await readPage(config.wikiDir, page.path)
      if (content.includes('⚠️ Contradiction:')) {
        found.push({ path: page.path, title: page.title })
      }
    } catch {
      // A page that vanished mid-scan is not a contradiction.
    }
  }
  return found
}

/**
 * Handles a single `POST /api/v1/actions/:action` request. Long-running work is
 * queued and returns `202 { job }`; fast, deterministic work returns `200`.
 */
export async function handleAction(
  action: string,
  body: Record<string, unknown>,
  deps: ActionDeps,
): Promise<ActionResult> {
  const { config, jobs: manager } = deps

  if (action === 'ingest') {
    const file = stringField(body, 'file')
    const all = boolField(body, 'all') ?? false
    if (!file && !all) throw new BadRequestError('Provide “file”, “url”, or set “all” to true.')

    const request: IngestRequest = {
      all,
      reingest: boolField(body, 'reingest'),
      lang: stringField(body, 'lang'),
      context: stringField(body, 'context'),
    }
    if (file) request.file = isUrl(file) ? assertUrl(file) : resolveRawPath(config, file)

    const busy = requireLock(config)
    if (busy) return busy

    const job = manager.create('ingest')
    manager.start(job.id, ({ log, signal }) =>
      ingest(config, request, { onStatus: log, signal }),
    )
    return { status: 202, body: { job } }
  }

  if (action === 'clip') {
    const url = assertUrl(stringField(body, 'url') ?? '')
    const lang = stringField(body, 'lang')
    const shouldIngest = boolField(body, 'ingest') ?? true
    const busy = shouldIngest ? requireLock(config) : null
    if (busy) return busy

    const job = manager.create('clip')
    manager.start(job.id, async ({ log, signal }) => {
      log(`Clipping ${url}…`)
      const clipped = await clipUrl(url, config.rawDir, { lang, onStatus: log })
      log(`${clipped.reused ? 'Already saved' : 'Saved'}: ${clipped.filename}`)
      if (!shouldIngest) return { clip: clipped }
      const result = await ingest(config, { file: clipped.filename }, { onStatus: log, signal })
      return { clip: clipped, ingest: result }
    })
    return { status: 202, body: { job } }
  }

  if (action === 'query') {
    const question = stringField(body, 'question')
    if (!question) throw new BadRequestError('“question” is required.')
    const forensic = boolField(body, 'forensic') ?? false
    const save = boolField(body, 'save') ?? false
    const title = stringField(body, 'title') || question

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = []
    const rawHistory = body['history']
    if (rawHistory !== undefined) {
      if (!Array.isArray(rawHistory)) throw new BadRequestError('“history” must be an array.')
      for (const entry of rawHistory.slice(-20)) {
        if (!entry || typeof entry !== 'object') continue
        const pair = entry as Record<string, unknown>
        const q = typeof pair['question'] === 'string' ? pair['question'] : ''
        const a = typeof pair['answer'] === 'string' ? pair['answer'] : ''
        if (q) history.push({ role: 'user', content: q })
        if (a) history.push({ role: 'assistant', content: a })
      }
    }
    history.push({ role: 'user', content: question })

    const job = manager.create('query')
    manager.start(job.id, async ({ delta, log, signal }) => {
      const agent = createAxiomAgent(config, { forensic })
      const stream = await withRetry(() => agent.stream(history))
      let answer = ''
      for await (const chunk of stream.textStream) {
        if (signal.aborted) break
        answer += chunk
        delta(chunk)
      }
      if (!signal.aborted) await appendLog(config.wikiDir, question, 'query')

      let filed: string | null = null
      if (save && answer.trim()) {
        if (!acquireLock(config.wikiDir)) {
          log('Wiki is busy — answer was not filed.')
        } else {
          try {
            const today = new Date().toISOString().slice(0, 10)
            const slug = analysisSlug(title)
            filed = `wiki/pages/analyses/${slug}.md`
            await writePage(
              config.wikiDir,
              filed,
              `---\ntitle: ${JSON.stringify(title)}\nsummary: ${JSON.stringify(`Analysis: ${question.slice(0, 80)}`)}\ntags: [analysis]\ncategory: analyses\nupdatedAt: "${today}"\n---\n\n## Question\n\n${question}\n\n## Answer\n\n${answer}\n`,
            )
            await updateIndex(config.wikiDir)
            await updateMOC(config.wikiDir)
            deps.invalidate?.()
          } finally {
            releaseLock(config.wikiDir)
          }
        }
      }
      return { answer, filed, forensic }
    })
    return { status: 202, body: { job } }
  }

  if (action === 'lint') {
    const mode = stringField(body, 'mode') ?? 'integrity'

    if (mode === 'integrity') {
      const snap = await deps.snapshot()
      const pagesWithoutSummary = snap.pages.filter((page) => !page.summary).map((page) => page.path)
      const pagesWithoutTags = snap.pages.filter((page) => page.tags.length === 0).map((page) => page.path)
      const contradictions = await findContradictions(config)
      return {
        status: 200,
        body: {
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
      }
    }

    if (mode === 'citations') {
      const report = await verifyCitations(config.wikiDir, {
        strict: boolField(body, 'strict') ?? false,
        requireLocators: boolField(body, 'strict') ?? false,
      })
      return { status: 200, body: report }
    }

    if (mode === 'agent') {
      if (!deps.allowWrite) {
        return { status: 403, body: { error: 'Agent lint requires --allow-write.' } }
      }
      const job = manager.create('lint')
      manager.start(job.id, async ({ delta, signal }) => {
        const agent = createAxiomAgent(config)
        const stream = await withRetry(() =>
          agent.stream([{
            role: 'user',
            content: 'Run a full lint check on the wiki. Report all issues found including citation verification.',
          }]),
        )
        let text = ''
        for await (const chunk of stream.textStream) {
          if (signal.aborted) break
          text += chunk
          delta(chunk)
        }
        if (!signal.aborted) await appendLog(config.wikiDir, 'agent lint', 'lint')
        return { text }
      })
      return { status: 202, body: { job } }
    }

    throw new BadRequestError('“mode” must be integrity, citations, or agent.')
  }

  if (action === 'sources/delete') {
    const filename = assertFilename(stringField(body, 'filename'))
    if (!acquireLock(config.wikiDir)) return lockBusy(config)
    try {
      const state = loadState(config.wikiDir)
      let removedPage: string
      let frozenSlugs: string[]
      try {
        const removal = await removeSource(config.wikiDir, filename, state)
        removedPage = removal.removedPage
        frozenSlugs = removal.frozenSlugs
      } catch (err) {
        return {
          status: 404,
          body: { error: err instanceof Error ? err.message : String(err) },
        }
      }
      delete state.sources[filename]
      saveState(config.wikiDir, state)

      // Keep derived artifacts in sync; the CLI table historically skipped this,
      // which left deleted pages in index.md/MOC and in the vector index.
      await updateIndex(config.wikiDir)
      await updateMOC(config.wikiDir)
      try {
        if (removedPage) await deletePageChunks(config, removedPage)
      } catch {
        // Semantic index is optional.
      }
      deps.invalidate?.()

      return {
        status: 200,
        body: { removedPage, frozenSlugs, filename },
      }
    } finally {
      releaseLock(config.wikiDir)
    }
  }

  if (action === 'sources/reingest') {
    const filename = assertFilename(stringField(body, 'filename'))
    if (!acquireLock(config.wikiDir)) return lockBusy(config)
    try {
      await markForReingest(config.wikiDir, filename)
      const state = loadState(config.wikiDir)
      if (state.sources[filename]) {
        state.sources[filename].sha256 = ''
        saveState(config.wikiDir, state)
      }
      return { status: 200, body: { filename, marked: true } }
    } finally {
      releaseLock(config.wikiDir)
    }
  }

  if (action === 'embeddings/reindex') {
    if (!config.embeddings || config.embeddings.provider === 'none') {
      throw new BadRequestError('Semantic search is disabled. Enable embeddings first.')
    }
    const busy = requireLock(config)
    if (busy) return busy
    const job = manager.create('embeddings/reindex')
    manager.start(job.id, async ({ log, signal }) => {
      if (!acquireLock(config.wikiDir)) throw new Error('Another operation is running.')
      try {
        const result = await reindexWiki(config, {
          onProgress: (indexed, total) => {
            if (!signal.aborted) log(`Indexed ${indexed} / ${total} pages`)
          },
        })
        return result
      } finally {
        releaseLock(config.wikiDir)
      }
    })
    return { status: 202, body: { job } }
  }

  if (action === 'analysis/save') {
    const question = stringField(body, 'question')
    const answer = stringField(body, 'answer')
    if (!question || !answer) throw new BadRequestError('“question” and “answer” are required.')
    if (!acquireLock(config.wikiDir)) return lockBusy(config)
    try {
      const title = stringField(body, 'title') || question
      const today = new Date().toISOString().slice(0, 10)
      const slug = analysisSlug(title)
      const pagePath = `wiki/pages/analyses/${slug}.md`
      await writePage(
        config.wikiDir,
        pagePath,
        `---\ntitle: ${JSON.stringify(title)}\nsummary: ${JSON.stringify(`Analysis: ${question.slice(0, 80)}`)}\ntags: [analysis]\ncategory: analyses\nupdatedAt: "${today}"\n---\n\n## Question\n\n${question}\n\n## Answer\n\n${answer}\n`,
      )
      await updateIndex(config.wikiDir)
      await updateMOC(config.wikiDir)
      deps.invalidate?.()
      return { status: 200, body: { path: pagePath, slug } }
    } finally {
      releaseLock(config.wikiDir)
    }
  }

  if (action === 'watch/start' || action === 'watch/stop') {
    if (!deps.watch) throw new BadRequestError('Watch mode is not available on this server.')
    const status = action === 'watch/start' ? deps.watch.start() : await deps.watch.stop()
    return { status: 200, body: status }
  }

  if (action === 'contradiction/resolve') {
    const pagePath = stringField(body, 'path')
    if (!pagePath || pagePath.includes('..') || !pagePath.startsWith('wiki/pages/') || !pagePath.endsWith('.md')) {
      throw new BadRequestError('“path” must be a wiki page path.')
    }
    const resolution = stringField(body, 'resolution') ?? ''
    if (!acquireLock(config.wikiDir)) return lockBusy(config)
    try {
      const content = await readPage(config.wikiDir, pagePath)
      const updated = content.replace(/> ⚠️ Contradiction:.*$/m, () => resolution).trim()
      await writePage(config.wikiDir, pagePath, updated)
      await updateIndex(config.wikiDir)
      await updateMOC(config.wikiDir)
      deps.invalidate?.()
      return { status: 200, body: { path: pagePath, resolved: true } }
    } finally {
      releaseLock(config.wikiDir)
    }
  }

  if (action === 'page/save') {
    const title = stringField(body, 'title')
    if (!title) throw new BadRequestError('“title” is required.')
    const id = stringField(body, 'id')
    if (id) assertPageId(id)
    const category = stringField(body, 'category')
    const summary = stringField(body, 'summary')
    const tags = stringArrayField(body, 'tags')
    const aliases = stringArrayField(body, 'aliases')
    const content = typeof body['body'] === 'string' ? (body['body'] as string) : ''

    if (!acquireLock(config.wikiDir)) return lockBusy(config)
    try {
      return await pageOp(async () => {
        const result = savePage(config.wikiDir, {
          id,
          category,
          title,
          summary,
          tags,
          aliases,
          body: content,
        })
        await syncPages(config, { index: [result.id] }, deps.invalidate)
        commitPaths(
          config.wikiDir,
          [result.path],
          `${result.created ? 'Create' : 'Update'} ${result.id}`,
        )
        return { status: 200, body: result }
      })
    } finally {
      releaseLock(config.wikiDir)
    }
  }

  if (action === 'page/rename') {
    const id = assertPageId(stringField(body, 'id'), 'id')
    const newId = assertPageId(stringField(body, 'newId'), 'newId')

    if (!acquireLock(config.wikiDir)) return lockBusy(config)
    try {
      return await pageOp(async () => {
        const state = loadState(config.wikiDir)
        const result = renamePage(config.wikiDir, id, newId, state, Boolean(config.obsidianCompat))
        saveState(config.wikiDir, state)
        await syncPages(config, {
          index: result.touched,
          removed: [id],
        }, deps.invalidate)
        commitPaths(
          config.wikiDir,
          ['wiki/pages', 'state.json'],
          `Rename ${id} → ${newId} (${result.rewritten.length} pages relinked)`,
        )
        return { status: 200, body: result }
      })
    } finally {
      releaseLock(config.wikiDir)
    }
  }

  if (action === 'page/merge') {
    const source = assertPageId(stringField(body, 'source'), 'source')
    const target = assertPageId(stringField(body, 'target'), 'target')

    if (!acquireLock(config.wikiDir)) return lockBusy(config)
    try {
      return await pageOp(async () => {
        const state = loadState(config.wikiDir)
        const result = mergePages(config.wikiDir, source, target, state, Boolean(config.obsidianCompat))
        saveState(config.wikiDir, state)
        await syncPages(config, {
          index: result.touched,
          removed: [source],
        }, deps.invalidate)
        commitPaths(
          config.wikiDir,
          ['wiki/pages', 'state.json'],
          `Merge ${source} into ${target}`,
        )
        return { status: 200, body: result }
      })
    } finally {
      releaseLock(config.wikiDir)
    }
  }

  if (action === 'page/delete') {
    const id = assertPageId(stringField(body, 'id'), 'id')

    if (!acquireLock(config.wikiDir)) return lockBusy(config)
    try {
      return await pageOp(async () => {
        const state = loadState(config.wikiDir)
        const removedPath = deletePage(config.wikiDir, id, state)
        saveState(config.wikiDir, state)
        await syncPages(config, { removed: [id] }, deps.invalidate)
        commitPaths(config.wikiDir, ['wiki/pages', 'state.json'], `Delete ${id}`)
        return { status: 200, body: { id, path: removedPath, deleted: true } }
      })
    } finally {
      releaseLock(config.wikiDir)
    }
  }

  if (action === 'page/restore') {
    const id = assertPageId(stringField(body, 'id'), 'id')
    const rev = stringField(body, 'rev')
    if (!rev) throw new BadRequestError('“rev” is required.')

    if (!acquireLock(config.wikiDir)) return lockBusy(config)
    try {
      return await pageOp(async () => {
        const content = getPageVersionAt(config.wikiDir, id, rev)
        if (!content) {
          return { status: 404, body: { error: 'That version could not be read.' } }
        }
        const pagePath = pagePathForId(id)
        await writePage(config.wikiDir, pagePath, content)
        await syncPages(config, { index: [id] }, deps.invalidate)
        commitPaths(config.wikiDir, [pagePath], `Restore ${id} to ${rev.slice(0, 8)}`)
        return { status: 200, body: { id, rev, restored: true } }
      })
    } finally {
      releaseLock(config.wikiDir)
    }
  }

  if (action === 'link/insert') {
    const sourceId = assertPageId(stringField(body, 'sourceId'), 'sourceId')
    const targetId = assertPageId(stringField(body, 'targetId'), 'targetId')
    if (sourceId === targetId) throw new BadRequestError('A page cannot link to itself.')

    if (!acquireLock(config.wikiDir)) return lockBusy(config)
    try {
      return await pageOp(async () => {
        const index = buildLinkIndex(config.wikiDir)
        const target = index.get(targetId)
        if (!target) return { status: 404, body: { error: `Page not found: ${targetId}` } }

        const pagePath = pagePathForId(sourceId)
        const raw = await readPage(config.wikiDir, pagePath)
        const parsed = matter(raw)
        const linkText = config.obsidianCompat ? targetId.split('/').pop() ?? targetId : targetId
        const { body: nextBody, changed } = linkFirstMentionInBody(
          parsed.content,
          { title: target.title, aliases: target.aliases, id: target.id },
          linkText,
        )
        if (!changed) {
          return { status: 409, body: { error: 'No unlinked mention was found to wrap.' } }
        }

        await writePage(config.wikiDir, pagePath, matter.stringify(nextBody, parsed.data))
        await syncPages(config, { index: [sourceId] }, deps.invalidate)
        commitPaths(config.wikiDir, [pagePath], `Link ${sourceId} → ${targetId}`)
        return { status: 200, body: { sourceId, targetId, linked: true } }
      })
    } finally {
      releaseLock(config.wikiDir)
    }
  }

  if (action === 'preview') {
    const text = typeof body['body'] === 'string' ? (body['body'] as string) : ''
    if (text.length > 200_000) throw new BadRequestError('Preview body is too large.')
    return { status: 200, body: { html: renderMarkdown(text) } }
  }

  return { status: 404, body: { error: `Unknown action “${action}”.` } }
}

