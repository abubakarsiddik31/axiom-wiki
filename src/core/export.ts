import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

import { VERSION } from '../version.js'
import { buildWikiSnapshot } from './snapshot.js'
import { buildLinkIndex, type PageLinkEntry } from './links.js'
import { backlinksFromGraph, type WikiGraph } from './graph.js'
import { renderGraphSvg } from './graph-svg.js'
import { escapeHtml, renderMarkdown } from './markdown.js'
import { dirSize } from './wiki.js'
import { slugifyHeading } from './slug.js'

/**
 * Static site export.
 *
 * Produces a self-contained directory of HTML that works from `file://` or
 * any static host: relative links, an inline search index (no fetch, no
 * server), a filterable page list, and the same dark cockpit styling as the
 * web app. Nothing here talks to the network.
 */

export interface ExportOptions {
  /** Directory to write the site into. */
  outDir: string
  /** Site title shown in the header and page titles. */
  title?: string
  /** Canonical base URL, e.g. `https://notes.example.com`. Enables sitemap. */
  baseUrl?: string
  /** Include the graph page. Default true. */
  graph?: boolean
  /** Include the search page and index. Default true. */
  search?: boolean
  /** Overwrite a non-empty directory that is not a previous export. */
  force?: boolean
}

export interface ExportResult {
  outDir: string
  title: string
  pages: number
  /** Inbox notes are intentionally left out of the public site. */
  excludedInbox: number
  files: number
  media: number
  deadLinks: number
  categories: Record<string, number>
  bytes: number
}

const MARKER = '.axiom-export.json'
const MAX_MEDIA_BYTES = 20 * 1024 * 1024
const MAX_SEARCH_TEXT = 1600
const GENERATED = new Date().toISOString()
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico',
])

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-')
}

/** `concepts/logic` -> `p/concepts/logic.html` */
function exportPath(id: string): string {
  return `p/${id.split('/').map(safeSegment).join('/')}.html`
}

function relativeHref(fromPath: string, toPath: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromPath), toPath)
  return rel === '' ? path.posix.basename(toPath) : rel
}

function prepareOutDir(outDir: string, force: boolean): void {
  if (fs.existsSync(outDir)) {
    if (!fs.statSync(outDir).isDirectory()) {
      throw new Error(`Output path is not a directory: ${outDir}`)
    }
    const entries = fs.readdirSync(outDir)
    if (entries.length > 0) {
      const isExport = fs.existsSync(path.join(outDir, MARKER))
      if (!isExport && !force) {
        throw new Error(
          `Refusing to overwrite a non-empty directory that is not an Axiom export: ${outDir}\n` +
            'Pass --force to replace it, or choose an empty --out directory.',
        )
      }
      fs.rmSync(outDir, { recursive: true, force: true })
    }
  }
  fs.mkdirSync(outDir, { recursive: true })
}

function plainText(markdown: string, max = MAX_SEARCH_TEXT): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\^\[[^\]]*\]/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max).trim()}…` : text
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

interface TocEntry {
  level: number
  id: string
  text: string
}

function extractToc(html: string): TocEntry[] {
  const entries: TocEntry[] = []
  const re = /<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const level = Number(match[1])
    const id = match[2]
    const text = match[3]?.replace(/<[^>]+>/g, '').trim()
    if (id && text) entries.push({ level, id, text })
  }
  return entries
}

function resolveRelative(fromPath: string, href: string): string {
  const clean = href.split('#')[0]
  if (!clean) return ''
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), clean))
}

// ── Layout ────────────────────────────────────────────────────────────────

interface LayoutInput {
  siteTitle: string
  pageTitle: string
  description: string
  currentPath: string
  active: 'home' | 'pages' | 'search' | 'graph' | 'page' | ''
  body: string
  toc?: TocEntry[]
  includeSearch: boolean
  includeGraph: boolean
  showSearchForm: boolean
  baseUrl?: string
  canonical?: string
}

function layout(input: LayoutInput): string {
  const href = (target: string) => relativeHref(input.currentPath, target)
  const home = href('index.html')
  const pages = href('pages.html')
  const search = href('search.html')
  const graph = href('graph.html')
  const css = href('assets/style.css')

  const navLink = (target: string, label: string, key: LayoutInput['active']) =>
    `<a href="${target}"${input.active === key ? ' class="active" aria-current="page"' : ''}>${label}</a>`

  const searchForm = input.showSearchForm && input.includeSearch
    ? `<form class="search" action="${search}" method="get" role="search">
        <input type="search" name="q" placeholder="Search…" aria-label="Search the wiki">
        <button type="submit">Search</button>
      </form>`
    : ''

  const canonicalUrl =
    input.baseUrl && input.canonical
      ? `${input.baseUrl.replace(/\/+$/, '')}${
          input.canonical === 'index.html' ? '/' : `/${input.canonical}`
        }`
      : ''
  const canonical = canonicalUrl
    ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">`
    : ''

  const title =
    input.pageTitle === input.siteTitle
      ? input.siteTitle
      : `${input.pageTitle} · ${input.siteTitle}`

  const toc = input.toc && input.toc.length >= 2
    ? `<aside class="toc" aria-label="On this page">
        <h2>On this page</h2>
        <ul>
          ${input.toc
            .map(
              (entry) =>
                `<li class="lvl-${entry.level}"><a href="#${escapeHtml(entry.id)}">${entry.text}</a></li>`,
            )
            .join('\n')}
        </ul>
      </aside>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(input.description)}">
<meta property="og:title" content="${escapeHtml(input.pageTitle)}">
<meta property="og:description" content="${escapeHtml(input.description)}">
<meta property="og:type" content="website">
<meta name="generator" content="Axiom Wiki ${escapeHtml(VERSION)}">
${canonical}
<link rel="stylesheet" href="${css}">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="topbar">
  <a class="brand" href="${home}"><span class="brand-mark" aria-hidden="true">◈</span> ${escapeHtml(input.siteTitle)}</a>
  <nav class="topnav" aria-label="Primary">
    ${navLink(home, 'Home', 'home')}
    ${navLink(pages, 'Pages', 'pages')}
    ${input.includeGraph ? navLink(graph, 'Graph', 'graph') : ''}
    ${input.includeSearch ? navLink(search, 'Search', 'search') : ''}
  </nav>
  ${searchForm}
</header>
<main id="content" class="shell${toc ? ' with-toc' : ''}">
  <article class="content">
${input.body}
  </article>
  ${toc}
</main>
<footer class="footer">
  <span>${escapeHtml(input.siteTitle)}</span>
  <span>Generated by Axiom Wiki · ${escapeHtml(GENERATED.slice(0, 10))}</span>
</footer>
</body>
</html>
`
}

// ── Page rendering ────────────────────────────────────────────────────────

function pageBody(
  entry: PageLinkEntry,
  updatedAt: string,
  html: string,
  opts: {
    href: (id: string) => string
    pagesHref: string
    exportedIds: Set<string>
    titleFor: (id: string) => string | undefined
    backlinks: Array<{ fromId: string; fromTitle: string }>
    prev?: PageLinkEntry
    next?: PageLinkEntry
  },
): string {
  const tags = entry.tags
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join(' ')
  const sources = entry.sources.length
    ? `<span class="stamp">sources: ${entry.sources.map(escapeHtml).join(', ')}</span>`
    : ''
  const outgoing = [...new Set(entry.links)]
    .filter((id) => opts.exportedIds.has(id))
    .map((id) => ({ id, title: opts.titleFor(id) ?? id }))
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 40)

  const outgoingHtml = outgoing.length
    ? `<section class="panel">
        <h2>Links out</h2>
        <ul class="chips">${outgoing
          .map((link) => `<li><a href="${opts.href(link.id)}">${escapeHtml(link.title)}</a></li>`)
          .join('')}</ul>
      </section>`
    : ''

  const backlinksHtml = opts.backlinks.length
    ? `<section class="panel">
        <h2>Linked from</h2>
        <ul class="page-list">${opts.backlinks
          .map(
            (link) =>
              `<li><a href="${opts.href(link.fromId)}">${escapeHtml(link.fromTitle)}</a><span class="summary">${escapeHtml(link.fromId)}</span></li>`,
          )
          .join('')}</ul>
      </section>`
    : ''

  const pager = opts.prev || opts.next
    ? `<nav class="pager" aria-label="Category pages">
        ${opts.prev
          ? `<a class="prev" href="${opts.href(opts.prev.id)}"><span>← Previous</span><strong>${escapeHtml(opts.prev.title)}</strong></a>`
          : '<span></span>'}
        ${opts.next
          ? `<a class="next" href="${opts.href(opts.next.id)}"><span>Next →</span><strong>${escapeHtml(opts.next.title)}</strong></a>`
          : ''}
      </nav>`
    : ''

  const categoryAnchor = `${opts.pagesHref}#${slugifyHeading(entry.category)}`

  return `<nav class="crumbs"><a href="${categoryAnchor}">${escapeHtml(entry.category)}</a><span>/</span><span>${escapeHtml(entry.id)}</span></nav>
<h1>${escapeHtml(entry.title)}</h1>
<div class="meta">${tags}<span class="stamp">updated ${escapeHtml(updatedAt)}</span>${sources}</div>
${entry.summary ? `<p class="lede">${escapeHtml(entry.summary)}</p>` : ''}
<div class="prose">
${html}
</div>
${outgoingHtml}
${backlinksHtml}
${pager}`
}

function pageFromList(list: PageLinkEntry[], href: (id: string) => string): string {
  return list
    .map(
      (entry) =>
        `<li><a href="${href(entry.id)}">${escapeHtml(entry.title)}</a><span class="summary">${escapeHtml(entry.summary)}</span><span class="stamp">${escapeHtml(entry.id)}</span></li>`,
    )
    .join('\n')
}

// ── Export entry point ────────────────────────────────────────────────────

export function exportSite(wikiDir: string, options: ExportOptions): ExportResult {
  const root = path.resolve(wikiDir)
  const outDir = path.resolve(options.outDir)
  const siteTitle = (options.title ?? 'Axiom Wiki').trim() || 'Axiom Wiki'
  const includeGraph = options.graph !== false
  const includeSearch = options.search !== false

  if (outDir === root) {
    throw new Error('Refusing to export into the wiki directory itself. Choose a subdirectory or another path.')
  }
  if (isInside(path.join(root, 'wiki'), outDir) || isInside(path.join(root, 'raw'), outDir)) {
    throw new Error('Refusing to export inside wiki/ or raw/. Choose a directory outside the wiki data.')
  }

  const snapshot = buildWikiSnapshot(root)
  const index = buildLinkIndex(root)
  const allEntries = [...index.values()]
  const inboxEntries = allEntries.filter((entry) => entry.category === 'inbox' || entry.id.startsWith('inbox/'))
  const entries = allEntries
    .filter((entry) => entry.category !== 'inbox' && !entry.id.startsWith('inbox/'))
    .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))

  if (entries.length === 0) {
    throw new Error('There are no pages to export yet. Ingest a source or write a page first.')
  }

  const metaById = new Map(
    snapshot.pages.map((page) => [
      page.path.split(path.sep).join('/').replace(/^wiki\/pages\//, '').replace(/\.md$/, ''),
      page,
    ]),
  )

  // Output paths are stable and collision-resistant (sanitised ids, suffixed).
  const pathById = new Map<string, string>()
  const usedPaths = new Set<string>()
  for (const entry of entries) {
    let candidate = exportPath(entry.id)
    if (usedPaths.has(candidate)) {
      const stem = candidate.replace(/\.html$/, '')
      let suffix = 2
      while (usedPaths.has(`${stem}-${suffix}.html`)) suffix += 1
      candidate = `${stem}-${suffix}.html`
    }
    usedPaths.add(candidate)
    pathById.set(entry.id, candidate)
  }

  const exportedIds = new Set(entries.map((entry) => entry.id))
  const titleById = new Map(entries.map((entry) => [entry.id, entry.title]))
  const privatePaths = new Set(inboxEntries.map((entry) => exportPath(entry.id)))
  const knownPaths = new Set<string>([
    'index.html',
    'pages.html',
    'search.html',
    'graph.html',
    '404.html',
    ...usedPaths,
  ])

  const byCategory = new Map<string, PageLinkEntry[]>()
  for (const entry of entries) {
    const list = byCategory.get(entry.category) ?? []
    list.push(entry)
    byCategory.set(entry.category, list)
  }
  for (const list of byCategory.values()) list.sort((a, b) => a.title.localeCompare(b.title))

  const neighbors = new Map<string, { prev?: PageLinkEntry; next?: PageLinkEntry }>()
  for (const list of byCategory.values()) {
    list.forEach((entry, position) => {
      neighbors.set(entry.id, { prev: list[position - 1], next: list[position + 1] })
    })
  }

  prepareOutDir(outDir, Boolean(options.force))

  let files = 0
  const write = (rel: string, content: string | Buffer): void => {
    const abs = path.join(outDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
    files += 1
  }

  const copiedMedia = new Set<string>()
  let mediaCount = 0

  function rewriteImages(markdown: string, entry: PageLinkEntry, outputPath: string): string {
    const pageAbs = path.join(root, entry.path)
    return markdown.replace(
      /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
      (match, alt: string, rawSrc: string, title: string | undefined) => {
        const src = rawSrc.trim()
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) return match

        let decoded = src
        try {
          decoded = decodeURIComponent(src)
        } catch {
          /* keep the raw path */
        }

        const candidates = [
          path.resolve(path.dirname(pageAbs), decoded),
          path.resolve(root, 'raw', decoded),
          path.resolve(root, decoded),
        ]
        const found = candidates.find(
          (candidate) =>
            isInside(root, candidate) &&
            fs.existsSync(candidate) &&
            fs.statSync(candidate).isFile(),
        )
        if (!found) return match
        if (!IMAGE_EXTENSIONS.has(path.extname(found).toLowerCase())) return match
        if (fs.statSync(found).size > MAX_MEDIA_BYTES) return match

        const bytes = fs.readFileSync(found)
        const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 10)
        const base = path.basename(found).replace(/[^a-zA-Z0-9._-]/g, '-')
        const assetRel = `assets/media/${hash}-${base}`

        if (!copiedMedia.has(assetRel)) {
          write(assetRel, bytes)
          copiedMedia.add(assetRel)
          mediaCount += 1
        }

        const href = relativeHref(outputPath, assetRel)
        return `![${alt}](${href}${title ?? ''})`
      },
    )
  }

  function markDeadLinks(html: string, outputPath: string): string {
    return html.replace(
      /<a href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g,
      (match, href: string, attrs: string, inner: string) => {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return match
        const target = resolveRelative(outputPath, href)
        if (target.endsWith('.html') && !knownPaths.has(target)) {
          if (privatePaths.has(target)) {
            return `<span class="dead private" title="Not exported (inbox note)">${inner}</span>`
          }
          return `<span class="dead" title="Missing page: ${escapeHtml(target)}">${inner}</span>`
        }
        return match
      },
    )
  }

  // ── Pages ───────────────────────────────────────────────────────────────
  for (const entry of entries) {
    const outputPath = pathById.get(entry.id) ?? exportPath(entry.id)
    const href = (id: string) => relativeHref(outputPath, pathById.get(id) ?? exportPath(id))

    let body = entry.body
    const leadingHeading = /^\s*#\s+(.+?)\s*(?:\r?\n)+/.exec(body)
    if (
      leadingHeading &&
      leadingHeading[1]?.replace(/[*_`]/g, '').trim().toLowerCase() ===
        entry.title.trim().toLowerCase()
    ) {
      body = body.slice(leadingHeading[0].length)
    }

    const withImages = rewriteImages(body, entry, outputPath)
    const html = markDeadLinks(renderMarkdown(withImages, href), outputPath)
    const toc = extractToc(html)
    const updatedAt = metaById.get(entry.id)?.updatedAt ?? ''
    const backlinks = backlinksFromGraph(snapshot.graph, entry.id)
      .filter((link) => exportedIds.has(link.fromId))
      .sort((a, b) => a.fromTitle.localeCompare(b.fromTitle))
    const neighbor = neighbors.get(entry.id) ?? {}
    const pagesHref = relativeHref(outputPath, 'pages.html')

    const pageHtml = layout({
      siteTitle,
      pageTitle: entry.title,
      description: entry.summary || plainText(entry.body, 160),
      currentPath: outputPath,
      active: 'page',
      body: pageBody(entry, updatedAt, html, {
        href,
        pagesHref,
        exportedIds,
        titleFor: (id) => titleById.get(id),
        backlinks,
        prev: neighbor.prev,
        next: neighbor.next,
      }),
      toc,
      includeSearch,
      includeGraph,
      showSearchForm: true,
      baseUrl: options.baseUrl,
      canonical: outputPath,
    })
    write(outputPath, pageHtml)
  }

  // ── Root pages ─────────────────────────────────────────────────────────
  const rootHref = (id: string) => pathById.get(id) ?? exportPath(id)
  const categories = [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))
  const uniqueTags = new Set(entries.flatMap((entry) => entry.tags))
  const uniqueSources = new Set(entries.flatMap((entry) => entry.sources))

  const recent = [...entries]
    .sort((a, b) => {
      const aDate = metaById.get(a.id)?.updatedAt ?? ''
      const bDate = metaById.get(b.id)?.updatedAt ?? ''
      return bDate.localeCompare(aDate) || a.title.localeCompare(b.title)
    })
    .slice(0, 8)

  const connected = snapshot.rankedIds
    .filter((id) => exportedIds.has(id))
    .slice(0, 8)
    .map((id) => index.get(id))
    .filter((entry): entry is PageLinkEntry => Boolean(entry))

  const categoryCards = categories
    .map(
      ([category, list]) =>
        `<a class="category-card" href="pages.html#${slugifyHeading(category)}">
          <span class="cat-name">${escapeHtml(category)}</span>
          <span class="cat-count">${list.length}</span>
        </a>`,
    )
    .join('\n')

  const stats = [
    { value: entries.length, label: 'pages' },
    { value: categories.length, label: 'categories' },
    { value: uniqueTags.size, label: 'tags' },
    { value: uniqueSources.size, label: 'sources' },
  ]
    .map(
      (stat) =>
        `<div class="stat"><span class="num">${stat.value}</span><span class="label">${stat.label}</span></div>`,
    )
    .join('')

  const indexHtml = layout({
    siteTitle,
    pageTitle: siteTitle,
    description: `A static export of ${siteTitle}, generated from a Markdown wiki.`,
    currentPath: 'index.html',
    active: 'home',
    includeSearch,
    includeGraph,
    showSearchForm: true,
    baseUrl: options.baseUrl,
    canonical: 'index.html',
    body: `<h1>${escapeHtml(siteTitle)}</h1>
<p class="lede">A static export of the wiki: ${entries.length} pages, linked and searchable, with no server required.</p>
<div class="stats">${stats}</div>
<section class="grid-2">
  <div class="card">
    <h2>Recently updated</h2>
    <ul class="page-list">${pageFromList(recent, rootHref)}</ul>
  </div>
  <div class="card">
    <h2>Most connected</h2>
    <ul class="page-list">${pageFromList(connected, rootHref)}</ul>
  </div>
</section>
<section class="card">
  <h2>Categories</h2>
  <div class="category-grid">${categoryCards}</div>
</section>`,
  })
  write('index.html', indexHtml)

  const categorySections = categories
    .map(
      ([category, list]) => `<section class="card" id="${slugifyHeading(category)}" data-category="${escapeHtml(category)}">
  <div class="section-head"><h2>${escapeHtml(category)}</h2><span class="cat-count">${list.length}</span></div>
  <ul class="page-list">
    ${list
      .map(
        (entry) =>
          `<li data-filter-text="${escapeHtml(
            `${entry.title} ${entry.summary} ${entry.tags.join(' ')} ${entry.id}`.toLowerCase(),
          )}"><a href="${rootHref(entry.id)}">${escapeHtml(entry.title)}</a><span class="summary">${escapeHtml(entry.summary)}</span><time>${escapeHtml(metaById.get(entry.id)?.updatedAt ?? '')}</time></li>`,
      )
      .join('\n')}
  </ul>
</section>`,
    )
    .join('\n')

  const pagesHtml = layout({
    siteTitle,
    pageTitle: 'All pages',
    description: `Every page in ${siteTitle}.`,
    currentPath: 'pages.html',
    active: 'pages',
    includeSearch,
    includeGraph,
    showSearchForm: true,
    baseUrl: options.baseUrl,
    canonical: 'pages.html',
    body: `<h1>All pages</h1>
<p class="stamp">${entries.length} pages across ${categories.length} categories</p>
<label class="filter-label" for="filter">Filter</label>
<input id="filter" class="search-input" type="search" placeholder="Filter by title, tag, or summary…" autocomplete="off">
<p class="empty" id="empty" hidden>No pages match that filter.</p>
${categorySections}
<script>
(function () {
  var input = document.getElementById('filter');
  var empty = document.getElementById('empty');
  var items = Array.prototype.slice.call(document.querySelectorAll('li[data-filter-text]'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('section[data-category]'));
  if (!input) return;
  input.addEventListener('input', function () {
    var query = input.value.trim().toLowerCase();
    var shown = 0;
    items.forEach(function (item) {
      var hit = !query || item.getAttribute('data-filter-text').indexOf(query) !== -1;
      item.hidden = !hit;
      if (hit) shown += 1;
    });
    sections.forEach(function (section) {
      var any = Array.prototype.some.call(section.querySelectorAll('li[data-filter-text]'), function (item) { return !item.hidden; });
      section.hidden = !any;
    });
    empty.hidden = shown !== 0;
  });
})();
</script>`,
  })
  write('pages.html', pagesHtml)

  // ── Search ──────────────────────────────────────────────────────────────
  if (includeSearch) {
    const searchIndex = entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      summary: entry.summary,
      tags: entry.tags,
      text: plainText(entry.body),
      href: relativeHref('search.html', pathById.get(entry.id) ?? exportPath(entry.id)),
    }))

    const searchHtml = layout({
      siteTitle,
      pageTitle: 'Search',
      description: `Search ${siteTitle}.`,
      currentPath: 'search.html',
      active: 'search',
      includeSearch,
      includeGraph,
      showSearchForm: false,
      baseUrl: options.baseUrl,
      canonical: 'search.html',
      body: `<h1>Search</h1>
<form class="search-page" action="search.html" method="get" role="search">
  <input id="q" class="search-input" type="search" name="q" placeholder="Search titles, tags, and text…" autocomplete="off" autofocus>
  <button type="submit">Search</button>
</form>
<p class="stamp" id="summary"></p>
<div id="results" class="results"></div>
<p class="empty" id="empty" hidden>No pages match that query.</p>
<script>
var INDEX = ${safeJson(searchIndex)};
(function () {
  var query = new URLSearchParams(window.location.search).get('q') || '';
  var input = document.getElementById('q');
  var results = document.getElementById('results');
  var summary = document.getElementById('summary');
  var empty = document.getElementById('empty');
  input.value = query;

  function esc(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function mark(text, needle) {
    var safe = esc(text);
    if (!needle) return safe;
    var lowerSafe = safe.toLowerCase();
    var lowerNeedle = esc(needle).toLowerCase();
    if (!lowerNeedle) return safe;
    var out = '';
    var from = 0;
    var at = lowerSafe.indexOf(lowerNeedle);
    while (at !== -1) {
      out += safe.slice(from, at) + '<mark>' + safe.slice(at, at + lowerNeedle.length) + '</mark>';
      from = at + lowerNeedle.length;
      at = lowerSafe.indexOf(lowerNeedle, from);
    }
    return out + safe.slice(from);
  }
  function score(entry, needle) {
    var score = 0;
    if (entry.title.toLowerCase() === needle) score += 20;
    if (entry.title.toLowerCase().indexOf(needle) !== -1) score += 8;
    if (entry.tags.join(' ').toLowerCase().indexOf(needle) !== -1) score += 4;
    if (entry.category.toLowerCase().indexOf(needle) !== -1) score += 3;
    if (entry.summary.toLowerCase().indexOf(needle) !== -1) score += 3;
    if (entry.text.toLowerCase().indexOf(needle) !== -1) score += 1;
    return score;
  }

  var needle = query.trim().toLowerCase();
  if (!needle) {
    summary.textContent = INDEX.length + ' pages indexed.';
    results.innerHTML = '<p class="empty">Type a query above. Titles, tags, summaries, and page text are searched.</p>';
    return;
  }

  var hits = INDEX.map(function (entry) {
    return { entry: entry, score: score(entry, needle) };
  }).filter(function (hit) {
    return hit.score > 0;
  }).sort(function (a, b) {
    return b.score - a.score || a.entry.title.localeCompare(b.entry.title);
  }).slice(0, 50);

  summary.textContent = hits.length + ' result' + (hits.length === 1 ? '' : 's') + ' for “' + query + '”';
  empty.hidden = hits.length !== 0;

  function snippetFor(entry, needle) {
    var source = entry.summary || entry.text;
    var lower = source.toLowerCase();
    var at = lower.indexOf(needle);
    if (at === -1 && entry.text) {
      var bodyLower = entry.text.toLowerCase();
      at = bodyLower.indexOf(needle);
      if (at !== -1) source = entry.text;
    }
    if (at === -1) return source.slice(0, 220);
    var start = Math.max(0, at - 80);
    var end = Math.min(source.length, at + needle.length + 130);
    return (start > 0 ? '…' : '') + source.slice(start, end).trim() + (end < source.length ? '…' : '');
  }

  results.innerHTML = hits.map(function (hit) {
    var entry = hit.entry;
    var snippet = snippetFor(entry, needle);
    return '<article class="result">' +
      '<div class="kind">' + esc(entry.category) + '</div>' +
      '<h3><a href="' + esc(entry.href) + '">' + mark(entry.title, needle) + '</a></h3>' +
      '<p>' + mark(snippet, needle) + '</p>' +
      '</article>';
  }).join('');
})();
</script>`,
    })
    write('search.html', searchHtml)
  }

  // ── Graph ───────────────────────────────────────────────────────────────
  if (includeGraph) {
    const graph: WikiGraph = {
      nodes: new Map(
        [...snapshot.graph.nodes.entries()].filter(
          ([id, node]) => node.exists && exportedIds.has(id),
        ),
      ),
      edges: snapshot.graph.edges.filter(
        (edge) => exportedIds.has(edge.from) && exportedIds.has(edge.to),
      ),
      orphans: snapshot.graph.orphans.filter((id) => exportedIds.has(id)),
      deadLinks: snapshot.graph.deadLinks.filter(
        (link) => exportedIds.has(link.from) && !exportedIds.has(link.to),
      ),
    }

    const orphanList = graph.orphans.length
      ? `<section class="panel"><h2>Orphan pages (${graph.orphans.length})</h2><ul class="chips">${graph.orphans
          .sort()
          .map((id) => `<li><a href="${rootHref(id)}">${escapeHtml(id)}</a></li>`)
          .join('')}</ul></section>`
      : ''
    const deadList = graph.deadLinks.length
      ? `<section class="panel"><h2>Dead links (${graph.deadLinks.length})</h2><ul class="chips">${graph.deadLinks
          .map(
            (link) =>
              `<li><span class="dead">${escapeHtml(link.to)}</span><span class="stamp"> from ${escapeHtml(link.from)}</span></li>`,
          )
          .join('')}</ul></section>`
      : ''

    const graphHtml = layout({
      siteTitle,
      pageTitle: 'Graph',
      description: `The link graph of ${siteTitle}.`,
      currentPath: 'graph.html',
      active: 'graph',
      includeSearch,
      includeGraph,
      showSearchForm: true,
      baseUrl: options.baseUrl,
      canonical: 'graph.html',
      body: `<h1>Page graph</h1>
<p class="stamp">${graph.nodes.size} pages · ${graph.edges.length} links · ${graph.orphans.length} orphans (dashed circles)</p>
<div class="graph-wrap">${renderGraphSvg(graph)}</div>
${orphanList}
${deadList}`,
    })
    write('graph.html', graphHtml)
  }

  // ── 404 ─────────────────────────────────────────────────────────────────
  const base = options.baseUrl?.replace(/\/+$/, '')
  const homeLink = base ? `${base}/` : 'index.html'
  const pagesLink = base ? `${base}/pages.html` : 'pages.html'
  const notFoundHtml = layout({
    siteTitle,
    pageTitle: 'Not found',
    description: 'Page not found.',
    currentPath: '404.html',
    active: '',
    includeSearch,
    includeGraph,
    showSearchForm: true,
    baseUrl: options.baseUrl,
    body: `<div class="card">
  <h1>Page not found</h1>
  <p class="lede">That page is not part of this export. It may have been renamed or removed.</p>
  <p><a href="${escapeHtml(homeLink)}">Return to the overview</a> · <a href="${escapeHtml(pagesLink)}">Browse all pages</a></p>
</div>`,
  })
  write('404.html', notFoundHtml)

  // ── Assets, manifest, sitemap ───────────────────────────────────────────
  write('assets/style.css', SITE_CSS)

  const manifest = {
    generator: 'axiom-wiki',
    version: VERSION,
    generatedAt: GENERATED,
    siteTitle,
    pages: entries.length,
    excludedInbox: inboxEntries.length,
    files,
    media: mediaCount,
  }
  write(MARKER, `${JSON.stringify(manifest, null, 2)}\n`)

  if (options.baseUrl) {
    const base = options.baseUrl.replace(/\/+$/, '')
    const urls = [
      '',
      'pages.html',
      ...(includeSearch ? ['search.html'] : []),
      ...(includeGraph ? ['graph.html'] : []),
      ...entries.map((entry) => pathById.get(entry.id) ?? exportPath(entry.id)),
    ]
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((rel) => `  <url><loc>${escapeHtml(rel ? `${base}/${rel}` : `${base}/`)}</loc></url>`).join('\n')}
</urlset>
`
    write('sitemap.xml', sitemap)
    write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`)
  }

  return {
    outDir,
    title: siteTitle,
    pages: entries.length,
    excludedInbox: inboxEntries.length,
    files,
    media: mediaCount,
    deadLinks: snapshot.graph.deadLinks.filter(
      (link) => exportedIds.has(link.from) && !exportedIds.has(link.to),
    ).length,
    categories: Object.fromEntries(categories.map(([category, list]) => [category, list.length])),
    bytes: dirSize(outDir),
  }
}

// ── Stylesheet ────────────────────────────────────────────────────────────

const SITE_CSS = `
:root {
  color-scheme: dark;
  --space: #09090b;
  --surface: #18181b;
  --surface-2: #1f1f23;
  --ghost: #f4f4f5;
  --graphite: #a1a1aa;
  --muted: #71717a;
  --cyan: #06b6d4;
  --amber: #f59e0b;
  --danger: #f87171;
  --line: rgba(63, 63, 70, 0.65);
  --line-soft: rgba(39, 39, 42, 0.75);
  --display: "Geist", "Söhne", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --body: "Satoshi", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --max: 1180px;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--space);
  color: var(--ghost);
  font-family: var(--body);
  font-size: 16px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a { color: var(--cyan); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 3px; }
a:focus-visible, button:focus-visible, input:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 2px;
}
.skip {
  position: absolute; left: -999px; top: 0; z-index: 50;
  background: var(--cyan); color: var(--space); padding: 8px 14px;
  font-family: var(--mono); font-size: 0.72rem;
}
.skip:focus { left: 12px; top: 12px; }

.topbar {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: 24px;
  padding: 12px 28px;
  background: rgba(9, 9, 11, 0.93);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
}
.brand {
  display: inline-flex; align-items: center; gap: 8px;
  color: var(--ghost); font-family: var(--display);
  font-weight: 700; letter-spacing: -0.015em; white-space: nowrap;
}
.brand-mark { color: var(--cyan); font-size: 1.05rem; }
.topnav {
  display: flex; gap: 18px;
  font-family: var(--mono); font-size: 0.68rem;
  text-transform: uppercase; letter-spacing: 0.1em;
}
.topnav a { color: var(--graphite); }
.topnav a:hover, .topnav a.active { color: var(--cyan); text-decoration: none; }
.search { margin-left: auto; display: flex; gap: 8px; }
.search input, .search-input {
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ghost);
  font-family: var(--mono);
  font-size: 0.72rem;
  padding: 7px 10px;
  border-radius: 2px;
  min-width: 220px;
}
.search input::placeholder, .search-input::placeholder { color: var(--muted); }
.search button, .search-page button {
  border: 1px solid rgba(6, 182, 212, 0.4);
  background: rgba(6, 182, 212, 0.1);
  color: var(--cyan);
  font-family: var(--mono);
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 7px 12px;
  border-radius: 2px;
  cursor: pointer;
}
.search button:hover, .search-page button:hover { background: rgba(6, 182, 212, 0.18); }

.shell {
  max-width: var(--max);
  margin: 0 auto;
  padding: 32px 24px 80px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 36px;
}
.shell.with-toc { grid-template-columns: minmax(0, 1fr) 220px; }
.content { min-width: 0; max-width: 76ch; }
.with-toc .content { max-width: none; }

h1, h2, h3, h4 { font-family: var(--display); letter-spacing: -0.015em; line-height: 1.25; }
h1 { font-size: 2rem; margin: 0 0 0.6rem; }
.lede { color: var(--graphite); font-size: 1.03rem; margin: 0 0 2rem; border-left: 2px solid var(--line); padding-left: 14px; }
.crumbs {
  display: flex; gap: 8px; align-items: center;
  font-family: var(--mono); font-size: 0.64rem;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted); margin-bottom: 14px;
}
.crumbs a { color: var(--graphite); }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 0.8rem 0 1.4rem; }
.tag {
  font-family: var(--mono); font-size: 0.6rem;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--cyan);
  border: 1px solid rgba(6, 182, 212, 0.3);
  background: rgba(6, 182, 212, 0.08);
  padding: 3px 8px;
}
.stamp { font-family: var(--mono); font-size: 0.62rem; color: var(--muted); }

.prose { max-width: 72ch; }
.prose h1 { font-size: 1.75rem; margin: 2.2rem 0 0.9rem; }
.prose h2 { font-size: 1.32rem; margin: 2.3rem 0 0.8rem; padding-bottom: 0.35rem; border-bottom: 1px solid var(--line-soft); }
.prose h3 { font-size: 1.08rem; margin: 1.7rem 0 0.5rem; }
.prose h4 { font-size: 0.98rem; margin: 1.4rem 0 0.4rem; color: var(--graphite); }
.prose p { margin: 0.95rem 0; }
.prose ul, .prose ol { padding-left: 1.4rem; margin: 0.9rem 0; }
.prose li { margin: 0.32rem 0; }
.prose li::marker { color: var(--muted); }
.prose strong { color: #fff; font-weight: 650; }
.prose code {
  font-family: var(--mono); font-size: 0.85em;
  background: rgba(113, 113, 122, 0.18);
  padding: 1px 5px; border-radius: 3px;
}
.prose pre {
  background: var(--surface);
  border: 1px solid var(--line);
  padding: 14px 16px;
  overflow-x: auto;
  border-radius: 3px;
  line-height: 1.55;
}
.prose pre code { background: none; padding: 0; font-size: 0.82rem; }
.prose blockquote {
  margin: 1.3rem 0;
  padding: 0.25rem 0 0.25rem 16px;
  border-left: 2px solid var(--cyan);
  color: var(--graphite);
}
.prose table { width: 100%; border-collapse: collapse; margin: 1.3rem 0; font-size: 0.9rem; }
.prose th, .prose td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
.prose th {
  font-family: var(--mono); font-size: 0.62rem;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--graphite); border-bottom-color: var(--line);
}
.prose img { max-width: 100%; height: auto; border: 1px solid var(--line); }
.prose hr { border: 0; border-top: 1px solid var(--line); margin: 2.2rem 0; }

.citation {
  display: inline-flex; align-items: baseline; gap: 4px;
  font-family: var(--mono); font-size: 0.7rem;
  color: var(--cyan);
  background: rgba(6, 182, 212, 0.1);
  border: 1px solid rgba(6, 182, 212, 0.22);
  padding: 1px 6px; margin: 0 2px;
  white-space: nowrap;
}
.cite-grade { font-size: 0.58rem; text-transform: uppercase; opacity: 0.75; font-weight: 600; }
.dead {
  color: var(--danger);
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  cursor: help;
}
.dead.private { color: var(--amber); }

.card, .panel {
  border: 1px solid var(--line);
  background: var(--surface);
  padding: 18px 20px;
  margin: 18px 0;
  border-radius: 2px;
}
.card h2, .panel h2, .section-head h2 {
  font-size: 0.92rem; margin: 0 0 12px; color: var(--ghost);
}
.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.grid-2 { display: grid; grid-template-columns: 1.35fr 1fr; gap: 18px; margin: 18px 0; }
.grid-2 .card { margin: 0; }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin: 22px 0 28px; }
.stat { border: 1px solid var(--line); background: var(--surface); padding: 14px 16px; }
.stat .num { display: block; font-family: var(--mono); font-size: 1.55rem; color: var(--cyan); line-height: 1.1; }
.stat .label { display: block; margin-top: 4px; font-family: var(--mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }

.category-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.category-card {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  border: 1px solid var(--line-soft); background: var(--surface-2);
  padding: 12px 14px; color: var(--ghost);
}
.category-card:hover { border-color: rgba(6, 182, 212, 0.45); text-decoration: none; }
.cat-name { font-family: var(--mono); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; }
.cat-count { font-family: var(--mono); font-size: 0.72rem; color: var(--cyan); }

.page-list { list-style: none; padding: 0; margin: 0; }
.page-list li {
  display: flex; align-items: baseline; gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line-soft);
}
.page-list li:last-child { border-bottom: 0; }
.page-list a { color: var(--ghost); font-weight: 500; }
.page-list a:hover { color: var(--cyan); }
.page-list .summary { flex: 1; min-width: 0; color: var(--muted); font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-list time { font-family: var(--mono); font-size: 0.6rem; color: var(--muted); white-space: nowrap; }

.chips { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.chips li { font-family: var(--mono); font-size: 0.68rem; }
.chips a { border: 1px solid var(--line); background: var(--surface-2); padding: 3px 8px; display: inline-block; }
.chips a:hover { border-color: var(--cyan); text-decoration: none; }

.pager { display: flex; justify-content: space-between; gap: 16px; margin-top: 36px; padding-top: 18px; border-top: 1px solid var(--line); }
.pager a { display: flex; flex-direction: column; gap: 3px; max-width: 48%; }
.pager a.next { text-align: right; margin-left: auto; }
.pager span { font-family: var(--mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
.pager strong { font-family: var(--display); font-size: 0.88rem; color: var(--ghost); }
.pager a:hover { text-decoration: none; }
.pager a:hover strong { color: var(--cyan); }

.toc { position: sticky; top: 78px; align-self: start; border-left: 1px solid var(--line); padding-left: 16px; max-height: calc(100vh - 110px); overflow: auto; }
.toc h2 { font-family: var(--mono); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin: 0 0 10px; }
.toc ul { list-style: none; padding: 0; margin: 0; }
.toc li { margin: 5px 0; }
.toc a { color: var(--graphite); font-size: 0.78rem; }
.toc a:hover { color: var(--cyan); }
.toc .lvl-3 { padding-left: 10px; font-size: 0.92em; }

.filter-label {
  display: block; margin: 22px 0 6px;
  font-family: var(--mono); font-size: 0.6rem;
  text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted);
}
.search-input { width: 100%; max-width: 520px; }
.search-page { display: flex; gap: 8px; margin: 20px 0 8px; }
.search-page .search-input { flex: 1; max-width: none; min-width: 0; padding: 10px 12px; }
.empty { color: var(--muted); font-size: 0.9rem; padding: 18px 0; }
.results { margin-top: 12px; }
.result { padding: 16px 0; border-bottom: 1px solid var(--line-soft); }
.result:last-child { border-bottom: 0; }
.result .kind { font-family: var(--mono); font-size: 0.56rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
.result h3 { margin: 3px 0 4px; font-size: 1.02rem; }
.result h3 a { color: var(--ghost); }
.result h3 a:hover { color: var(--cyan); }
.result p { margin: 4px 0 0; color: var(--graphite); font-size: 0.9rem; }
mark { background: rgba(6, 182, 212, 0.28); color: var(--ghost); padding: 0 1px; }

.graph-wrap { border: 1px solid var(--line); background: var(--surface); padding: 12px; overflow: auto; }
.graph-wrap svg { display: block; min-width: 620px; }

.footer {
  max-width: var(--max); margin: 0 auto;
  padding: 16px 24px 44px;
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px;
  border-top: 1px solid var(--line);
  font-family: var(--mono); font-size: 0.6rem; color: var(--muted);
}

@media (max-width: 900px) {
  .shell.with-toc { grid-template-columns: minmax(0, 1fr); }
  .toc { display: none; }
  .grid-2 { grid-template-columns: 1fr; }
  .topbar { flex-wrap: wrap; gap: 12px; padding: 12px 18px; }
  .topnav { order: 3; width: 100%; gap: 14px; }
  .search { margin-left: 0; width: 100%; }
  .search input { flex: 1; min-width: 0; }
  .shell { padding: 24px 18px 64px; }
  .page-list .summary { display: none; }
  h1 { font-size: 1.65rem; }
}

@media print {
  :root {
    color-scheme: light;
    --space: #fff; --surface: #fff; --surface-2: #fff;
    --ghost: #111; --graphite: #333; --muted: #555;
    --line: #d4d4d8; --line-soft: #e4e4e7; --cyan: #0b7285; --danger: #b91c1c;
  }
  .topbar, .toc, .footer, .search, .pager { display: none; }
  .shell { display: block; max-width: none; padding: 0; }
  a { color: #111; text-decoration: underline; }
  .prose { max-width: none; }
}
`
