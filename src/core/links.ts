import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

import { normalizeLinkId } from './graph.js'
import type { CompilationState } from './state.js'

/**
 * Link intelligence for a Markdown wiki.
 *
 * Everything here is derived from the corpus on demand rather than persisted:
 * pages are small, a personal wiki is hundreds (not millions) of files, and
 * derived data that can drift is worse than a few milliseconds of scanning.
 */

export interface PageLinkEntry {
  /** Internal id, e.g. `entities/alan-turing`. */
  id: string
  /** Path relative to the wiki root, e.g. `wiki/pages/entities/alan-turing.md`. */
  path: string
  title: string
  category: string
  tags: string[]
  aliases: string[]
  /** Frontmatter summary, used by related-page cards. */
  summary: string
  /** Normalized outbound wiki-link ids. */
  links: string[]
  /** Markdown body without frontmatter. */
  body: string
}

export interface UnlinkedMention {
  id: string
  title: string
  /** Short excerpt around the first mention, with the term left intact. */
  snippet: string
  mentions: number
}

export type RelatedReason = 'tag' | 'link' | 'co-citation' | 'mention'

export interface RelatedPage {
  id: string
  title: string
  summary: string
  score: number
  reasons: RelatedReason[]
  sharedTags: string[]
}

export interface LinkIntelligence {
  id: string
  title: string
  unlinked: UnlinkedMention[]
  related: RelatedPage[]
}

const MAX_SNIPPET = 180
const MIN_MENTION_LENGTH = 3

function walkPages(pagesDir: string): string[] {
  const files: string[] = []
  if (!fs.existsSync(pagesDir)) return files
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) files.push(full)
    }
  }
  walk(pagesDir)
  return files
}

/** One pass over `wiki/pages` producing every entry keyed by id. */
export function buildLinkIndex(wikiDir: string): Map<string, PageLinkEntry> {
  const pagesDir = path.join(wikiDir, 'wiki/pages')
  const index = new Map<string, PageLinkEntry>()

  for (const abs of walkPages(pagesDir)) {
    let raw: string
    try {
      raw = fs.readFileSync(abs, 'utf-8')
    } catch {
      continue
    }

    let data: Record<string, unknown> = {}
    let body = raw
    try {
      const parsed = matter(raw)
      data = parsed.data as Record<string, unknown>
      body = parsed.content
    } catch {
      // Malformed frontmatter still counts as a page for mention purposes.
    }

    const rel = path.relative(wikiDir, abs).split(path.sep).join('/')
    const id = rel.replace(/^wiki\/pages\//, '').replace(/\.md$/, '')
    const tags = Array.isArray(data['tags']) ? (data['tags'] as unknown[]).map(String) : []
    const aliases = Array.isArray(data['aliases']) ? (data['aliases'] as unknown[]).map(String) : []

    index.set(id, {
      id,
      path: rel,
      title: String(data['title'] ?? path.basename(abs, '.md')),
      category: String(data['category'] ?? id.split('/')[0] ?? ''),
      tags,
      aliases,
      summary: String(data['summary'] ?? ''),
      links: extractLinkIds(body),
      body,
    })
  }

  return index
}

export function extractLinkIds(body: string): string[] {
  const links = new Set<string>()
  const re = /\[\[([^\]]+)\]\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null) {
    const raw = match[1]?.split('|')[0]?.split('#')[0]?.trim()
    if (raw) links.add(normalizeLinkId(raw))
  }
  return [...links]
}

/** Removes fenced code, inline code, and existing wiki-links before mention scanning. */
function mentionSurface(body: string): string {
  // Replace with same-length whitespace so match offsets in the surface map
  // 1:1 onto the original body (link insertion depends on this).
  const blank = (match: string) => ' '.repeat(match.length)
  return body
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/\[\[[^\]]*\]\]/g, blank)
    .replace(/!?\[[^\]\n]*\]\([^)]*\)/g, blank)
    .replace(/\]\([^)]*\)/g, blank)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentionPattern(names: string[]): RegExp | null {
  const usable = names
    .map((name) => name.trim())
    .filter((name) => name.length >= MIN_MENTION_LENGTH)
    .sort((a, b) => b.length - a.length)
  if (usable.length === 0) return null
  // Word-boundary-ish: avoid matching inside longer words. `\b` misbehaves for
  // names starting with a non-word char, so guard with explicit lookarounds.
  return new RegExp(`(?<![\\w-])(?:${usable.map(escapeRegExp).join('|')})(?![\\w-])`, 'gi')
}

function snippetAround(body: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 60)
  const end = Math.min(body.length, match.index + match[0].length + 90)
  const text = body.slice(start, end).replace(/\s+/g, ' ').trim()
  const prefix = start > 0 ? '…' : ''
  const suffix = end < body.length ? '…' : ''
  return `${prefix}${text}${suffix}`.slice(0, MAX_SNIPPET)
}

/** Pages that name this page but never link it. */
export function findUnlinkedMentions(
  wikiDir: string,
  pageId: string,
  index?: Map<string, PageLinkEntry>,
): UnlinkedMention[] {
  const pages = index ?? buildLinkIndex(wikiDir)
  const target = pages.get(pageId)
  if (!target) return []

  const slug = pageId.split('/').pop() ?? pageId
  const pattern = mentionPattern([target.title, ...target.aliases, slug])
  if (!pattern) return []

  const found: UnlinkedMention[] = []
  for (const page of pages.values()) {
    if (page.id === pageId) continue
    if (page.links.includes(pageId)) continue

    const surface = mentionSurface(page.body)
    pattern.lastIndex = 0
    const first = pattern.exec(surface)
    if (!first) continue

    let mentions = 1
    while (pattern.exec(surface) !== null) mentions += 1

    found.push({
      id: page.id,
      title: page.title,
      snippet: snippetAround(surface, first),
      mentions,
    })
  }

  return found.sort((a, b) => b.mentions - a.mentions || a.title.localeCompare(b.title))
}

/** Why two pages look connected: shared tags, shared targets, shared referrers, or a mention. */
export function findRelatedPages(
  wikiDir: string,
  pageId: string,
  index?: Map<string, PageLinkEntry>,
  limit = 8,
): RelatedPage[] {
  const pages = index ?? buildLinkIndex(wikiDir)
  const target = pages.get(pageId)
  if (!target) return []

  const inbound = new Map<string, Set<string>>()
  for (const page of pages.values()) {
    for (const link of page.links) {
      const set = inbound.get(link) ?? new Set<string>()
      set.add(page.id)
      inbound.set(link, set)
    }
  }

  const targetInbound = inbound.get(pageId) ?? new Set<string>()
  const targetTags = new Set(target.tags.map((tag) => tag.toLowerCase()))
  const targetLinks = new Set(target.links)
  const slug = pageId.split('/').pop() ?? pageId
  const pattern = mentionPattern([target.title, ...target.aliases, slug])

  const scored: RelatedPage[] = []
  for (const page of pages.values()) {
    if (page.id === pageId) continue

    const reasons = new Set<RelatedReason>()
    const sharedTags = page.tags.filter((tag) => targetTags.has(tag.toLowerCase()))

    // A direct link in either direction is a strong signal already surfaced as
    // a backlink, but it still makes the pages related.
    if (page.links.includes(pageId) || targetLinks.has(page.id)) reasons.add('link')
    if (sharedTags.length > 0) reasons.add('tag')

    const pageInbound = inbound.get(page.id) ?? new Set<string>()
    let coCited = 0
    for (const referrer of targetInbound) {
      if (pageInbound.has(referrer)) coCited += 1
    }
    if (coCited > 0) reasons.add('co-citation')

    if (pattern) {
      pattern.lastIndex = 0
      if (pattern.test(mentionSurface(page.body))) reasons.add('mention')
    }

    if (reasons.size === 0) continue

    const score =
      sharedTags.length * 3 +
      (reasons.has('link') ? 2.5 : 0) +
      Math.min(coCited, 5) * 1.2 +
      (reasons.has('mention') ? 1.5 : 0)

    scored.push({
      id: page.id,
      title: page.title,
      summary: page.summary,
      score: Number(score.toFixed(2)),
      reasons: [...reasons],
      sharedTags,
    })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)
}

/** Everything the page sidebar needs, from a single corpus pass. */
export function analyzeLinks(
  wikiDir: string,
  pageId: string,
  index?: Map<string, PageLinkEntry>,
): LinkIntelligence | null {
  const pages = index ?? buildLinkIndex(wikiDir)
  const target = pages.get(pageId)
  if (!target) return null
  return {
    id: target.id,
    title: target.title,
    unlinked: findUnlinkedMentions(wikiDir, pageId, pages),
    related: findRelatedPages(wikiDir, pageId, pages),
  }
}

/**
 * Wraps the first unlinked mention of `target` in `body` with a wiki-link.
 * Returns the rewritten body and whether anything changed.
 */
export function linkFirstMentionInBody(
  body: string,
  target: { title: string; aliases: string[]; id: string },
  linkText: string,
): { body: string; changed: boolean } {
  const slug = target.id.split('/').pop() ?? target.id
  const pattern = mentionPattern([target.title, ...target.aliases, slug])
  if (!pattern) return { body, changed: false }

  // Scan the same surface the mention finder uses, but edit the original body
  // so code fences and existing links are left untouched.
  const surface = mentionSurface(body)
  pattern.lastIndex = 0
  const hit = pattern.exec(surface)
  if (!hit) return { body, changed: false }

  // `mentionSurface` blanks spans with spaces, so an index in the surface maps
  // 1:1 to the original string as long as replacements are length-preserving.
  const start = hit.index
  const end = start + hit[0].length
  const original = body.slice(start, end)
  if (!original.trim()) return { body, changed: false }

  return {
    body: `${body.slice(0, start)}[[${linkText}|${original}]]${body.slice(end)}`,
    changed: true,
  }
}

// ── Rename support ──────────────────────────────────────────────────────────
export interface RenameReport {
  oldId: string
  newId: string
  rewritten: Array<{ id: string; replacements: number }>
}

function canonicalLink(id: string, obsidianCompat: boolean): string {
  return obsidianCompat ? id.split('/').pop() ?? id : id
}

/**
 * Rewrites every inbound reference to a renamed page: `[[old]]`, `[[old|alias]]`,
 * `[[old#heading]]`, and relative `.md` links. Returns the pages it touched so
 * the caller can reindex them.
 */
export function rewriteLinksForRename(
  wikiDir: string,
  oldId: string,
  newId: string,
  obsidianCompat: boolean,
): RenameReport {
  const oldSlug = oldId.split('/').pop() ?? oldId
  const replacement = canonicalLink(newId, obsidianCompat)
  const index = buildLinkIndex(wikiDir)
  const report: RenameReport = { oldId, newId, rewritten: [] }

  for (const page of index.values()) {
    if (page.id === oldId) continue
    const abs = path.join(wikiDir, page.path)
    const raw = fs.readFileSync(abs, 'utf-8')
    let next = raw
    let replacements = 0

    // Wiki-links: match the old id and the old bare slug, keeping any |alias
    // and #anchor the author attached.
    const wikiPattern = new RegExp(
      `\\[\\[(?:${escapeRegExp(oldId)}|${escapeRegExp(oldSlug)})((?:#[^\\]|]*)?(?:\\|[^\\]]*)?)\\]\\]`,
      'g',
    )
    next = next.replace(wikiPattern, (_full, suffix: string) => {
      replacements += 1
      return `[[${replacement}${suffix}]]`
    })

    // Markdown relative links pointing at the old file name.
    next = next.replace(/\]\(([^)\s]+)\.md\)/g, (full, target: string) => {
      const base = target.split('/').pop()
      if (base !== oldSlug) return full
      replacements += 1
      return `](/page/${newId})`
    })

    if (replacements === 0) continue

    fs.writeFileSync(abs, next, 'utf-8')
    report.rewritten.push({ id: page.id, replacements })
  }

  return report
}

/**
 * Re-points compilation-state bookkeeping (`concepts` and `frozenSlugs`) at the
 * renamed page so incremental compiles keep working.
 */
export function rewriteStateForRename(
  state: CompilationState,
  oldPath: string,
  newPath: string,
): void {
  for (const source of Object.values(state.sources)) {
    source.concepts = source.concepts.map((concept) => (concept === oldPath ? newPath : concept))
  }
  state.frozenSlugs = state.frozenSlugs.map((slug) => (slug === oldPath ? newPath : slug))
}
