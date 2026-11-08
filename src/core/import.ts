import fs from 'fs'
import os from 'os'
import path from 'path'

import type { AxiomConfig } from '../config/index.js'
import { SUPPORTED_EXTS } from './files.js'
import { clipUrl } from './clip.js'
import { ingest, AbortIngestError, type IngestRunResult } from './ingest.js'
import { normalizeUrl } from './scout.js'
import { computeHash } from './state.js'

/**
 * Bulk import: take a pile of material — a downloads folder, an Obsidian vault,
 * a Notion export, a browser bookmarks file, a URL list — and turn it into
 * sources in `raw/`, then compile them through the normal ingest pipeline.
 *
 * Import is deliberately two-phase: `planImport` decides, `runImport` executes.
 * A plan can be reviewed (and is cheap) before anything is copied or fetched.
 */

export type ImportStatus = 'ready' | 'duplicate' | 'unsupported' | 'invalid'

export interface ImportFileItem {
  kind: 'file'
  /** Absolute path of the source on disk. */
  source: string
  /** Display name. */
  label: string
  /** Path relative to the folder the user pointed at, when there was one. */
  relative: string | null
  bytes: number
  /** Planned filename inside `raw/`. For duplicates, what it collides with. */
  target: string
  status: ImportStatus
  reason?: string
}

export interface ImportUrlItem {
  kind: 'url'
  /** Canonical URL (tracking parameters stripped). */
  source: string
  label: string
  status: ImportStatus
  reason?: string
}

export type ImportItem = ImportFileItem | ImportUrlItem

export interface ImportPlan {
  items: ImportItem[]
  ready: number
  duplicates: number
  unsupported: number
  invalid: number
  fileCount: number
  urlCount: number
  /** Total size of the files that would be copied. */
  totalBytes: number
  /** URLs discovered beyond the per-run limit. */
  truncatedUrls: number
  /** Files discovered beyond the per-run limit. */
  truncatedFiles: number
}

export interface ImportRequest {
  /** Files and folders to import. Folders are walked recursively. */
  paths?: string[]
  /** URLs to clip. */
  urls?: string[]
  /** List files to read URLs from: .txt, .csv, .json, or a bookmarks .html. */
  from?: string[]
  /** Include PDFs and images found inside folders. Off by default. */
  includeMedia?: boolean
  /** Maximum URLs per run, so a huge bookmarks export cannot run away. */
  urlLimit?: number
  /** Maximum files per run. */
  fileLimit?: number
}

export interface ImportHooks {
  onStatus?: (line: string) => void
  signal?: AbortSignal
}

export interface ImportedSource {
  item: ImportItem
  filename: string
  ok: boolean
  moved?: boolean
  error?: string
}

export interface ImportRunResult {
  plan: ImportPlan
  staged: ImportedSource[]
  ingest: IngestRunResult | null
  summary: string
}

export interface ImportRunRequest extends ImportRequest {
  /** Compile the staged sources after copying them (default true). */
  ingest?: boolean
  /** Extra framing passed to the ingest prompt. */
  context?: string
  /** Move source files into raw/ instead of copying them (CLI only). */
  move?: boolean
}

const MEDIA_EXTS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp'])
const LIST_EXTS = new Set(['.txt', '.csv', '.tsv', '.json', '.html', '.htm'])
const DEFAULT_URL_LIMIT = 200
const DEFAULT_FILE_LIMIT = 2000
const MAX_PREVIEW = 20

/** Folders that are never source material, even inside a vault. */
const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.obsidian',
  '.trash',
  '.stfolder',
  '.stversions',
  '.cache',
  '.next',
  '.venv',
  'node_modules',
  '__pycache__',
  'venv',
  'dist',
  'build',
  'target',
])

const URL_RE = /^https?:\/\/\S+$/i

// ── Ledger ──────────────────────────────────────────────────────────────────
//
// URLs are deduplicated through a small ledger, because clipping cannot know
// the filename ahead of time (it derives one from the article title). The
// ledger maps a canonical URL to the raw file it produced. It is advisory: a
// missing file means the URL is importable again.

interface ImportLedger {
  version: 1
  urls: Record<string, { filename: string; at: string }>
}

export function importLedgerPath(wikiDir: string): string {
  return path.join(wikiDir, 'imports.json')
}

function loadLedger(wikiDir: string): ImportLedger {
  const file = importLedgerPath(wikiDir)
  if (!fs.existsSync(file)) return { version: 1, urls: {} }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<ImportLedger>
    return {
      version: 1,
      urls: parsed && typeof parsed.urls === 'object' && parsed.urls ? parsed.urls : {},
    }
  } catch {
    return { version: 1, urls: {} }
  }
}

function saveLedger(wikiDir: string, ledger: ImportLedger): void {
  const file = importLedgerPath(wikiDir)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function expandHome(value: string): string {
  const trimmed = value.trim().replace(/^["']|["']$/g, '')
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2))
  return trimmed
}

function isInside(parent: string, child: string): boolean {
  const root = path.resolve(parent)
  const candidate = path.resolve(child)
  return candidate === root || candidate.startsWith(root + path.sep)
}

function uniqueName(taken: Set<string>, filename: string): string {
  if (!taken.has(filename)) return filename
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let counter = 2
  while (taken.has(`${base}-${counter}${ext}`)) counter += 1
  return `${base}-${counter}${ext}`
}

/** Raw filenames plus the content hash of each, for duplicate detection. */
interface RawIndex {
  names: Set<string>
  hashes: Map<string, string>
}

function buildRawIndex(rawDir: string): RawIndex {
  const names = new Set<string>()
  const hashes = new Map<string, string>()
  if (!fs.existsSync(rawDir)) return { names, hashes }

  for (const entry of fs.readdirSync(rawDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue
    const full = path.join(rawDir, entry.name)
    if (!SUPPORTED_EXTS.includes(path.extname(entry.name).toLowerCase())) continue
    names.add(entry.name)
    try {
      const hash = computeHash(full)
      if (!hashes.has(hash)) hashes.set(hash, entry.name)
    } catch {
      // A file that vanished mid-scan is not a duplicate.
    }
  }

  return { names, hashes }
}

/** URLs already clipped into raw/, read from the `source_url` frontmatter. */
function knownClippedUrls(rawDir: string): Set<string> {
  const known = new Set<string>()
  if (!fs.existsSync(rawDir)) return known

  for (const name of fs.readdirSync(rawDir)) {
    if (!name.toLowerCase().endsWith('.md')) continue
    try {
      const head = fs.readFileSync(path.join(rawDir, name), 'utf-8').slice(0, 800)
      const match = head.match(/^source_url:\s*["']?([^"'\n]+)["']?\s*$/m)
      if (!match) continue
      known.add(normalizeUrl(match[1]))
    } catch {
      // Ignore unreadable files.
    }
  }

  return known
}

interface WalkedFile {
  filepath: string
  relative: string
}

function walkFolder(root: string, includeMedia: boolean, out: WalkedFile[] = [], depth = 0): WalkedFile[] {
  if (depth > 12) return out

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
    const full = path.join(root, entry.name)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
      walkFolder(full, includeMedia, out, depth + 1)
      continue
    }
    if (!entry.isFile()) continue

    const ext = path.extname(entry.name).toLowerCase()
    if (!SUPPORTED_EXTS.includes(ext)) continue
    if (!includeMedia && MEDIA_EXTS.has(ext)) continue

    out.push({ filepath: full, relative: path.relative(root, full) })
  }

  return out
}

// ── URL list parsing ────────────────────────────────────────────────────────

function urlsFromHtml(text: string): string[] {
  const urls: string[] = []
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (URL_RE.test(match[1])) urls.push(match[1])
  }
  return urls
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',' || char === '\t') {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell)
  return cells.map((value) => value.trim())
}

function urlsFromDelimited(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length === 0) return []

  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase().replace(/^["']|["']$/g, ''))
  const urlColumn = header.findIndex((cell) => ['url', 'link', 'href', 'uri'].includes(cell))

  const urls: string[] = []
  const start = urlColumn >= 0 ? 1 : 0
  for (let i = start; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i])
    const value = urlColumn >= 0 ? cells[urlColumn] : cells.find((cell) => URL_RE.test(cell))
    if (value && URL_RE.test(value)) urls.push(value)
  }
  return urls
}

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 8) return
  if (typeof value === 'string') {
    if (URL_RE.test(value.trim())) out.push(value.trim())
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out, depth + 1)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (['url', 'href', 'uri', 'link'].includes(key.toLowerCase()) && typeof entry === 'string') {
        if (URL_RE.test(entry.trim())) out.push(entry.trim())
      } else {
        collectStrings(entry, out, depth + 1)
      }
    }
  }
}

function urlsFromJson(text: string): string[] {
  const parsed = JSON.parse(text) as unknown
  const urls: string[] = []
  collectStrings(parsed, urls)
  return urls
}

function urlsFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && URL_RE.test(line))
}

/**
 * Reads URLs out of a list file. Handles the shapes personal exports actually
 * come in: one-per-line text, Readwise/Pocket CSV, Chrome bookmarks JSON, and
 * a Netscape bookmarks HTML export.
 */
export function readUrlList(filepath: string): string[] {
  const ext = path.extname(filepath).toLowerCase()
  if (!LIST_EXTS.has(ext)) {
    throw new Error(`Unsupported list file: ${ext || '(no extension)'}. Use .txt, .csv, .json, or .html.`)
  }

  const text = fs.readFileSync(filepath, 'utf-8')
  if (ext === '.html' || ext === '.htm') return urlsFromHtml(text)
  if (ext === '.json') {
    try {
      return urlsFromJson(text)
    } catch (err) {
      throw new Error(`Could not parse ${path.basename(filepath)} as JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (ext === '.csv' || ext === '.tsv') return urlsFromDelimited(text)
  return urlsFromText(text)
}

// ── Planning ────────────────────────────────────────────────────────────────

interface PlanContext {
  rawDir: string
  includeMedia: boolean
  raw: RawIndex
  ledger: ImportLedger
  knownUrls: Set<string>
  seenHashes: Map<string, string>
  seenUrls: Set<string>
}

function planFile(
  filepath: string,
  relative: string | null,
  fromFolder: boolean,
  ctx: PlanContext,
): ImportFileItem | null {
  const ext = path.extname(filepath).toLowerCase()
  const label = path.basename(filepath)
  let bytes = 0
  try {
    bytes = fs.statSync(filepath).size
  } catch {
    return { kind: 'file', source: filepath, label, relative, bytes: 0, target: label, status: 'invalid', reason: 'not readable' }
  }

  if (!SUPPORTED_EXTS.includes(ext)) {
    return fromFolder
      ? null
      : { kind: 'file', source: filepath, label, relative, bytes, target: label, status: 'unsupported', reason: `unsupported type ${ext || '(none)'}` }
  }

  if (fromFolder && !ctx.includeMedia && MEDIA_EXTS.has(ext)) return null
  if (isInside(ctx.rawDir, filepath)) {
    return { kind: 'file', source: filepath, label, relative, bytes, target: label, status: 'duplicate', reason: 'already in raw/' }
  }

  let hash: string
  try {
    hash = computeHash(filepath)
  } catch {
    return { kind: 'file', source: filepath, label, relative, bytes, target: label, status: 'invalid', reason: 'not readable' }
  }

  const existing = ctx.raw.hashes.get(hash)
  if (existing) {
    return { kind: 'file', source: filepath, label, relative, bytes, target: existing, status: 'duplicate', reason: `same content as ${existing}` }
  }

  const earlier = ctx.seenHashes.get(hash)
  if (earlier) {
    return { kind: 'file', source: filepath, label, relative, bytes, target: earlier, status: 'duplicate', reason: `duplicate of ${earlier} in this import` }
  }

  const target = uniqueName(ctx.raw.names, label)
  ctx.raw.names.add(target)
  ctx.seenHashes.set(hash, target)

  return { kind: 'file', source: filepath, label, relative, bytes, target, status: 'ready' }
}

function planUrl(raw: string, ctx: PlanContext): ImportUrlItem | null {
  let url: string
  try {
    url = normalizeUrl(raw)
  } catch (err) {
    return {
      kind: 'url',
      source: raw.trim(),
      label: raw.trim(),
      status: 'invalid',
      reason: err instanceof Error ? err.message : String(err),
    }
  }

  if (ctx.seenUrls.has(url)) return null
  ctx.seenUrls.add(url)

  const item: ImportUrlItem = { kind: 'url', source: url, label: url, status: 'ready' }

  const recorded = ctx.ledger.urls[url]
  if (recorded && fs.existsSync(path.join(ctx.rawDir, recorded.filename))) {
    item.status = 'duplicate'
    item.reason = `already imported as ${recorded.filename}`
    return item
  }

  if (ctx.knownUrls.has(url)) {
    item.status = 'duplicate'
    item.reason = 'already clipped into raw/'
    return item
  }

  return item
}

function emptyPlan(): ImportPlan {
  return {
    items: [],
    ready: 0,
    duplicates: 0,
    unsupported: 0,
    invalid: 0,
    fileCount: 0,
    urlCount: 0,
    totalBytes: 0,
    truncatedUrls: 0,
    truncatedFiles: 0,
  }
}

function summarize(plan: ImportPlan): ImportPlan {
  plan.items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'file' ? -1 : 1
    if (a.status !== b.status) {
      const order: ImportStatus[] = ['ready', 'duplicate', 'unsupported', 'invalid']
      return order.indexOf(a.status) - order.indexOf(b.status)
    }
    return a.label.localeCompare(b.label)
  })

  for (const item of plan.items) {
    if (item.status === 'ready') plan.ready += 1
    else if (item.status === 'duplicate') plan.duplicates += 1
    else if (item.status === 'unsupported') plan.unsupported += 1
    else plan.invalid += 1

    if (item.kind === 'file') {
      plan.fileCount += 1
      if (item.status === 'ready') plan.totalBytes += item.bytes
    } else {
      plan.urlCount += 1
    }
  }

  return plan
}

/**
 * Decides what would happen, without touching the wiki. Safe to call on a
 * read-only server.
 */
export function planImport(config: AxiomConfig, request: ImportRequest = {}): ImportPlan {
  const plan = emptyPlan()
  const ctx: PlanContext = {
    rawDir: config.rawDir,
    includeMedia: request.includeMedia ?? false,
    raw: buildRawIndex(config.rawDir),
    ledger: loadLedger(config.wikiDir),
    knownUrls: knownClippedUrls(config.rawDir),
    seenHashes: new Map(),
    seenUrls: new Set(),
  }

  const fileLimit = request.fileLimit ?? DEFAULT_FILE_LIMIT
  let fileCount = 0

  for (const input of request.paths ?? []) {
    const trimmed = input.trim()
    if (!trimmed) continue
    const target = path.resolve(expandHome(trimmed))

    if (!fs.existsSync(target)) {
      plan.items.push({
        kind: 'file',
        source: target,
        label: path.basename(target) || target,
        relative: null,
        bytes: 0,
        target: path.basename(target) || target,
        status: 'invalid',
        reason: 'path not found',
      })
      continue
    }

    let stat: fs.Stats
    try {
      stat = fs.statSync(target)
    } catch {
      plan.items.push({
        kind: 'file',
        source: target,
        label: path.basename(target),
        relative: null,
        bytes: 0,
        target: path.basename(target),
        status: 'invalid',
        reason: 'not readable',
      })
      continue
    }

    const files = stat.isDirectory()
      ? walkFolder(target, ctx.includeMedia)
      : [{ filepath: target, relative: null }]

    for (const entry of files) {
      if (fileCount >= fileLimit) {
        plan.truncatedFiles += 1
        continue
      }
      const item = planFile(entry.filepath, entry.relative, stat.isDirectory(), ctx)
      fileCount += 1
      if (item) plan.items.push(item)
    }
  }

  const listUrls: string[] = []
  for (const list of request.from ?? []) {
    const trimmed = list.trim()
    if (!trimmed) continue
    const filepath = path.resolve(expandHome(trimmed))
    try {
      listUrls.push(...readUrlList(filepath))
    } catch (err) {
      plan.items.push({
        kind: 'url',
        source: filepath,
        label: path.basename(filepath),
        status: 'invalid',
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const allUrls = [...listUrls, ...(request.urls ?? [])]
  const urlLimit = request.urlLimit ?? DEFAULT_URL_LIMIT
  let urlCount = 0

  for (const raw of allUrls) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (urlCount >= urlLimit) {
      plan.truncatedUrls += 1
      continue
    }
    urlCount += 1
    const item = planUrl(trimmed, ctx)
    if (item) plan.items.push(item)
  }

  return summarize(plan)
}

// ── Execution ───────────────────────────────────────────────────────────────

function stageFile(config: AxiomConfig, item: ImportFileItem, move: boolean): ImportedSource {
  if (!fs.existsSync(item.source)) {
    return { item, filename: item.target, ok: false, error: 'source disappeared before import' }
  }

  fs.mkdirSync(config.rawDir, { recursive: true })
  const taken = new Set(fs.readdirSync(config.rawDir))
  const filename = uniqueName(taken, item.target)
  const destination = path.join(config.rawDir, filename)

  if (move) {
    try {
      fs.renameSync(item.source, destination)
      return { item, filename, ok: true, moved: true }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EXDEV') throw err
      // Different filesystem: fall through to copy + remove.
    }
  }

  fs.copyFileSync(item.source, destination, fs.constants.COPYFILE_EXCL)
  if (move) fs.rmSync(item.source, { force: true })
  return { item, filename, ok: true, moved: move }
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortIngestError()
}

/**
 * Executes a plan: copies or clips ready items into `raw/`, then compiles them
 * through the normal ingest pipeline. Never holds the compilation lock itself —
 * `ingest` does.
 */
export async function runImport(
  config: AxiomConfig,
  request: ImportRunRequest = {},
  hooks: ImportHooks = {},
): Promise<ImportRunResult> {
  const { onStatus, signal } = hooks
  const status = (line: string) => onStatus?.(line)

  const plan = planImport(config, request)
  const ready = plan.items.filter((item) => item.status === 'ready')

  if (ready.length === 0) {
    status(
      plan.items.length === 0
        ? 'Nothing to import — no paths or URLs were given.'
        : 'Nothing new to import.',
    )
    return { plan, staged: [], ingest: null, summary: 'Nothing new to import.' }
  }

  const staged: ImportedSource[] = []
  const ledger = loadLedger(config.wikiDir)
  let ledgerDirty = false

  for (const item of ready) {
    abortIfNeeded(signal)

    try {
      if (item.kind === 'file') {
        status(`Staging ${item.label}…`)
        staged.push(stageFile(config, item, request.move ?? false))
        continue
      }

      status(`Clipping ${item.source}…`)
      const clipped = await clipUrl(item.source, config.rawDir, { onStatus: status })
      abortIfNeeded(signal)
      ledger.urls[item.source] = { filename: clipped.filename, at: new Date().toISOString() }
      ledgerDirty = true
      staged.push({ item, filename: clipped.filename, ok: true })
      status(`  saved as ${clipped.filename}`)
    } catch (err) {
      if (err instanceof AbortIngestError) throw err
      staged.push({
        item,
        filename: item.kind === 'file' ? item.target : item.source,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (ledgerDirty) saveLedger(config.wikiDir, ledger)

  const ok = staged.filter((entry) => entry.ok)
  const failed = staged.length - ok.length
  status(`Staged ${ok.length} source${ok.length === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`)

  let ingested: IngestRunResult | null = null
  if (request.ingest !== false && ok.length > 0) {
    abortIfNeeded(signal)
    ingested = await ingest(
      config,
      { all: true, context: request.context },
      { onStatus: status, signal },
    )
  }

  const summary = ingested
    ? `${ok.length} staged; ${ingested.summary}`
    : `${ok.length} staged${failed ? `, ${failed} failed` : ''}; not compiled.`

  return { plan, staged, ingest: ingested, summary }
}

// ── Presentation ────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function describe(item: ImportItem): string {
  if (item.kind === 'file') return item.relative ?? item.label
  return item.source
}

/** Human-readable plan, used by the CLI. */
export function formatImportPlan(plan: ImportPlan): string {
  const lines: string[] = []
  const counts = [
    `${plan.ready} ready`,
    `${plan.duplicates} duplicate${plan.duplicates === 1 ? '' : 's'}`,
    `${plan.unsupported} unsupported`,
    `${plan.invalid} invalid`,
  ].join(', ')

  lines.push(`Import plan — ${counts}`)

  const ready = plan.items.filter((item) => item.status === 'ready')
  const fileReady = ready.filter((item) => item.kind === 'file')
  const urlReady = ready.filter((item) => item.kind === 'url')

  if (fileReady.length > 0) {
    lines.push(`  files: ${fileReady.length} (${formatBytes(plan.totalBytes)})`)
    for (const item of fileReady.slice(0, MAX_PREVIEW)) {
      lines.push(`    + ${describe(item)}`)
    }
    if (fileReady.length > MAX_PREVIEW) lines.push(`    … and ${fileReady.length - MAX_PREVIEW} more`)
  }

  if (urlReady.length > 0) {
    lines.push(`  urls: ${urlReady.length}`)
    for (const item of urlReady.slice(0, MAX_PREVIEW)) {
      lines.push(`    + ${describe(item)}`)
    }
    if (urlReady.length > MAX_PREVIEW) lines.push(`    … and ${urlReady.length - MAX_PREVIEW} more`)
  }

  const skipped = plan.items.filter((item) => item.status !== 'ready')
  if (skipped.length > 0) {
    lines.push('  skipped:')
    for (const item of skipped.slice(0, MAX_PREVIEW)) {
      lines.push(`    - ${describe(item)} — ${item.reason ?? item.status}`)
    }
    if (skipped.length > MAX_PREVIEW) lines.push(`    … and ${skipped.length - MAX_PREVIEW} more`)
  }

  if (plan.truncatedUrls > 0) {
    lines.push(`  ${plan.truncatedUrls} more URL${plan.truncatedUrls === 1 ? '' : 's'} not included — raise --limit.`)
  }
  if (plan.truncatedFiles > 0) {
    lines.push(`  ${plan.truncatedFiles} more file${plan.truncatedFiles === 1 ? '' : 's'} not included — raise --file-limit.`)
  }

  return lines.join('\n')
}

export { DEFAULT_FILE_LIMIT, DEFAULT_URL_LIMIT }
