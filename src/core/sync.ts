import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { normalizePath, type ProjectSnapshot } from './mapper.js'

export interface MapPageEntry {
  slug: string
  title: string
  category: string
  description: string
  paths: string[]
  _lastVerifiedAt?: string
  _coveredCommit?: string
  _confidence?: number
}

export interface CodeChangeNotification {
  timestamp: string
  files: Array<{ path: string; type: 'created' | 'modified' | 'deleted' | 'renamed'; oldPath?: string }>
  description?: string
}

export interface MapState {
  version: 1
  createdAt: string
  lastSyncAt: string
  gitCommitHash: string | null
  pages: MapPageEntry[]
  pendingChanges?: CodeChangeNotification[]
}

export interface SyncAnalysis {
  changedFiles: string[]
  affectedPages: MapPageEntry[]
  stalePages: MapPageEntry[]
  uncoveredDirs: string[]
  unchangedPages: MapPageEntry[]
}

const MAP_STATE_FILENAME = 'map-state.json'

export function saveMapState(wikiDir: string, state: MapState): void {
  const filePath = path.join(wikiDir, MAP_STATE_FILENAME)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
}

export function loadMapState(wikiDir: string): MapState | null {
  const filePath = path.join(wikiDir, MAP_STATE_FILENAME)
  // Fallback for v0.1.x wikis that stored map-state under .axiom/
  const legacyPath = path.join(wikiDir, '.axiom', MAP_STATE_FILENAME)
  const resolvedPath = fs.existsSync(filePath) ? filePath
    : fs.existsSync(legacyPath) ? legacyPath : filePath
  try {
    if (!fs.existsSync(resolvedPath)) return null
    const raw = fs.readFileSync(resolvedPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1 || !Array.isArray(parsed?.pages)) return null
    return parsed as MapState
  } catch {
    return null
  }
}

export function getGitHeadHash(dir: string): string | null {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim()
  } catch {
    return null
  }
}

export function getGitChangedFiles(dir: string, sinceHash: string): string[] {
  try {
    const output = execSync(`git diff --name-only ${sinceHash}..HEAD`, {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    })
    return output.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

export function pageCoversFile(page: MapPageEntry, filePath: string): boolean {
  if (page.paths.length === 0) return false
  const normalized = page.paths.map(normalizePath)
  return normalized.some((p) =>
    p.endsWith('/') ? filePath.startsWith(p) : filePath === p
  )
}

function pageHasFilesInSnapshot(page: MapPageEntry, snapshot: ProjectSnapshot): boolean {
  if (page.paths.length === 0) return true
  const normalized = page.paths.map(normalizePath)
  return snapshot.files.some((f) =>
    normalized.some((p) =>
      p.endsWith('/') ? f.relPath.startsWith(p) : f.relPath === p
    )
  )
}

export function analyzeSync(
  state: MapState,
  changedFiles: string[],
  snapshot: ProjectSnapshot,
): SyncAnalysis {
  const affectedPages: MapPageEntry[] = []
  const stalePages: MapPageEntry[] = []
  const unchangedPages: MapPageEntry[] = []

  for (const page of state.pages) {
    // Overview page (paths=[]) is always refreshed
    if (page.paths.length === 0) {
      affectedPages.push(page)
      continue
    }

    // Check if all paths are gone
    if (!pageHasFilesInSnapshot(page, snapshot)) {
      stalePages.push(page)
      continue
    }

    // Check if any changed file falls within this page's paths
    const hasChanges = changedFiles.some((f) => pageCoversFile(page, f))
    if (hasChanges) {
      affectedPages.push(page)
    } else {
      unchangedPages.push(page)
    }
  }

  // Find top-level directories not covered by any page
  const coveredPrefixes = state.pages.flatMap((p) => p.paths.map(normalizePath))
  const topDirs = new Map<string, number>()
  for (const f of snapshot.files) {
    const topDir = f.relPath.split('/')[0]
    if (!topDir || !f.relPath.includes('/')) continue
    topDirs.set(topDir, (topDirs.get(topDir) ?? 0) + 1)
  }

  const uncoveredDirs: string[] = []
  for (const [dir, count] of topDirs) {
    if (count < 3) continue
    const dirPrefix = dir + '/'
    const covered = coveredPrefixes.some((p) =>
      p.startsWith(dirPrefix) || dirPrefix.startsWith(p)
    )
    if (!covered) uncoveredDirs.push(dir)
  }

  return { changedFiles, affectedPages, stalePages, uncoveredDirs, unchangedPages }
}

export function groupChangedFilesByDir(files: string[]): Array<{ dir: string; count: number }> {
  const dirs = new Map<string, number>()
  for (const f of files) {
    const dir = f.includes('/') ? f.split('/')[0]! : '.'
    dirs.set(dir, (dirs.get(dir) ?? 0) + 1)
  }
  return [...dirs.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([dir, count]) => ({ dir, count }))
}

// ── staleness tracking ───────────────────────────────────────────────────────

export function computeConfidence(page: MapPageEntry, changedFiles: string[]): number {
  const current = page._confidence ?? 1.0
  const touched = changedFiles.some((f) => pageCoversFile(page, f))
  if (!touched) return current
  return Math.max(0.1, current * 0.85)
}

export function updateStaleness(state: MapState, changedFiles: string[], currentCommit: string): MapState {
  for (const page of state.pages) {
    page._confidence = computeConfidence(page, changedFiles)
  }
  state.gitCommitHash = currentCommit || state.gitCommitHash
  return state
}

export function getStalePages(state: MapState, threshold = 0.5): MapPageEntry[] {
  return state.pages.filter((p) => (p._confidence ?? 1.0) < threshold)
}

export function markPageVerified(state: MapState, slug: string, commitHash: string): void {
  const page = state.pages.find((p) => p.slug === slug)
  if (!page) return
  page._lastVerifiedAt = new Date().toISOString().slice(0, 10)
  page._coveredCommit = commitHash
  page._confidence = 1.0
}
