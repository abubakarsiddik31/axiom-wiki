import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import matter from 'gray-matter'
import { getIngestedFromLog } from './sources.js'

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface SourceState {
  sha256: string
  lastIngestedAt: string
  sizeBytes: number
  concepts: string[]
  truncated: boolean
}

export interface CompilationState {
  version: 1
  sources: Record<string, SourceState>
  frozenSlugs: string[]
}

// ── Constants ───────────────────────────────────────────────────────────────

const STATE_FILENAME = 'state.json'

const EMPTY_STATE: CompilationState = {
  version: 1,
  sources: {},
  frozenSlugs: [],
}

// ── Core Functions ──────────────────────────────────────────────────────────

export function statePath(wikiDir: string): string {
  return path.join(wikiDir, STATE_FILENAME)
}

export function loadState(wikiDir: string): CompilationState {
  const fp = statePath(wikiDir)
  if (!fs.existsSync(fp)) return structuredClone(EMPTY_STATE)

  try {
    const raw = fs.readFileSync(fp, 'utf-8')
    const parsed = JSON.parse(raw) as CompilationState
    if (parsed.version !== 1) return structuredClone(EMPTY_STATE)
    // Ensure frozenSlugs always exists (older state files may lack it)
    if (!Array.isArray(parsed.frozenSlugs)) parsed.frozenSlugs = []
    return parsed
  } catch {
    // Corrupted state — back up and start fresh
    const bak = fp + '.bak'
    try { fs.copyFileSync(fp, bak) } catch { /* best effort */ }
    return structuredClone(EMPTY_STATE)
  }
}

export function saveState(wikiDir: string, state: CompilationState): void {
  const fp = statePath(wikiDir)
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  const tmp = fp + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
  fs.renameSync(tmp, fp)
}

export function computeHash(filepath: string): string {
  const data = fs.readFileSync(filepath)
  return crypto.createHash('sha256').update(data).digest('hex')
}

// ── Change Detection ────────────────────────────────────────────────────────

export type ChangeKind = 'new' | 'changed' | 'unchanged'

export interface FileChange {
  filename: string
  filepath: string
  kind: ChangeKind
}

/**
 * Classify raw source files against persisted state.
 * Returns only files that need processing (new + changed) plus a full list.
 */
export function detectChanges(
  rawDir: string,
  filenames: string[],
  state: CompilationState,
): FileChange[] {
  const changes: FileChange[] = []

  for (const filename of filenames) {
    const filepath = path.join(rawDir, filename)
    const currentHash = computeHash(filepath)
    const prev = state.sources[filename]

    if (!prev) {
      changes.push({ filename, filepath, kind: 'new' })
    } else if (prev.sha256 !== currentHash) {
      changes.push({ filename, filepath, kind: 'changed' })
    } else {
      changes.push({ filename, filepath, kind: 'unchanged' })
    }
  }

  return changes
}

/**
 * Update state for a single source after successful ingest.
 * `concepts` are the wiki page paths created/updated by this source.
 */
export function recordIngest(
  state: CompilationState,
  filename: string,
  filepath: string,
  concepts: string[],
  truncated = false,
): void {
  const stats = fs.statSync(filepath)
  state.sources[filename] = {
    sha256: computeHash(filepath),
    lastIngestedAt: new Date().toISOString().slice(0, 10),
    sizeBytes: stats.size,
    concepts,
    truncated,
  }
}

// ── Migration ───────────────────────────────────────────────────────────────

/**
 * Bootstrap state.json from an existing wiki's log.md.
 * Computes hashes for files still present in rawDir, and maps concepts by
 * scanning existing pages' `sources` frontmatter field.
 */
export function migrateFromLog(wikiDir: string, rawDir: string): CompilationState {
  const state = structuredClone(EMPTY_STATE)

  // 1. Get ingested filenames from log
  const logPath = path.join(wikiDir, 'wiki/log.md')
  const ingested = getIngestedFromLog(logPath)

  // 2. Build reverse map: source filename → concept page paths
  const sourceToPages = buildSourceToPages(wikiDir)

  // 3. For each ingested file still on disk, record its state
  for (const filename of ingested) {
    const filepath = path.join(rawDir, filename)
    if (!fs.existsSync(filepath)) continue

    const stats = fs.statSync(filepath)
    state.sources[filename] = {
      sha256: computeHash(filepath),
      lastIngestedAt: stats.mtime.toISOString().slice(0, 10),
      sizeBytes: stats.size,
      concepts: sourceToPages.get(filename) ?? [],
      truncated: false,
    }
  }

  saveState(wikiDir, state)
  return state
}

/**
 * Scan all wiki pages and build a map from source filename → page paths
 * by reading the `sources` field in each page's frontmatter.
 */
function buildSourceToPages(wikiDir: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const pagesDir = path.join(wikiDir, 'wiki/pages')
  if (!fs.existsSync(pagesDir)) return map

  const walk = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const files: string[] = []
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) files.push(...walk(full))
      else if (e.name.endsWith('.md')) files.push(full)
    }
    return files
  }

  for (const abs of walk(pagesDir)) {
    try {
      const raw = fs.readFileSync(abs, 'utf-8')
      const { data } = matter(raw)
      const sources: unknown = data['sources']
      if (!Array.isArray(sources)) continue

      const pagePath = path.relative(wikiDir, abs)
      for (const src of sources) {
        const filename = String(src)
        const existing = map.get(filename) ?? []
        existing.push(pagePath)
        map.set(filename, existing)
      }
    } catch {
      // Skip pages with invalid frontmatter
    }
  }

  return map
}
