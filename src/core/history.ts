import { execFileSync } from 'child_process'

import { isGitRepo } from './git.js'

/**
 * Read-only git history for a single wiki page.
 *
 * Every write path already funnels through `autoCommit`, so the wiki's history
 * is the repository's history. Using `execFileSync` (not a shell string) keeps
 * rev arguments from ever being interpreted as shell syntax.
 */

export interface PageCommit {
  hash: string
  shortHash: string
  date: string
  author: string
  subject: string
}

export interface PageHistory {
  available: boolean
  reason?: string
  commits: PageCommit[]
}

const REV_RE = /^[0-9a-f]{7,40}$/i
const FIELD_SEP = '\u001f'
const RECORD_SEP = '\u001e'

function pagePathFor(pageId: string): string {
  return `wiki/pages/${pageId}.md`
}

function safeRev(rev: string): string | null {
  return REV_RE.test(rev) ? rev : null
}

function run(wikiDir: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: wikiDir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 8 * 1024 * 1024,
  })
}

/**
 * The path a page had at a given commit. `--follow` walks renames, so a commit
 * from before a rename still points at the old file name.
 */
function pagePathAtRevision(wikiDir: string, pageId: string, rev: string): string | null {
  const safe = safeRev(rev)
  if (!safe) return null
  try {
    const out = run(wikiDir, [
      'log',
      '--follow',
      '--name-only',
      '--format=\u001e%H',
      '--',
      pagePathFor(pageId),
    ])
    for (const block of out.split('\u001e')) {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (lines[0] !== safe) continue
      return lines[1] ?? null
    }
  } catch {
    // Fall through to the current path.
  }
  return null
}

export function getPageHistory(wikiDir: string, pageId: string, limit = 40): PageHistory {
  if (!isGitRepo(wikiDir)) {
    return { available: false, reason: 'This wiki is not a git repository.', commits: [] }
  }

  try {
    const out = run(wikiDir, [
      'log',
      '--follow',
      `--max-count=${String(limit)}`,
      `--format=%H${FIELD_SEP}%aI${FIELD_SEP}%an${FIELD_SEP}%s${RECORD_SEP}`,
      '--',
      pagePathFor(pageId),
    ])

    const commits = out
      .split(RECORD_SEP)
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash = '', date = '', author = '', subject = ''] = record.split(FIELD_SEP)
        return { hash, shortHash: hash.slice(0, 8), date, author, subject }
      })
      .filter((commit) => commit.hash)

    return { available: true, commits }
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
      commits: [],
    }
  }
}

/** The page's file content at a specific commit, or null when unavailable. */
export function getPageVersionAt(wikiDir: string, pageId: string, rev: string): string | null {
  const safe = safeRev(rev)
  if (!safe || !isGitRepo(wikiDir)) return null
  const historicalPath = pagePathAtRevision(wikiDir, pageId, safe) ?? pagePathFor(pageId)
  try {
    return run(wikiDir, ['show', `${safe}:${historicalPath}`])
  } catch {
    return null
  }
}

export interface PageDiff {
  rev: string
  patch: string
}

/** Unified diff introduced by `rev` for this page. */
export function getPageDiff(wikiDir: string, pageId: string, rev: string): PageDiff | null {
  const safe = safeRev(rev)
  if (!safe || !isGitRepo(wikiDir)) return null
  const historicalPath = pagePathAtRevision(wikiDir, pageId, safe) ?? pagePathFor(pageId)
  try {
    const patch = run(wikiDir, [
      'show',
      '--format=',
      '--no-color',
      '--patch',
      safe,
      '--',
      historicalPath,
    ])
    return { rev: safe, patch }
  } catch {
    return null
  }
}
