import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

import type { AxiomConfig } from '../config/index.js'
import { clipUrl } from './clip.js'
import { capture } from './inbox.js'
import { ingest } from './ingest.js'
import { acquireLock, getLockInfo, releaseLock } from './lock.js'
import { idFromPagePath, pagePathForId } from './page-ops.js'
import { commitPaths } from './git.js'
import { appendLog, updateIndex, updateMOC } from './wiki.js'
import { indexWikiPage, persistOrama } from './indexing.js'

/**
 * Scout — the always-on intake agent.
 *
 * Scout is the wiki's front door: you hand it a link or a note, wherever you
 * are, and it lands in the queue, gets clipped, and is compiled into the wiki.
 * There is no platform integration to maintain. A share sheet, a curl call, a
 * dropped file, an agent tool call, or a pasted thread all become the same
 * thing: a queue item.
 *
 * The queue is an append-only event log (`scout/queue.jsonl`), so a crash mid
 * drain cannot lose a share or leave a half-written status. Replaying the log
 * gives the current view; compaction rewrites it as one event per live item.
 */

export const SCOUT_NAME = 'Scout'
export const SCOUT_MENTION = '@scout'
export const SCOUT_DIR = 'scout'
export const SCOUT_DROP_DIR = 'scout/drop'
export const DEFAULT_SCOUT_PORT = 1719

const QUEUE_FILE = 'scout/queue.jsonl'
const WORKER_FILE = 'scout/worker.json'
const TOKEN_FILE = 'scout/token'
const SCOUT_LOCK_FILE = 'scout/lock'
const DROP_PROCESSED = 'scout/processed'
const MAX_ITEMS = 400
const MAX_EVENTS_BYTES = 2_000_000
const MAX_TEXT_PREVIEW = 600
const MAX_NOTE = 4000

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'ref_url',
  'si',
  'spm',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
])

export type ScoutKind = 'url' | 'text' | 'file'
export type ScoutStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped'

export interface ScoutItem {
  id: string
  /** Dedupe key: `url:<normalized>` or `text:<sha1>`. */
  key: string
  kind: ScoutKind
  url?: string
  text?: string
  /** Absolute path for a dropped file. */
  file?: string
  tags: string[]
  note?: string
  /** Where the share came from: share, text, drop, cli, agent, api. */
  source: string
  addedAt: string
  status: ScoutStatus
  attempts: number
  startedAt?: string
  finishedAt?: string
  lastError?: string
  result?: ScoutResult
}

export interface ScoutResult {
  pages?: string[]
  inbox?: string
  filename?: string
  reused?: boolean
  tags?: string[]
  message?: string
}

export interface ScoutShareInput {
  url?: string
  text?: string
  file?: string
  tags?: string[]
  note?: string
  source?: string
}

export interface ScoutShareOutcome {
  added: ScoutItem[]
  duplicates: ScoutItem[]
  parsed: ParsedShare
}

export interface ParsedShare {
  urls: string[]
  tags: string[]
  /** Text with the URLs, mentions, and tags removed. */
  text: string
  mentioned: boolean
}

export type ScoutEvent =
  | { type: 'share'; at: string; item: ScoutItem }
  | { type: 'start'; at: string; id: string }
  | { type: 'done'; at: string; id: string; result?: ScoutResult }
  | { type: 'failed'; at: string; id: string; error: string }
  | { type: 'skip'; at: string; id: string; reason: string }
  | { type: 'requeue'; at: string; id: string }
  | { type: 'remove'; at: string; id: string }

export interface ScoutSummary {
  name: string
  mention: string
  pending: number
  running: number
  done: number
  failed: number
  total: number
  lastAddedAt: string | null
}

// ── Parsing ───────────────────────────────────────────────────────────────

function sha1(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function trimUrlPunctuation(value: string): string {
  return value.replace(/[.,;:!?)\]}>'"]+$/u, '')
}

function isColorLike(tag: string): boolean {
  return /^[0-9a-f]{3,8}$/i.test(tag) && !/[g-z]/i.test(tag)
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

/**
 * Pulls links, hashtags, and the `@scout` mention out of arbitrary pasted text
 * — a thread, a doc, a chat message. URLs and tags are masked before the tag
 * scan so `https://x/#section` never becomes a `#section` tag.
 */
export function parseShareText(raw: string): ParsedShare {
  const text = (raw ?? '').replace(/\r\n/g, '\n')
  const urls: string[] = []

  let masked = text.replace(/\b(?:https?:\/\/|www\.)[^\s<>"'`]+/giu, (match) => {
    const cleaned = trimUrlPunctuation(match)
    if (cleaned) {
      urls.push(/^www\./i.test(cleaned) ? `https://${cleaned}` : cleaned)
    }
    return ' '.repeat(match.length)
  })

  const tags: string[] = []
  masked = masked.replace(/(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_/-]{0,40})/gu, (_match, lead: string, tag: string) => {
    const normalized = tag.toLowerCase()
    if (!isColorLike(normalized)) tags.push(normalized)
    return lead
  })

  const mentionRe = /(^|\s)@(scout|axiom|wiki)\b/iu
  const mentioned = mentionRe.test(masked)
  masked = masked.replace(/(^|\s)@(scout|axiom|wiki)\b/giu, '$1')

  const body = masked
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return {
    urls: unique(urls),
    tags: unique(tags).slice(0, 8),
    text: body,
    mentioned,
  }
}

/** Canonicalizes a link so the same share twice is one queue item. */
export function normalizeUrl(raw: string): string {
  let value = raw.trim()
  if (!value) throw new Error('Empty URL.')
  if (/^www\./i.test(value)) value = `https://${value}`

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) links can be shared: ${raw}`)
  }

  const host = url.hostname.toLowerCase().replace(/^www\./i, '')
  let pathname = url.pathname

  // YouTube has several share shapes; keep one canonical watch URL.
  if (host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const id =
      host === 'youtu.be'
        ? pathname.slice(1).split('/')[0]
        : url.searchParams.get('v') ??
          (pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/)?.[1] ?? '')
    if (id) return `https://youtube.com/watch?v=${id}`
  }

  const params = new URLSearchParams(url.search)
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
      params.delete(key)
    }
  }
  const query = params.toString()
  pathname = pathname.replace(/\/+$/, '') || '/'

  return `${url.protocol}//${host}${pathname}${query ? `?${query}` : ''}`
}

function textKey(text: string): string {
  return `text:${sha1(text.replace(/\s+/g, ' ').trim().toLowerCase())}`
}

function newItem(input: {
  key: string
  kind: ScoutKind
  url?: string
  text?: string
  file?: string
  tags: string[]
  note?: string
  source: string
  at: string
}): ScoutItem {
  return {
    id: `scout_${sha1(input.key).slice(0, 12)}`,
    key: input.key,
    kind: input.kind,
    ...(input.url ? { url: input.url } : {}),
    ...(input.text ? { text: input.text.slice(0, 20_000) } : {}),
    ...(input.file ? { file: input.file } : {}),
    tags: input.tags,
    ...(input.note ? { note: input.note.slice(0, MAX_NOTE) } : {}),
    source: input.source,
    addedAt: input.at,
    status: 'queued',
    attempts: 0,
  }
}

/** Builds the queue items a share should produce, without touching disk. */
export function buildShareItems(input: ScoutShareInput, at = new Date().toISOString()): ParsedShare & { items: ScoutItem[] } {
  const explicitText = input.text ?? ''
  const parsed = parseShareText(explicitText)
  const rawUrls = input.url ? [input.url, ...parsed.urls] : parsed.urls
  const urls = unique(
    rawUrls.map((url) => {
      try {
        return normalizeUrl(url)
      } catch {
        return url.trim()
      }
    }),
  )
  const tags = unique([...(input.tags ?? []).map((tag) => tag.replace(/^#/, '').trim().toLowerCase()), ...parsed.tags])
    .filter(Boolean)
    .slice(0, 8)
  const note = (input.note ?? (urls.length > 0 ? parsed.text : '')).trim()
  const source = input.source ?? 'api'
  const items: ScoutItem[] = []

  for (const url of urls) {
    items.push(
      newItem({
        key: `url:${url}`,
        kind: 'url',
        url,
        tags,
        note,
        source,
        at,
      }),
    )
  }

  if (input.file) {
    const file = path.resolve(input.file)
    items.push(
      newItem({
        key: `file:${file}`,
        kind: 'file',
        file,
        tags,
        note: note || undefined,
        source,
        at,
      }),
    )
  }

  // A URL plus commentary is one item; text with no URL is an inbox note.
  if (urls.length === 0 && !input.file && parsed.text) {
    items.push(
      newItem({
        key: textKey(parsed.text),
        kind: 'text',
        text: parsed.text,
        tags,
        note: note && note !== parsed.text ? note : undefined,
        source,
        at,
      }),
    )
  }

  return { ...parsed, urls, tags, items }
}

// ── Event log ─────────────────────────────────────────────────────────────

function queuePath(wikiDir: string): string {
  return path.join(wikiDir, QUEUE_FILE)
}

function ensureScoutDir(wikiDir: string): void {
  fs.mkdirSync(path.join(wikiDir, SCOUT_DIR), { recursive: true })
}

export function scoutToken(wikiDir: string): string {
  const file = path.join(wikiDir, TOKEN_FILE)
  try {
    const existing = fs.readFileSync(file, 'utf-8').trim()
    if (existing) return existing
  } catch {
    /* first run */
  }
  const token = crypto.randomBytes(18).toString('base64url')
  ensureScoutDir(wikiDir)
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 })
  return token
}

/** Replays the append-only log into the current queue view. */
export function reduceScoutEvents(events: ScoutEvent[]): ScoutItem[] {
  const items = new Map<string, ScoutItem>()

  for (const event of events) {
    if (event.type === 'share') {
      items.set(event.item.id, { ...event.item, tags: [...event.item.tags] })
      continue
    }
    const item = items.get(event.id)
    if (!item) continue

    if (event.type === 'start') {
      item.status = 'running'
      item.startedAt = event.at
      item.attempts += 1
      item.lastError = undefined
    } else if (event.type === 'done') {
      item.status = 'done'
      item.finishedAt = event.at
      item.result = event.result
      item.lastError = undefined
    } else if (event.type === 'failed') {
      item.status = 'failed'
      item.finishedAt = event.at
      item.lastError = event.error
    } else if (event.type === 'skip') {
      item.status = 'skipped'
      item.finishedAt = event.at
      item.lastError = event.reason
    } else if (event.type === 'requeue') {
      item.status = 'queued'
      item.finishedAt = undefined
      item.lastError = undefined
      item.startedAt = undefined
    } else if (event.type === 'remove') {
      items.delete(event.id)
    }
  }

  return [...items.values()].sort((a, b) => a.addedAt.localeCompare(b.addedAt))
}

export function readScoutEvents(wikiDir: string): ScoutEvent[] {
  let raw = ''
  try {
    raw = fs.readFileSync(queuePath(wikiDir), 'utf-8')
  } catch {
    return []
  }
  const events: ScoutEvent[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as ScoutEvent
      if (parsed && typeof parsed.type === 'string') events.push(parsed)
    } catch {
      // A torn final line from a crash is ignored; every earlier share is intact.
    }
  }
  return events
}

export function loadScoutItems(wikiDir: string): ScoutItem[] {
  return reduceScoutEvents(readScoutEvents(wikiDir))
}

function compactScoutQueue(wikiDir: string): void {
  const items = loadScoutItems(wikiDir).slice(-MAX_ITEMS)
  const at = new Date().toISOString()
  const body = items.map((item) => JSON.stringify({ type: 'share', at, item })).join('\n')
  const file = queuePath(wikiDir)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, body ? `${body}\n` : '', 'utf-8')
  fs.renameSync(tmp, file)
}

export function appendScoutEvent(wikiDir: string, event: ScoutEvent): void {
  ensureScoutDir(wikiDir)
  const file = queuePath(wikiDir)
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf-8')
  try {
    if (fs.statSync(file).size > MAX_EVENTS_BYTES) compactScoutQueue(wikiDir)
  } catch {
    /* compaction is housekeeping, not correctness */
  }
}

export function scoutSummary(wikiDir: string): ScoutSummary {
  const items = loadScoutItems(wikiDir)
  const count = (status: ScoutStatus) => items.filter((item) => item.status === status).length
  const lastAdded = items.at(-1)?.addedAt ?? null
  return {
    name: SCOUT_NAME,
    mention: SCOUT_MENTION,
    pending: count('queued'),
    running: count('running'),
    done: count('done'),
    failed: count('failed'),
    total: items.length,
    lastAddedAt: lastAdded,
  }
}

/**
 * Adds a share to the queue. Links already queued or already ingested are
 * returned as duplicates instead of being processed twice.
 */
export function queueShare(
  wikiDir: string,
  input: ScoutShareInput,
): ScoutShareOutcome {
  const built = buildShareItems(input)
  if (built.items.length === 0) throw new Error('Nothing to share — add a link or some text.')

  const existing = new Map(loadScoutItems(wikiDir).map((item) => [item.key, item]))
  const added: ScoutItem[] = []
  const duplicates: ScoutItem[] = []

  for (const item of built.items) {
    const match = existing.get(item.key)
    if (match && match.status !== 'failed' && match.status !== 'skipped') {
      duplicates.push(match)
      continue
    }
    if (match) {
      // Retrying a failed share reuses its id so history stays continuous.
      const retried: ScoutItem = {
        ...match,
        tags: unique([...match.tags, ...item.tags]),
        note: item.note ?? match.note,
        status: 'queued',
        startedAt: undefined,
        finishedAt: undefined,
        lastError: undefined,
      }
      appendScoutEvent(wikiDir, { type: 'share', at: item.addedAt, item: retried })
      added.push(retried)
      continue
    }
    appendScoutEvent(wikiDir, { type: 'share', at: item.addedAt, item })
    existing.set(item.key, item)
    added.push(item)
  }

  return { added, duplicates, parsed: { urls: built.urls, tags: built.tags, text: built.text, mentioned: built.mentioned } }
}

export function requeueScoutItem(wikiDir: string, id: string): ScoutItem | null {
  const item = loadScoutItems(wikiDir).find((entry) => entry.id === id)
  if (!item) return null
  appendScoutEvent(wikiDir, { type: 'requeue', at: new Date().toISOString(), id })
  return { ...item, status: 'queued', finishedAt: undefined, lastError: undefined }
}

export function removeScoutItem(wikiDir: string, id: string): boolean {
  const item = loadScoutItems(wikiDir).find((entry) => entry.id === id)
  if (!item) return false
  appendScoutEvent(wikiDir, { type: 'remove', at: new Date().toISOString(), id })
  return true
}

export function clearFinishedScoutItems(wikiDir: string): number {
  const finished = loadScoutItems(wikiDir).filter(
    (item) => item.status === 'done' || item.status === 'failed' || item.status === 'skipped',
  )
  const at = new Date().toISOString()
  for (const item of finished) {
    appendScoutEvent(wikiDir, { type: 'remove', at, id: item.id })
  }
  return finished.length
}

/** Compact view for the API — long pasted text is truncated. */
export function publicScoutItem(item: ScoutItem): ScoutItem & { preview: string } {
  const preview =
    item.kind === 'text'
      ? (item.text ?? '').slice(0, MAX_TEXT_PREVIEW)
      : (item.url ?? (item.file ? path.basename(item.file) : ''))
  const trimmed: ScoutItem = {
    ...item,
    ...(item.text ? { text: item.text.slice(0, MAX_TEXT_PREVIEW) } : {}),
    ...(item.file ? { file: path.basename(item.file) } : {}),
  }
  return { ...trimmed, preview }
}

// ── Drop folder ───────────────────────────────────────────────────────────

const DROP_EXTS = new Set(['.md', '.txt', '.url', '.webloc', '.text'])

function readDropFile(file: string): string {
  const raw = fs.readFileSync(file, 'utf-8')
  if (path.extname(file).toLowerCase() === '.url') {
    const match = raw.match(/^\s*URL\s*=\s*(.+)$/im)
    return match?.[1]?.trim() ?? raw
  }
  if (path.extname(file).toLowerCase() === '.webloc') {
    const match = raw.match(/<string>([^<]+)<\/string>/)
    return match?.[1]?.trim() ?? raw
  }
  return raw
}

/**
 * Turns files dropped into `scout/drop/` into shares and moves them aside.
 * A drop is already an explicit hand-off, so no `@scout` mention is required.
 */
export function scanScoutDrop(wikiDir: string, options: { source?: string } = {}): ScoutShareOutcome[] {
  const dir = path.join(wikiDir, SCOUT_DROP_DIR)
  if (!fs.existsSync(dir)) return []

  const outcomes: ScoutShareOutcome[] = []
  const processed = path.join(wikiDir, DROP_PROCESSED)
  fs.mkdirSync(processed, { recursive: true })

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue
    const ext = path.extname(entry.name).toLowerCase()
    if (!DROP_EXTS.has(ext)) continue
    const abs = path.join(dir, entry.name)

    try {
      if (fs.statSync(abs).size > 2_000_000) continue
      const body = readDropFile(abs)
      const outcome = queueShare(wikiDir, { text: body, source: options.source ?? 'drop' })
      outcomes.push(outcome)
      const target = path.join(processed, `${Date.now()}-${entry.name}`)
      fs.renameSync(abs, target)
    } catch {
      // Leave an unreadable drop in place so it can be inspected or fixed.
    }
  }

  return outcomes
}

// ── Worker heartbeat + lock ───────────────────────────────────────────────

export interface ScoutWorker {
  pid: number
  host: string
  port: number
  startedAt: string
  heartbeatAt: string
  /** LAN-reachable base URL when the listener is bound to 0.0.0.0/::. */
  lanUrl?: string
}

export function writeScoutHeartbeat(wikiDir: string, worker: ScoutWorker): void {
  ensureScoutDir(wikiDir)
  fs.writeFileSync(path.join(wikiDir, WORKER_FILE), JSON.stringify(worker, null, 2), 'utf-8')
}

export function readScoutHeartbeat(wikiDir: string): ScoutWorker | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(wikiDir, WORKER_FILE), 'utf-8')) as ScoutWorker
  } catch {
    return null
  }
}

export function clearScoutHeartbeat(wikiDir: string, pid = process.pid): void {
  const current = readScoutHeartbeat(wikiDir)
  if (current && current.pid !== pid) return
  try {
    fs.rmSync(path.join(wikiDir, WORKER_FILE), { force: true })
  } catch {
    /* nothing to clear */
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Live worker, if the heartbeat belongs to a process that still exists. */
export function liveScoutWorker(wikiDir: string): ScoutWorker | null {
  const worker = readScoutHeartbeat(wikiDir)
  if (!worker) return null
  return pidAlive(worker.pid) ? worker : null
}

interface ScoutLockInfo {
  pid: number
  acquiredAt: string
}

function readScoutLock(wikiDir: string): ScoutLockInfo | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(wikiDir, SCOUT_LOCK_FILE), 'utf-8')) as ScoutLockInfo
  } catch {
    return null
  }
}

/** One drainer at a time, across processes. Stale locks are reclaimed. */
export function acquireScoutLock(wikiDir: string): boolean {
  ensureScoutDir(wikiDir)
  const file = path.join(wikiDir, SCOUT_LOCK_FILE)
  const current = readScoutLock(wikiDir)
  if (current && pidAlive(current.pid)) return false
  if (current) {
    try {
      fs.rmSync(file, { force: true })
    } catch {
      /* fall through to the write */
    }
  }
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), 'utf-8')
  return true
}

export function releaseScoutLock(wikiDir: string): void {
  const current = readScoutLock(wikiDir)
  if (current && current.pid !== process.pid) return
  try {
    fs.rmSync(path.join(wikiDir, SCOUT_LOCK_FILE), { force: true })
  } catch {
    /* already gone */
  }
}

// ── Draining ──────────────────────────────────────────────────────────────

export interface ScoutDrainOptions {
  /** Compile sources into the wiki. False only clips and queues. */
  ingest?: boolean
  limit?: number
  onStatus?: (line: string) => void
  signal?: AbortSignal
  /** Refresh server-side caches after each write. */
  invalidate?: () => void
}

export interface ScoutDrainResult {
  processed: ScoutItem[]
  failed: number
  remaining: number
  /** True when another process owns the drain lock or the compilation lock. */
  busy: boolean
  reason?: string
}

function newestSourcePage(wikiDir: string): string | null {
  const dir = path.join(wikiDir, 'wiki/pages/sources')
  let names: string[]
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.md'))
  } catch {
    return null
  }
  let best: { id: string; mtime: number } | null = null
  for (const name of names) {
    try {
      const stat = fs.statSync(path.join(dir, name))
      if (!best || stat.mtimeMs > best.mtime) {
        best = { id: `sources/${name.replace(/\.md$/, '')}`, mtime: stat.mtimeMs }
      }
    } catch {
      /* skip unreadable entries */
    }
  }
  return best?.id ?? null
}

function applyScoutTags(wikiDir: string, pageIds: string[], tags: string[]): string[] {
  if (tags.length === 0) return []
  const touched: string[] = []

  const targets = pageIds.filter((id) => id.startsWith('sources/'))
  if (targets.length === 0) {
    // The agent does not always echo every path it wrote; fall back to the
    // source page it just touched so the share tags still land.
    const newest = newestSourcePage(wikiDir)
    if (newest) targets.push(newest)
  }

  for (const id of targets) {
    const abs = path.join(wikiDir, pagePathForId(id))
    let parsed: ReturnType<typeof matter>
    try {
      parsed = matter(fs.readFileSync(abs, 'utf-8'))
    } catch {
      continue
    }
    const current = Array.isArray(parsed.data['tags'])
      ? (parsed.data['tags'] as unknown[]).map(String)
      : []
    const merged = unique([...current, 'scout', ...tags])
    if (merged.length === current.length && merged.every((tag) => current.includes(tag))) continue
    parsed.data['tags'] = merged
    const tmp = `${abs}.scout.tmp`
    fs.writeFileSync(tmp, matter.stringify(parsed.content, parsed.data), 'utf-8')
    fs.renameSync(tmp, abs)
    touched.push(id)
  }

  return touched
}

/**
 * Processes the oldest queued shares. Every item is marked `running` before
 * the work and resolved to `done`/`failed` after, so an interrupted drain is
 * visible instead of silent.
 */
export async function drainScout(
  config: AxiomConfig,
  options: ScoutDrainOptions = {},
): Promise<ScoutDrainResult> {
  const wikiDir = config.wikiDir
  const status = options.onStatus ?? (() => {})
  const limit = Math.max(1, Math.min(options.limit ?? 5, 25))

  if (!acquireScoutLock(wikiDir)) {
    return { processed: [], failed: 0, remaining: scoutSummary(wikiDir).pending, busy: true, reason: 'Another Scout drain is running.' }
  }

  const processed: ScoutItem[] = []
  let failed = 0

  try {
    const queued = loadScoutItems(wikiDir).filter((item) => item.status === 'queued').slice(0, limit)
    if (queued.length === 0) {
      return { processed, failed, remaining: scoutSummary(wikiDir).pending, busy: false }
    }

    for (const item of queued) {
      if (options.signal?.aborted) break

      const lock = getLockInfo(wikiDir)
      if (lock.locked && !lock.stale) {
        status('Wiki is busy — leaving the rest of the queue for the next pass.')
        break
      }

      appendScoutEvent(wikiDir, { type: 'start', at: new Date().toISOString(), id: item.id })
      const running: ScoutItem = { ...item, status: 'running', attempts: item.attempts + 1, startedAt: new Date().toISOString() }

      try {
        if (item.kind === 'text') {
          const captured = await captureText(config, item, status)
          appendScoutEvent(wikiDir, { type: 'done', at: new Date().toISOString(), id: item.id, result: captured })
          processed.push({ ...running, status: 'done', result: captured })
          options.invalidate?.()
          continue
        }

        if (item.kind === 'file') {
          if (!item.file) throw new Error('The shared file path is missing.')
          if (!fs.existsSync(item.file)) throw new Error(`File not found: ${item.file}`)
          status(`Ingesting dropped file ${path.basename(item.file)}…`)
          const result = await ingest(config, { file: item.file }, { onStatus: status, signal: options.signal })
          assertIngestSucceeded(result)
          const pages = result.pages.map((page) => idFromPagePath(page))
          const tagTouched = applyScoutTags(wikiDir, pages, item.tags)
          if (tagTouched.length > 0) {
            await updateIndex(wikiDir)
            await updateMOC(wikiDir)
          }
          const outcome: ScoutResult = {
            pages,
            filename: path.basename(item.file),
            tags: tagTouched,
            message: result.summary,
          }
          commitPaths(wikiDir, ['wiki/pages', 'wiki/index.md', 'wiki/moc.md', 'wiki/log.md', 'state.json'], `Scout: ${path.basename(item.file)}`)
          appendScoutEvent(wikiDir, { type: 'done', at: new Date().toISOString(), id: item.id, result: outcome })
          processed.push({ ...running, status: 'done', result: outcome })
          options.invalidate?.()
          continue
        }

        if (!item.url) throw new Error('The shared link is missing.')
        status(`Fetching ${item.url}…`)
        const clipped = await clipUrl(item.url, config.rawDir, { onStatus: status })

        if (options.ingest === false) {
          const outcome: ScoutResult = {
            filename: clipped.filename,
            reused: Boolean(clipped.reused),
            pages: [],
            message: 'Clipped; ingest disabled.',
          }
          appendScoutEvent(wikiDir, { type: 'done', at: new Date().toISOString(), id: item.id, result: outcome })
          processed.push({ ...running, status: 'done', result: outcome })
          options.invalidate?.()
          continue
        }

        status(`Compiling ${clipped.filename}…`)
        const result = await ingest(config, { file: clipped.filename }, { onStatus: status, signal: options.signal })
        assertIngestSucceeded(result)
        const pages = result.pages.map((page) => idFromPagePath(page))
        const tagTouched = applyScoutTags(wikiDir, pages, item.tags)
        if (tagTouched.length > 0) {
          await updateIndex(wikiDir)
          await updateMOC(wikiDir)
          if (config.embeddings && config.embeddings.provider !== 'none') {
            for (const id of tagTouched) {
              try {
                await indexWikiPage(config, pagePathForId(id))
              } catch {
                /* indexing is best effort */
              }
            }
            await persistOrama(config).catch(() => {})
          }
        }

        const outcome: ScoutResult = {
          pages,
          filename: clipped.filename,
          reused: Boolean(clipped.reused),
          tags: tagTouched,
          message: result.summary,
        }
        commitPaths(
          wikiDir,
          ['wiki/pages', 'wiki/index.md', 'wiki/moc.md', 'wiki/log.md', 'state.json'],
          `Scout: ${clipped.title}`,
        )
        appendScoutEvent(wikiDir, { type: 'done', at: new Date().toISOString(), id: item.id, result: outcome })
        processed.push({ ...running, status: 'done', result: outcome })
        options.invalidate?.()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        failed += 1
        status(`Scout could not process ${item.url ?? item.id}: ${message}`)
        appendScoutEvent(wikiDir, { type: 'failed', at: new Date().toISOString(), id: item.id, error: message })
        processed.push({ ...running, status: 'failed', lastError: message })
      }
    }

    return {
      processed,
      failed,
      remaining: scoutSummary(wikiDir).pending,
      busy: false,
    }
  } finally {
    releaseScoutLock(wikiDir)
  }
}

function assertIngestSucceeded(result: { files: Array<{ filename: string; status: string; error?: string }> }): void {
  if (result.files.length === 0) throw new Error('Nothing was ingested.')
  const failed = result.files.filter((file) => file.status === 'error')
  if (failed.length > 0) {
    const first = failed[0] as { filename: string; error?: string }
    throw new Error(`${first.filename}: ${first.error ?? 'ingest failed'}`)
  }
}

async function captureText(
  config: AxiomConfig,
  item: ScoutItem,
  status: (line: string) => void,
): Promise<ScoutResult> {
  const { wikiDir } = config
  if (!acquireLock(wikiDir)) throw new Error('The wiki is busy; this note stays queued.')

  try {
    status('Filing the note in the inbox…')
    const captured = capture(wikiDir, {
      text: item.text ?? '',
      tags: item.tags,
      source: item.url,
    })
    await updateIndex(wikiDir)
    await updateMOC(wikiDir)
    await appendLog(wikiDir, captured.id, 'ingest')
    if (config.embeddings && config.embeddings.provider !== 'none') {
      try {
        await indexWikiPage(config, pagePathForId(captured.id))
        await persistOrama(config)
      } catch {
        /* indexing is best effort */
      }
    }
    commitPaths(
      wikiDir,
      [captured.path, 'wiki/index.md', 'wiki/moc.md', 'wiki/log.md'],
      `Scout: ${captured.title}`,
    )
    return { inbox: captured.id, pages: [captured.id], tags: item.tags }
  } finally {
    releaseLock(wikiDir)
  }
}
