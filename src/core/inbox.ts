import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

import { PAGE_CATEGORIES, renamePage, slugifyTitle, type RenameResult } from './page-ops.js'
import type { CompilationState } from './state.js'

/**
 * Quick capture.
 *
 * A note is created in the `inbox` category with no ceremony: no category
 * decision, no title invention. Triage happens later and reuses the page
 * operations that already exist — promoting is a rename, absorbing is a merge.
 */

export const INBOX_CATEGORY = 'inbox'

export interface CaptureInput {
  text: string
  title?: string
  tags?: string[]
  /** Optional origin, e.g. a URL the note was copied from. */
  source?: string
}

export interface Captured {
  id: string
  path: string
  title: string
  created: boolean
}

const MAX_TITLE = 90
const MAX_SUMMARY = 200

function deriveTitle(text: string): string {
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
  const urlMatch = /^https?:\/\/\S+$/i.test(firstLine)
  if (urlMatch) {
    try {
      const url = new URL(firstLine)
      const tail = url.pathname === '/' ? '' : url.pathname
      return clamp(`${url.hostname}${tail}`)
    } catch {
      // Not a parseable URL; fall through to the line itself.
    }
  }
  return clamp(firstLine.replace(/^#{1,6}\s*/, '')) || 'Untitled note'
}

function clamp(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)
}

function deriveSummary(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SUMMARY)
}

function freeId(wikiDir: string, base: string): string {
  const dir = path.join(wikiDir, 'wiki/pages', INBOX_CATEGORY)
  let slug = base
  let counter = 2
  while (fs.existsSync(path.join(dir, `${slug}.md`))) {
    slug = `${base}-${counter}`
    counter += 1
  }
  return `${INBOX_CATEGORY}/${slug}`
}

/** Creates an inbox note. The caller owns the compilation lock. */
export function capture(wikiDir: string, input: CaptureInput): Captured {
  const text = input.text.trim()
  if (!text) throw new Error('Nothing to capture.')

  const title = (input.title?.trim() || deriveTitle(text)).slice(0, MAX_TITLE)
  const base = slugifyTitle(title) || `note-${Date.now()}`
  const id = freeId(wikiDir, base)
  const pagePath = `wiki/pages/${id}.md`

  const tags = ['inbox', ...(input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)]
  const body = input.source ? `${text}\n\nSource: <${input.source}>` : text

  const content = matter.stringify(`${body}\n`, {
    title,
    summary: deriveSummary(text),
    tags: [...new Set(tags)],
    category: INBOX_CATEGORY,
    updatedAt: new Date().toISOString().slice(0, 10),
    capturedAt: new Date().toISOString(),
  })

  const abs = path.join(wikiDir, pagePath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const tmp = `${abs}.tmp`
  fs.writeFileSync(tmp, content, 'utf-8')
  fs.renameSync(tmp, abs)

  return { id, path: pagePath, title, created: true }
}

export interface PromoteResult extends RenameResult {
  oldId: string
  newId: string
}

/**
 * Moves an inbox note into a real category and drops the `inbox` tag, so the
 * badge and the tag grouping both settle.
 */
export function promoteInbox(
  wikiDir: string,
  id: string,
  category: string,
  state: CompilationState,
  obsidianCompat = false,
): PromoteResult {
  if (!id.startsWith(`${INBOX_CATEGORY}/`)) {
    throw new Error(`“${id}” is not an inbox note.`)
  }
  if (!(PAGE_CATEGORIES as readonly string[]).includes(category) || category === INBOX_CATEGORY) {
    throw new Error(`Promote to one of: ${PAGE_CATEGORIES.filter((c) => c !== INBOX_CATEGORY).join(', ')}.`)
  }

  const slug = id.split('/').pop() ?? ''
  const newId = `${category}/${slug}`
  const result = renamePage(wikiDir, id, newId, state, obsidianCompat)

  // Strip the inbox tag from the moved file, preserving any the user added.
  const abs = path.join(wikiDir, `wiki/pages/${newId}.md`)
  const parsed = matter(fs.readFileSync(abs, 'utf-8'))
  const tags = Array.isArray(parsed.data['tags']) ? (parsed.data['tags'] as unknown[]).map(String) : []
  const nextTags = tags.filter((tag) => tag.toLowerCase() !== INBOX_CATEGORY)
  fs.writeFileSync(
    abs,
    matter.stringify(parsed.content, {
      ...parsed.data,
      tags: nextTags.length > 0 ? nextTags : ['uncategorised'],
    }),
    'utf-8',
  )

  return { ...result, oldId: id, newId }
}
