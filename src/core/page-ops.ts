import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

import { slugifyHeading } from './slug.js'
import { rewriteLinksForRename, rewriteStateForRename, type RenameReport } from './links.js'
import type { CompilationState } from './state.js'

/**
 * Human-initiated page operations: create, edit, rename, merge, delete.
 *
 * These are filesystem-only. The caller owns the compilation lock and is
 * responsible for rebuilding `index.md`/`moc.md` and refreshing the semantic
 * index, exactly like the ingest path.
 */

export const PAGE_CATEGORIES = ['entities', 'concepts', 'sources', 'analyses'] as const
export type PageCategory = (typeof PAGE_CATEGORIES)[number]

export interface PageDraft {
  /** Full id when editing or creating at an explicit location. */
  id?: string
  category?: string
  title: string
  summary?: string
  tags?: string[]
  aliases?: string[]
  body: string
}

export class PageOpError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'PageOpError'
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/

export function isValidPageId(id: string): boolean {
  return ID_RE.test(id)
}

export function pagePathForId(id: string): string {
  return `wiki/pages/${id}.md`
}

export function idFromPagePath(pagePath: string): string {
  return pagePath.replace(/^wiki\/pages\//, '').replace(/\.md$/, '')
}

export function slugifyTitle(title: string): string {
  return slugifyHeading(title).replace(/-+/g, '-')
}

export function resolvePageId(draft: PageDraft): string {
  if (draft.id) {
    if (!isValidPageId(draft.id)) {
      throw new PageOpError('Page id must look like “category/slug”.')
    }
    return draft.id
  }
  const category = draft.category ?? PAGE_CATEGORIES[0]
  if (!(PAGE_CATEGORIES as readonly string[]).includes(category)) {
    throw new PageOpError(`Category must be one of: ${PAGE_CATEGORIES.join(', ')}.`)
  }
  const slug = slugifyTitle(draft.title)
  if (!slug) throw new PageOpError('Title must contain at least one letter or number.')
  return `${category}/${slug}`
}

function composePage(wikiDir: string, draft: PageDraft, id: string): string {
  const abs = path.join(wikiDir, pagePathForId(id))
  let existingData: Record<string, unknown> = {}
  if (draft.id && fs.existsSync(abs)) {
    try {
      existingData = matter(fs.readFileSync(abs, 'utf-8')).data as Record<string, unknown>
    } catch {
      // A page with malformed frontmatter is rewritten from the draft.
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const data: Record<string, unknown> = {
    ...existingData,
    title: draft.title.trim(),
    summary: (draft.summary ?? String(existingData['summary'] ?? '')).trim(),
    tags: draft.tags ?? (Array.isArray(existingData['tags']) ? existingData['tags'] : []),
    category: id.split('/')[0],
    updatedAt: today,
  }
  if (draft.aliases && draft.aliases.length > 0) data['aliases'] = draft.aliases
  else delete data['aliases']

  return matter.stringify(draft.body.replace(/\s+$/, '') + '\n', data)
}

/** Creates or overwrites a page. Returns its id and relative path. */
export function savePage(
  wikiDir: string,
  draft: PageDraft,
): { id: string; path: string; created: boolean } {
  const id = resolvePageId(draft)
  const pagePath = pagePathForId(id)
  const abs = path.join(wikiDir, pagePath)
  const created = !fs.existsSync(abs)

  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const tmp = `${abs}.tmp`
  fs.writeFileSync(tmp, composePage(wikiDir, draft, id), 'utf-8')
  fs.renameSync(tmp, abs)

  return { id, path: pagePath, created }
}

export interface RenameResult extends RenameReport {
  /** Page ids whose content changed and should be reindexed. */
  touched: string[]
}

/**
 * Moves a page and rewrites every inbound link in the corpus. Refuses to
 * overwrite an existing page — merging is an explicit operation.
 */
export function renamePage(
  wikiDir: string,
  oldId: string,
  newId: string,
  state: CompilationState,
  obsidianCompat = false,
): RenameResult {
  if (!isValidPageId(oldId) || !isValidPageId(newId)) {
    throw new PageOpError('Both page ids must look like “category/slug”.')
  }
  if (oldId === newId) throw new PageOpError('The page already has that id.')

  const oldAbs = path.join(wikiDir, pagePathForId(oldId))
  const newAbs = path.join(wikiDir, pagePathForId(newId))
  if (!fs.existsSync(oldAbs)) throw new PageOpError(`Page not found: ${oldId}`, 404)
  if (fs.existsSync(newAbs)) throw new PageOpError(`A page already exists at ${newId}.`, 409)

  fs.mkdirSync(path.dirname(newAbs), { recursive: true })
  fs.renameSync(oldAbs, newAbs)

  // Frontmatter category follows the id so listings stay coherent. Edit only
  // the `category:` line so the rest of the author's YAML survives verbatim —
  // re-serialising the whole block breaks git's rename detection on short pages.
  const raw = fs.readFileSync(newAbs, 'utf-8')
  const newCategory = newId.split('/')[0]
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  if (fmMatch) {
    const current = /^category:\s*(.*)$/m.exec(fmMatch[1])?.[1]?.trim()
    if (current !== newCategory) {
      const frontmatter = /^category:/m.test(fmMatch[1])
        ? fmMatch[1].replace(/^category:.*$/m, `category: ${newCategory}`)
        : `${fmMatch[1]}\ncategory: ${newCategory}`
      const next = `---\n${frontmatter}\n---${raw.slice(fmMatch[0].length)}`
      fs.writeFileSync(newAbs, next, 'utf-8')
    }
  }

  const report = rewriteLinksForRename(wikiDir, oldId, newId, obsidianCompat)
  rewriteStateForRename(state, pagePathForId(oldId), pagePathForId(newId))

  return {
    ...report,
    touched: [newId, ...report.rewritten.map((entry) => entry.id)],
  }
}

export interface MergeResult {
  targetId: string
  removedId: string
  touched: string[]
}

/**
 * Folds `sourceId` into `targetId`: appends the source body as a section,
 * deletes the source page, and re-points inbound links at the target.
 */
export function mergePages(
  wikiDir: string,
  sourceId: string,
  targetId: string,
  state: CompilationState,
  obsidianCompat = false,
): MergeResult {
  if (sourceId === targetId) throw new PageOpError('Pick two different pages to merge.')
  if (!isValidPageId(sourceId) || !isValidPageId(targetId)) {
    throw new PageOpError('Both page ids must look like “category/slug”.')
  }

  const sourceAbs = path.join(wikiDir, pagePathForId(sourceId))
  const targetAbs = path.join(wikiDir, pagePathForId(targetId))
  if (!fs.existsSync(sourceAbs)) throw new PageOpError(`Page not found: ${sourceId}`, 404)
  if (!fs.existsSync(targetAbs)) throw new PageOpError(`Page not found: ${targetId}`, 404)

  const source = matter(fs.readFileSync(sourceAbs, 'utf-8'))
  const target = matter(fs.readFileSync(targetAbs, 'utf-8'))
  const sourceTitle = String(source.data['title'] ?? sourceId)

  const mergedBody = [
    target.content.trim(),
    '',
    `## Merged from ${sourceTitle}`,
    '',
    source.content.trim(),
    '',
  ].join('\n')

  fs.writeFileSync(
    targetAbs,
    matter.stringify(mergedBody, {
      ...target.data,
      summary: String(target.data['summary'] ?? ''),
      updatedAt: new Date().toISOString().slice(0, 10),
    }),
    'utf-8',
  )
  fs.rmSync(sourceAbs, { force: true })

  const report = rewriteLinksForRename(wikiDir, sourceId, targetId, obsidianCompat)
  rewriteStateForRename(state, pagePathForId(sourceId), pagePathForId(targetId))
  removeConceptReferences(state, pagePathForId(sourceId))

  return {
    targetId,
    removedId: sourceId,
    touched: [targetId, ...report.rewritten.map((entry) => entry.id)],
  }
}

export function deletePage(wikiDir: string, id: string, state?: CompilationState): string {
  if (!isValidPageId(id)) throw new PageOpError('Page id must look like “category/slug”.')
  const abs = path.join(wikiDir, pagePathForId(id))
  if (!fs.existsSync(abs)) throw new PageOpError(`Page not found: ${id}`, 404)
  fs.rmSync(abs, { force: true })
  if (state) removeConceptReferences(state, pagePathForId(id))
  return pagePathForId(id)
}

function removeConceptReferences(state: CompilationState, pagePath: string): void {
  for (const source of Object.values(state.sources)) {
    source.concepts = source.concepts.filter((concept) => concept !== pagePath)
  }
  state.frozenSlugs = state.frozenSlugs.filter((slug) => slug !== pagePath)
}
