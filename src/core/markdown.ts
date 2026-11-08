import { marked } from 'marked'

import { slugifyHeading } from './slug.js'

/**
 * Pure Markdown helpers shared by the live server and the static exporter.
 * No filesystem or network access.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** "entities/alan-turing" -> "/page/entities/alan-turing" */
export function pageHref(id: string): string {
  return `/page/${id.replace(/^\/+/, '')}`
}

export type PageHrefBuilder = (id: string) => string

/**
 * Rewrites wiki-links and relative .md links into internal routes, before
 * markdown parsing. Supports:
 *   [[entities/foo]]        -> [entities/foo](/page/entities/foo)
 *   [[foo]]                 -> [foo](/page/entities/foo)   (entities is the default, like graph.ts)
 *   [[entities/foo|Title]]  -> [Title](/page/entities/foo)
 *   [[entities/foo#Part]]   -> [entities/foo](/page/entities/foo#Part)
 *   [text](../entities/foo.md) -> [text](/page/entities/foo)
 *
 * The href builder lets the static exporter emit relative `.html` links.
 */
export function rewriteWikiLinks(
  markdown: string,
  hrefForId: PageHrefBuilder = pageHref,
): string {
  let out = markdown.replace(
    /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g,
    (_m, rawId: string, anchor?: string, alias?: string) => {
      const id = rawId.trim().includes('/') ? rawId.trim() : `entities/${rawId.trim()}`
      const hash = anchor ? `#${anchor.trim()}` : ''
      const text = (alias ?? rawId).trim()
      return `[${text}](${hrefForId(id)}${hash})`
    },
  )

  out = out.replace(
    /\[([^\]]*)\]\(([^)\s]+\.md)(#[^)]*)?\)/g,
    (m, text: string, href: string, anchor?: string) => {
      if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(href)) return m // external URL, leave untouched
      let clean = href
        .replace(/^(?:\.\.?\/)+/, '')
        .replace(/^\/?wiki\/pages\//, '')
        .replace(/\.md$/, '')
      if (!clean.includes('/')) clean = `entities/${clean}`
      return `[${text}](${hrefForId(clean)}${anchor ?? ''})`
    },
  )

  return out
}

export function rewriteCitations(markdown: string): string {
  return markdown.replace(/\^\[([^\]]+)\]/g, (_match, inner) => {
    const parts = inner.split('|')
    const sourcePart = parts[0].trim()
    const gradePart = parts[1] ? parts[1].replace(/grade:\s*/i, '').trim() : ''
    const gradeBadge = gradePart ? ` <span class="cite-grade">${escapeHtml(gradePart)}</span>` : ''
    return `<cite class="citation" title="${escapeHtml(inner)}">↗ ${escapeHtml(sourcePart)}${gradeBadge}</cite>`
  })
}

/**
 * Adds stable `id`s to rendered headings using the same slug the search indexer
 * uses for section anchors, so `/page/x#section` links resolve.
 */
export function addHeadingIds(html: string): string {
  const seen = new Map<string, number>()
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (match, level: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').trim()
    if (!text) return match
    const base = slugifyHeading(text) || 'section'
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    const id = count === 0 ? base : `${base}-${count}`
    return `<h${level} id="${escapeHtml(id)}">${inner}</h${level}>`
  })
}

export function renderMarkdown(
  markdown: string,
  hrefForId: PageHrefBuilder = pageHref,
): string {
  const html = marked.parse(rewriteCitations(rewriteWikiLinks(markdown, hrefForId)), {
    async: false,
  }) as string
  return addHeadingIds(html)
}
