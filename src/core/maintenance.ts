import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

import type { AxiomConfig } from '../config/index.js'
import { buildLinkIndex, findUnlinkedMentions, linkFirstMentionInBody, type PageLinkEntry } from './links.js'
import { buildWikiSnapshot, type WikiSnapshot } from './snapshot.js'
import {
  PAGE_CATEGORIES,
  idFromPagePath,
  isValidPageId,
  pagePathForId,
} from './page-ops.js'
import { acquireLock, getLockInfo, releaseLock } from './lock.js'
import { appendLog, updateIndex, updateMOC } from './wiki.js'
import { indexWikiPage, persistOrama } from './indexing.js'
import { commitPaths } from './git.js'

/**
 * Deterministic wiki maintenance.
 *
 * The tagline is "the wiki that maintains itself", but the useful maintenance
 * is not an LLM rewriting prose: it is the handful of mechanical chores that
 * nobody remembers to do. This module finds them and fixes the safe ones:
 *
 *   - pages with no summary get an extractive one from their own body
 *   - orphans get an inbound link from a page that already mentions them
 *     (or, failing that, a related page that shares tags)
 *   - dead links can become stub pages, opt-in
 *   - duplicate-looking pages are proposed, never merged automatically
 *
 * `planMaintenance` and `applyMaintenance` are filesystem-only, like
 * `page-ops`: the caller owns the compilation lock and derived artifacts.
 * `runMaintenance` is the higher-level entry point that adds both.
 */

export interface MaintenanceOptions {
  /** Maximum items considered per category. Default 25. */
  limit?: number
  /** Backfill missing summaries. Default true. */
  summaries?: boolean
  /** Propose inbound links for orphan pages. Default true. */
  links?: boolean
  /** Propose duplicate pages. Default true. */
  duplicates?: boolean
  /** Report dead-link targets. Default true. */
  deadLinks?: boolean
  /** Report pages with no tags. Default true. */
  tags?: boolean
}

export interface SummaryFix {
  id: string
  title: string
  /** The summary that will be written. */
  summary: string
}

export interface StaleSummary {
  id: string
  title: string
  current: string
  proposed: string
}

export interface LinkFix {
  /** The orphan that needs an inbound link. */
  id: string
  title: string
  /** The page that will link to it. */
  from: string
  fromTitle: string
  /** `mention` wraps an existing mention; `related` appends a Related bullet. */
  mode: 'mention' | 'related'
  snippet: string
}

export interface DuplicatePair {
  a: string
  b: string
  aTitle: string
  bTitle: string
  similarity: number
  reason: 'same-title' | 'similar-title'
}

export interface DeadLinkTarget {
  to: string
  /** Pages that reference the missing target. */
  from: string[]
  /** Whether the target id is safe to materialise as a stub. */
  creatable: boolean
}

export interface MissingTag {
  id: string
  title: string
}

export interface MaintenancePlan {
  generatedAt: string
  counts: {
    pages: number
    summaries: number
    staleSummaries: number
    orphans: number
    orphanLinks: number
    duplicates: number
    deadLinks: number
    pagesWithoutTags: number
  }
  summaries: SummaryFix[]
  staleSummaries: StaleSummary[]
  /** All orphan ids (inbox notes excluded). */
  orphans: string[]
  orphanLinks: LinkFix[]
  duplicates: DuplicatePair[]
  deadLinks: DeadLinkTarget[]
  pagesWithoutTags: MissingTag[]
}

export interface ApplyOptions extends MaintenanceOptions {
  /** Also rewrite summaries that share no content words with the body. Default false. */
  refreshStale?: boolean
  /** Create a stub page for safe dead-link targets. Default false. */
  createStubs?: boolean
  /** Use bare `[[slug]]` links instead of `[[category/slug]]`. */
  obsidianCompat?: boolean
}

export interface ApplyResult {
  touched: string[]
  created: string[]
  summaries: number
  staleSummaries: number
  links: number
  stubs: number
  skipped: Array<{ id: string; reason: string }>
}

const DEFAULT_LIMIT = 25
const MAX_SUMMARY = 200
const DUPLICATE_THRESHOLD = 0.8

const TITLE_STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'in', 'on', 'to', 'for', 'with', 'vs', 'versus', 'or',
])

const SUMMARY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in',
  'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was',
  'were', 'which', 'with', 'page', 'summary',
])

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(value as number), 1), 200)
}

function writeAtomic(abs: string, content: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const tmp = `${abs}.tmp`
  fs.writeFileSync(tmp, content, 'utf-8')
  fs.renameSync(tmp, abs)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Strips Markdown syntax and returns the first sentences of a page body. */
export function deriveSummary(body: string, max = MAX_SUMMARY): string {
  const text = body
    // A leading H1 is the page title, already shown next to the summary.
    .replace(/^\s*#\s+.*(?:\r?\n)+/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\^\[[^\]]*\]/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return ''
  if (text.length <= max) return text

  const cut = text.slice(0, max)
  const sentenceEnd = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('? '),
    cut.lastIndexOf('! '),
  )
  if (sentenceEnd > max * 0.4) return cut.slice(0, sentenceEnd + 1)

  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max).trim()}…`
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleTokens(title: string): Set<string> {
  const tokens = normalizeTitle(title)
    .split(' ')
    .filter((token) => token.length > 1 && !TITLE_STOPWORDS.has(token))
  return new Set(tokens)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !SUMMARY_STOPWORDS.has(word)),
  )
}

/** True when a summary shares no content word with the body — a stale smell. */
function looksStale(summary: string, body: string): boolean {
  const summaryWords = contentWords(summary)
  if (summaryWords.size < 4) return false
  const bodyWords = contentWords(body)
  if (bodyWords.size === 0) return false
  for (const word of summaryWords) if (bodyWords.has(word)) return false
  return true
}

/** Produces the plan from one snapshot and one link-index pass. */
export function planMaintenance(
  wikiDir: string,
  options: MaintenanceOptions = {},
  context: { snapshot?: WikiSnapshot; index?: Map<string, PageLinkEntry> } = {},
): MaintenancePlan {
  const limit = clampLimit(options.limit)
  const wantSummaries = options.summaries !== false
  const wantLinks = options.links !== false
  const wantDuplicates = options.duplicates !== false
  const wantDeadLinks = options.deadLinks !== false
  const wantTags = options.tags !== false

  const snapshot = context.snapshot ?? buildWikiSnapshot(wikiDir)
  const index = context.index ?? buildLinkIndex(wikiDir)

  const summaries: SummaryFix[] = []
  const staleSummaries: StaleSummary[] = []
  const pagesWithoutTags: MissingTag[] = []

  for (const page of snapshot.pages) {
    const id = idFromPagePath(page.path)
    const entry = index.get(id)
    const body = entry?.body ?? ''

    if (wantSummaries && !page.summary.trim()) {
      const summary = deriveSummary(body)
      if (summary) summaries.push({ id, title: page.title, summary })
    } else if (wantSummaries && page.summary.trim() && looksStale(page.summary, body)) {
      const summary = deriveSummary(body)
      if (summary && summary !== page.summary) {
        staleSummaries.push({
          id,
          title: page.title,
          current: page.summary,
          proposed: summary,
        })
      }
    }

    if (wantTags && page.tags.length === 0) {
      pagesWithoutTags.push({ id, title: page.title })
    }
  }

  const orphans = snapshot.graph.orphans
    .filter((id) => !id.startsWith('inbox/'))
    .filter((id) => index.get(id)?.category !== 'inbox')

  const orphanLinks: LinkFix[] = []
  if (wantLinks) {
    const rank = new Map(snapshot.rankedIds.map((id, position) => [id, position]))
    for (const orphanId of orphans.slice(0, limit)) {
      const fix = proposeInboundLink(wikiDir, orphanId, index, rank)
      if (fix) orphanLinks.push(fix)
    }
  }

  const duplicates = wantDuplicates ? findDuplicates(index) : []

  const deadLinks: DeadLinkTarget[] = []
  if (wantDeadLinks) {
    const grouped = new Map<string, string[]>()
    for (const link of snapshot.graph.deadLinks) {
      const referrers = grouped.get(link.to) ?? []
      if (referrers.length < 5) referrers.push(link.from)
      grouped.set(link.to, referrers)
    }
    for (const [to, from] of grouped.entries()) {
      deadLinks.push({ to, from, creatable: isValidPageId(to) && !fs.existsSync(pagePathAbs(wikiDir, to)) })
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      pages: snapshot.pages.length,
      summaries: summaries.length,
      staleSummaries: staleSummaries.length,
      orphans: orphans.length,
      orphanLinks: orphanLinks.length,
      duplicates: duplicates.length,
      deadLinks: deadLinks.length,
      pagesWithoutTags: pagesWithoutTags.length,
    },
    summaries: summaries.slice(0, limit),
    staleSummaries: staleSummaries.slice(0, limit),
    orphans,
    orphanLinks,
    duplicates: duplicates.slice(0, limit),
    deadLinks: deadLinks.slice(0, limit),
    pagesWithoutTags: pagesWithoutTags.slice(0, limit),
  }
}

function pagePathAbs(wikiDir: string, id: string): string {
  return path.join(wikiDir, pagePathForId(id))
}

function proposeInboundLink(
  wikiDir: string,
  orphanId: string,
  index: Map<string, PageLinkEntry>,
  rank: Map<string, number>,
): LinkFix | null {
  const target = index.get(orphanId)
  if (!target) return null

  const mentions = findUnlinkedMentions(wikiDir, orphanId, index)
    .filter((mention) => !mention.id.startsWith('inbox/'))
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        b.mentions - a.mentions ||
        a.id.localeCompare(b.id),
    )

  const best = mentions[0]
  if (best) {
    return {
      id: orphanId,
      title: target.title,
      from: best.id,
      fromTitle: best.title,
      mode: 'mention',
      snippet: best.snippet,
    }
  }

  // No prose mention. Fall back to a related page that shares tags, preferring
  // well-connected pages and same-category neighbours.
  const targetTags = new Set(
    target.tags.map((tag) => tag.toLowerCase()).filter((tag) => tag !== 'inbox'),
  )
  if (targetTags.size === 0) return null

  const candidates: Array<{ page: PageLinkEntry; score: number }> = []
  for (const page of index.values()) {
    if (page.id === orphanId) continue
    if (page.id.startsWith('inbox/') || page.category === 'inbox') continue
    if (page.links.includes(orphanId)) continue

    const shared = page.tags.filter((tag) => targetTags.has(tag.toLowerCase())).length
    if (shared === 0) continue

    const sameCategory = page.category === target.category ? 1 : 0
    const hub = Math.max(0, 3 - (rank.get(page.id) ?? 100) / 25)
    candidates.push({ page, score: shared * 3 + sameCategory + hub })
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.page.id.localeCompare(b.page.id),
  )
  const winner = candidates[0]?.page
  if (!winner) return null

  return {
    id: orphanId,
    title: target.title,
    from: winner.id,
    fromTitle: winner.title,
    mode: 'related',
    snippet: '',
  }
}

function findDuplicates(index: Map<string, PageLinkEntry>): DuplicatePair[] {
  const pages = [...index.values()]
    .filter((page) => !page.id.startsWith('inbox/') && page.category !== 'inbox')
    .map((page) => ({
      page,
      normalized: normalizeTitle(page.title),
      tokens: titleTokens(page.title),
    }))
    .filter((entry) => entry.normalized.length > 0)

  const pairs: DuplicatePair[] = []
  const seen = new Set<string>()

  const addPair = (
    a: (typeof pages)[number],
    b: (typeof pages)[number],
    similarity: number,
    reason: DuplicatePair['reason'],
  ) => {
    const key = a.page.id < b.page.id ? `${a.page.id}|${b.page.id}` : `${b.page.id}|${a.page.id}`
    if (seen.has(key)) return
    seen.add(key)
    pairs.push({
      a: a.page.id,
      b: b.page.id,
      aTitle: a.page.title,
      bTitle: b.page.title,
      similarity,
      reason,
    })
  }

  // Exact title groups are the strongest signal and cost one pass.
  const byTitle = new Map<string, Array<(typeof pages)[number]>>()
  for (const entry of pages) {
    const group = byTitle.get(entry.normalized) ?? []
    group.push(entry)
    byTitle.set(entry.normalized, group)
  }
  for (const group of byTitle.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i]
        const b = group[j]
        if (a && b) addPair(a, b, 1, 'same-title')
      }
    }
  }

  // Near-duplicates only need comparing pages that share a title token.
  const postings = new Map<string, number[]>()
  pages.forEach((entry, position) => {
    for (const token of entry.tokens) {
      const list = postings.get(token) ?? []
      list.push(position)
      postings.set(token, list)
    }
  })

  for (let i = 0; i < pages.length; i += 1) {
    const a = pages[i]
    if (!a || a.tokens.size < 2) continue

    const candidates = new Set<number>()
    for (const token of a.tokens) {
      for (const position of postings.get(token) ?? []) {
        if (position > i) candidates.add(position)
      }
    }

    for (const position of candidates) {
      const b = pages[position]
      if (!b || b.tokens.size < 2) continue
      const score = jaccard(a.tokens, b.tokens)
      if (score >= DUPLICATE_THRESHOLD) {
        addPair(a, b, Number(score.toFixed(2)), 'similar-title')
      }
    }
  }

  return pairs.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      a.a.localeCompare(b.a) ||
      a.b.localeCompare(b.b),
  )
}

/**
 * Appends a Related bullet, or adds to an existing `## Related` section.
 * Kept as text surgery so the rest of the author's Markdown is untouched.
 */
export function appendRelatedLink(body: string, link: string): string {
  const heading = /^##\s+Related\s*$/im.exec(body)
  if (!heading) {
    return `${body.replace(/\s+$/, '')}\n\n## Related\n\n- ${link}\n`
  }

  const afterHeading = heading.index + heading[0].length
  const rest = body.slice(afterHeading)
  const nextHeading = /^##\s+/m.exec(rest)
  const sectionEnd = nextHeading ? afterHeading + nextHeading.index : body.length
  const section = body.slice(afterHeading, sectionEnd).replace(/\s+$/, '')
  const insertion = section.trim().length > 0 ? `${section}\n- ${link}` : `\n- ${link}`
  const merged = `${body.slice(0, afterHeading)}${insertion}\n\n${body.slice(sectionEnd)}`
  return `${merged.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`
}

function rewriteSummary(raw: string, summary: string): string {
  const parsed = matter(raw)
  const data = { ...parsed.data, summary, updatedAt: today() }
  return matter.stringify(parsed.content.replace(/^\n+/, ''), data)
}

function rewriteBody(raw: string, body: string): string {
  const parsed = matter(raw)
  const data = { ...parsed.data, updatedAt: today() }
  return matter.stringify(body.replace(/^\n+/, ''), data)
}

/** Applies the safe parts of a plan. The caller owns the lock and derived files. */
export function applyMaintenance(
  wikiDir: string,
  plan: MaintenancePlan,
  options: ApplyOptions = {},
): ApplyResult {
  const limit = clampLimit(options.limit)
  const targetIndex = buildLinkIndex(wikiDir)
  const result: ApplyResult = {
    touched: [],
    created: [],
    summaries: 0,
    staleSummaries: 0,
    links: 0,
    stubs: 0,
    skipped: [],
  }
  const touched = new Set<string>()

  const summaryFixes =
    options.summaries === false
      ? []
      : plan.summaries.slice(0, limit).map((fix) => ({ ...fix, stale: false }))
  const staleFixes =
    options.summaries === false || !options.refreshStale
      ? []
      : plan.staleSummaries
          .slice(0, limit)
          .map((fix) => ({ id: fix.id, summary: fix.proposed, stale: true }))

  for (const fix of [...summaryFixes, ...staleFixes]) {
    const abs = pagePathAbs(wikiDir, fix.id)
    if (!fs.existsSync(abs)) {
      result.skipped.push({ id: fix.id, reason: 'page disappeared' })
      continue
    }
    const raw = fs.readFileSync(abs, 'utf-8')
    const current = String(matter(raw).data['summary'] ?? '').trim()
    if (!fix.summary) {
      result.skipped.push({ id: fix.id, reason: 'nothing to summarise' })
      continue
    }
    if (!fix.stale && current) {
      result.skipped.push({ id: fix.id, reason: 'already has a summary' })
      continue
    }
    writeAtomic(abs, rewriteSummary(raw, fix.summary))
    touched.add(fix.id)
    if (fix.stale) result.staleSummaries += 1
    else result.summaries += 1
  }

  const linkFixes = options.links === false ? [] : plan.orphanLinks.slice(0, limit)
  for (const fix of linkFixes) {
    const target = targetIndex.get(fix.id)
    if (!target) {
      result.skipped.push({ id: fix.id, reason: 'target disappeared' })
      continue
    }

    const abs = pagePathAbs(wikiDir, fix.from)
    if (!fs.existsSync(abs)) {
      result.skipped.push({ id: fix.id, reason: 'adopter disappeared' })
      continue
    }

    const raw = fs.readFileSync(abs, 'utf-8')
    const parsed = matter(raw)
    const adopter = targetIndex.get(fix.from)
    if (adopter?.links.includes(fix.id)) {
      result.skipped.push({ id: fix.id, reason: 'already linked' })
      continue
    }

    const linkText = options.obsidianCompat ? (fix.id.split('/').pop() ?? fix.id) : fix.id
    let body = parsed.content
    let changed = false

    if (fix.mode === 'mention') {
      const rewritten = linkFirstMentionInBody(body, target, linkText)
      body = rewritten.body
      changed = rewritten.changed
    }

    if (!changed) {
      if (parsed.content.includes(`[[${linkText}`) || parsed.content.includes(`[[${fix.id}`)) {
        result.skipped.push({ id: fix.id, reason: 'already linked' })
        continue
      }
      body = appendRelatedLink(body, `[[${linkText}|${target.title}]]`)
      changed = true
    }

    writeAtomic(abs, rewriteBody(raw, body))
    touched.add(fix.from)
    result.links += 1
  }

  if (options.createStubs) {
    for (const dead of plan.deadLinks) {
      if (!dead.creatable) continue
      const abs = pagePathAbs(wikiDir, dead.to)
      if (fs.existsSync(abs)) continue

      const category = dead.to.split('/')[0]
      if (!(PAGE_CATEGORIES as readonly string[]).includes(category) || category === 'inbox') {
        result.skipped.push({ id: dead.to, reason: 'unknown category' })
        continue
      }

      const title = (dead.to.split('/').pop() ?? dead.to)
        .split('-')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      const content = matter.stringify(
        `# ${title}\n\n_Stub created by maintenance. A page linked here did not exist yet._\n`,
        {
          title,
          summary: `Stub for ${title}, linked from ${dead.from.length} page(s).`,
          tags: ['stub'],
          category,
          updatedAt: today(),
        },
      )
      writeAtomic(abs, content)
      result.created.push(dead.to)
      result.stubs += 1
    }
  }

  result.touched = [...touched]
  return result
}

// ── Running the whole pass ─────────────────────────────────────────────────

export interface MaintenanceRunOptions extends ApplyOptions {
  apply?: boolean
  /** Refresh caches after a successful write. */
  onWrite?: () => void
}

export type MaintenanceRun =
  | { status: 'busy'; pid: number | null }
  | {
      status: 'ok'
      plan: MaintenancePlan
      applied: ApplyResult | null
      committed: boolean
    }

/**
 * Plans, optionally applies, then rebuilds the derived artifacts and commits.
 * Shared by the CLI, the web action, and the scheduled server pass.
 */
export async function runMaintenance(
  config: AxiomConfig,
  options: MaintenanceRunOptions = {},
): Promise<MaintenanceRun> {
  if (!options.apply) {
    const plan = planMaintenance(config.wikiDir, options)
    return { status: 'ok', plan, applied: null, committed: false }
  }

  // A live holder blocks maintenance even when it is this process: ingest jobs
  // run in the same server, and the PID lock is otherwise re-entrant.
  const existing = getLockInfo(config.wikiDir)
  if (existing.locked) {
    return { status: 'busy', pid: existing.info?.pid ?? null }
  }
  if (!acquireLock(config.wikiDir)) {
    return { status: 'busy', pid: getLockInfo(config.wikiDir).info?.pid ?? null }
  }

  try {
    // Plan under the lock so the corpus cannot change between the decision and
    // the write.
    const plan = planMaintenance(config.wikiDir, options)
    const applied = applyMaintenance(config.wikiDir, plan, options)
    const changed = applied.summaries + applied.staleSummaries + applied.links + applied.stubs
    if (changed === 0) {
      return { status: 'ok', plan, applied, committed: false }
    }

    await updateIndex(config.wikiDir)
    await updateMOC(config.wikiDir)
    await appendLog(
      config.wikiDir,
      `${applied.summaries} summaries, ${applied.staleSummaries} refreshed, ` +
        `${applied.links} links, ${applied.stubs} stubs`,
      'maintain',
    )
    options.onWrite?.()

    if (config.embeddings && config.embeddings.provider !== 'none') {
      for (const id of [...applied.touched, ...applied.created]) {
        try {
          await indexWikiPage(config, pagePathForId(id))
        } catch {
          // Indexing is best effort; the page stays readable without a vector.
        }
      }
      try {
        await persistOrama(config)
      } catch {
        // Persisting is best effort; the next reindex will catch up.
      }
    }

    const committed = commitPaths(
      config.wikiDir,
      ['wiki/pages', 'wiki/index.md', 'wiki/moc.md', 'wiki/log.md'],
      `Maintain wiki: ${applied.summaries} summaries, ${applied.staleSummaries} refreshed, ${applied.links} links, ${applied.stubs} stubs`,    )

    return { status: 'ok', plan, applied, committed }
  } finally {
    releaseLock(config.wikiDir)
  }
}

// ── Human-readable plan ────────────────────────────────────────────────────

export function formatMaintenancePlan(plan: MaintenancePlan): string {
  const { counts } = plan
  const lines: string[] = []
  lines.push(`Wiki maintenance plan — ${plan.generatedAt.slice(0, 10)}`)
  lines.push(
    `  ${counts.pages} pages · ${counts.summaries} missing summaries · ` +
      `${counts.staleSummaries} stale · ` +
      `${counts.orphans} orphans (${counts.orphanLinks} adoptable) · ` +
      `${counts.duplicates} duplicate pairs · ${counts.deadLinks} dead links · ` +
      `${counts.pagesWithoutTags} untagged`,
  )

  if (plan.summaries.length > 0) {
    lines.push('', 'Summaries')
    for (const fix of plan.summaries) {
      lines.push(`  ${fix.id} — “${fix.summary}”`)
    }
  }

  if (plan.staleSummaries.length > 0) {
    lines.push('', 'Possibly stale summaries (not applied by default)')
    for (const fix of plan.staleSummaries) {
      lines.push(`  ${fix.id} — “${fix.proposed}”`)
    }
  }

  if (plan.orphanLinks.length > 0) {
    lines.push('', 'Orphan links')
    for (const fix of plan.orphanLinks) {
      const how = fix.mode === 'mention' ? 'wraps a mention' : 'adds a Related bullet'
      lines.push(`  ${fix.id} ← ${fix.from} (${how})`)
    }
  }

  if (plan.duplicates.length > 0) {
    lines.push('', 'Duplicate candidates (review, never auto-merged)')
    for (const pair of plan.duplicates) {
      lines.push(`  ${pair.a} ≈ ${pair.b} (${Math.round(pair.similarity * 100)}%)`)
    }
  }

  if (plan.deadLinks.length > 0) {
    lines.push('', 'Dead links')
    for (const dead of plan.deadLinks) {
      const stub = dead.creatable ? ' (can create a stub)' : ''
      lines.push(`  ${dead.to} ← ${dead.from.join(', ')}${stub}`)
    }
  }

  if (plan.pagesWithoutTags.length > 0) {
    lines.push('', 'Pages without tags')
    for (const page of plan.pagesWithoutTags) {
      lines.push(`  ${page.id}`)
    }
  }

  return lines.join('\n')
}
