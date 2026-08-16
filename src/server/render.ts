import { marked } from 'marked'
import type { PageMeta, WikiStatus } from '../core/wiki.js'
import type { SearchResult } from '../core/search.js'
import type { WikiGraph } from '../core/graph.js'

/**
 * Pure rendering helpers for the read-only web UI.
 * No filesystem or network access — everything here is testable string-in/string-out.
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

/**
 * Rewrites wiki-links and relative .md links into internal routes,
 * before markdown parsing. Supports:
 *   [[entities/foo]]        -> [entities/foo](/page/entities/foo)
 *   [[foo]]                 -> [foo](/page/entities/foo)   (entities is the default, like graph.ts)
 *   [[entities/foo|Title]]  -> [Title](/page/entities/foo)
 *   [text](../entities/foo.md) / [text](entities/foo.md) -> [text](/page/entities/foo)
 */
export function rewriteWikiLinks(markdown: string): string {
  let out = markdown.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_m, rawId: string, alias?: string) => {
      const id = rawId.trim().includes('/') ? rawId.trim() : `entities/${rawId.trim()}`
      return `[${(alias ?? rawId).trim()}](${pageHref(id)})`
    },
  )

  out = out.replace(
    /\[([^\]]*)\]\(([^)]+\.md)\)/g,
    (m, text: string, href: string) => {
      if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(href)) return m // external URL, leave untouched
      const clean = href
        .replace(/^\.\//, '')
        .replace(/^\.\.\//, '')
        .replace(/^\/?wiki\/pages\//, '')
        .replace(/\.md$/, '')
      return `[${text}](${pageHref(clean)})`
    },
  )

  return out
}

export function renderMarkdown(markdown: string): string {
  return marked.parse(rewriteWikiLinks(markdown), { async: false }) as string
}

const CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.6; background: #fafafa; color: #1c1c1e;
}
@media (prefers-color-scheme: dark) {
  body { background: #111114; color: #e8e8ea; }
  a { color: #9db4ff; }
  header { border-color: #2a2a30 !important; background: #17171b; }
  .card, .muted-box { border-color: #2a2a30 !important; background: #1a1a1f; }
  .tag { background: #26262c; }
  .dead { color: #ff8f8f; }
}
a { color: #3b5bdb; text-decoration: none; }
a:hover { text-decoration: underline; }
header {
  display: flex; align-items: center; gap: 18px; padding: 12px 28px;
  border-bottom: 1px solid #e2e2e6; background: #fff; position: sticky; top: 0;
}
header .brand { font-weight: 700; letter-spacing: 0.02em; }
header nav { display: flex; gap: 16px; }
header form { margin-left: auto; display: flex; gap: 8px; }
header input {
  padding: 5px 10px; border: 1px solid #ccc; border-radius: 6px;
  background: transparent; color: inherit; min-width: 220px;
}
header button {
  padding: 5px 12px; border: none; border-radius: 6px; cursor: pointer;
  background: #3b5bdb; color: #fff;
}
main { max-width: 880px; margin: 0 auto; padding: 28px 24px 64px; }
h1 { font-size: 1.7rem; margin: 0 0 4px; }
.card {
  border: 1px solid #e2e2e6; border-radius: 10px; padding: 16px 20px;
  margin: 14px 0; background: #fff;
}
.card h2 { margin: 0 0 8px; font-size: 1.05rem; }
.meta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 6px 0 18px; }
.meta span { font-size: 0.85rem; opacity: 0.75; }
.tag {
  font-size: 0.75rem; padding: 2px 9px; border-radius: 99px; background: #eceefc;
}
.muted { opacity: 0.65; }
.muted-box {
  border: 1px dashed #cfcfd4; border-radius: 10px; padding: 20px 24px;
  margin: 18px 0; background: #f6f6f8; font-size: 0.95rem;
}
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #e2e2e6; font-size: 0.92rem; }
code { background: rgba(127,127,127,0.14); padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
pre { overflow-x: auto; padding: 14px; border-radius: 8px; background: rgba(127,127,127,0.12); }
pre code { background: none; padding: 0; }
blockquote { margin: 0; padding-left: 14px; border-left: 3px solid rgba(127,127,127,0.35); opacity: 0.85; }
.dead { color: #c92a2a; }
.result { padding: 12px 0; border-bottom: 1px solid #e2e2e6; }
.result:last-child { border-bottom: none; }
.result .summary { font-size: 0.9rem; opacity: 0.8; }
footer { text-align: center; opacity: 0.5; font-size: 0.8rem; padding: 24px; }
`

export function layout(title: string, active: string, body: string): string {
  const navItem = (href: string, label: string) =>
    `<a href="${href}"${active === label.toLowerCase() ? ' style="font-weight:600"' : ''}>${label}</a>`
  const search = active === 'search'
    ? ''
    : `<form action="/search" method="get"><input type="search" name="q" placeholder="Search the wiki…" aria-label="Search"><button type="submit">Search</button></form>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Axiom Wiki</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <span class="brand">◈ Axiom Wiki</span>
  <nav>
    ${navItem('/', 'Home')}
    ${navItem('/pages', 'Pages')}
    ${navItem('/graph', 'Graph')}
  </nav>
  ${search}
</header>
<main>
${body}
</main>
<footer>Read-only view · served by <code>axiom-wiki serve</code></footer>
</body>
</html>`
}

export function renderDashboard(status: WikiStatus, recent: PageMeta[]): string {
  const cats = Object.entries(status.pagesByCategory)
    .map(([c, n]) => `<tr><td><a href="/pages#${c}">${escapeHtml(c)}</a></td><td>${n}</td></tr>`)
    .join('')
  const health = status.semanticHealth
  const sem = health
    ? `<span class="tag">${health.status === 'healthy' ? '✓' : '!'} semantic: ${escapeHtml(health.provider)}${health.model ? ` · ${escapeHtml(health.model)}` : ''} · ${health.status}</span>`
    : ''
  const recentHtml = recent.length === 0
    ? '<p class="muted">No pages yet — ingest a source to get started.</p>'
    : recent.map((p) =>
        `<div class="result"><a href="${pageHref(idFromPath(p.path))}">${escapeHtml(p.title)}</a>` +
        `<div class="summary">${escapeHtml(p.summary)}</div></div>`,
      ).join('')
  return layout('Home', 'home', `
<h1>Wiki overview</h1>
<div class="meta">
  <span><strong>${status.totalPages}</strong> pages</span>
  <span><strong>${status.rawSourceCount}</strong> raw sources</span>
  ${status.lastIngest ? `<span>last ingest ${escapeHtml(status.lastIngest)}</span>` : '<span>never ingested</span>'}
  ${sem}
</div>
<div class="card"><h2>Pages by category</h2><table>${cats || '<tr><td class="muted">none</td></tr>'}</table></div>
<div class="card"><h2>Recently updated</h2>${recentHtml}</div>`)
}

/** "wiki/pages/entities/foo.md" -> "entities/foo" */
export function idFromPath(p: string): string {
  return p.replace(/^wiki\/pages\//, '').replace(/\.md$/, '')
}

export function renderPageList(pages: PageMeta[]): string {
  const byCat = new Map<string, PageMeta[]>()
  for (const p of pages) {
    const list = byCat.get(p.category) ?? []
    list.push(p)
    byCat.set(p.category, list)
  }
  const sections = [...byCat.entries()].sort().map(([cat, list]) => `
<section class="card" id="${escapeHtml(cat)}">
<h2>${escapeHtml(cat)} <span class="muted">(${list.length})</span></h2>
<table>
${list
  .map((p) =>
    `<tr><td><a href="${pageHref(idFromPath(p.path))}">${escapeHtml(p.title)}</a></td>` +
    `<td class="muted">${escapeHtml(p.summary)}</td><td class="muted">${escapeHtml(p.updatedAt)}</td></tr>`,
  )
  .join('\n')}
</table>
</section>`).join('')
  return layout('Pages', 'pages', `
<h1>All pages</h1>
<p class="muted">${pages.length} pages across ${byCat.size} categories</p>
${sections || '<p class="muted">No pages yet.</p>'}`)
}

export interface PageFrontmatter {
  title: string
  summary: string
  tags: string[]
  category: string
  updatedAt: string
  sources: string[]
}

export function renderWikiPage(id: string, frontmatter: PageFrontmatter, bodyMarkdown: string): string {
  const tags = frontmatter.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(' ')
  const sources = frontmatter.sources.length
    ? `<div class="meta"><span>sources: ${frontmatter.sources.map(escapeHtml).join(', ')}</span></div>`
    : ''
  return layout(frontmatter.title, 'pages', `
<p class="muted"><a href="/pages">${escapeHtml(frontmatter.category)}</a> / ${escapeHtml(id)}</p>
<h1>${escapeHtml(frontmatter.title)}</h1>
<div class="meta">
  ${tags}
  <span>updated ${escapeHtml(frontmatter.updatedAt)}</span>
</div>
${frontmatter.summary ? `<p><em>${escapeHtml(frontmatter.summary)}</em></p>` : ''}
${sources}
${renderMarkdown(bodyMarkdown)}`)
}

export function renderSearchResults(query: string, results: SearchResult[]): string {
  const body = !query
    ? '<p class="muted">Type a query in the box above.</p>'
    : results.length === 0
      ? `<p class="muted">No results for “${escapeHtml(query)}”.</p>`
      : results
        .map(
          (r) => `<div class="result">
<a href="${pageHref(idFromPath(r.path))}">${escapeHtml(r.title)}</a>
<div class="summary">${escapeHtml(r.excerpt)}</div>
</div>`,
        )
        .join('')
  return layout(query ? `Search: ${query}` : 'Search', 'search', `
<h1>Search</h1>
${query ? `<p class="muted">${results.length} results for “${escapeHtml(query)}”</p>` : ''}
${body}`)
}

export function renderErrorPage(title: string, message: string): string {
  return layout(title, '', `
<div class="muted-box">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</div>`)
}

/**
 * Renders the wiki graph as a self-contained SVG.
 * Nodes are placed on a circle grouped by category; edges are chords.
 * Deterministic — same graph, same picture.
 */
export function renderGraphSvg(graph: WikiGraph): string {
  const W = 920
  const H = 720
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W, H) / 2 - 70

  const nodes = [...graph.nodes.values()].filter((n) => n.exists)
  const catColor: Record<string, string> = {
    entities: '#3b5bdb',
    concepts: '#0ca678',
    sources: '#f08c00',
    analyses: '#d6336c',
  }
  const colorOf = (cat: string) => catColor[cat] ?? '#868e96'

  nodes.sort((a, b) => (a.category + a.id).localeCompare(b.category + b.id))
  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * 2 * Math.PI - Math.PI / 2
    pos.set(n.id, { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) })
  })

  const edges = graph.edges
    .filter((e) => pos.has(e.from) && pos.has(e.to))
    .map((e) => {
      const a = pos.get(e.from)!
      const b = pos.get(e.to)!
      return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"/>`
    })
    .join('\n')

  const circles = nodes
    .map((n) => {
      const p = pos.get(n.id)!
      const orphan = graph.orphans.includes(n.id)
      return `<g>
<title>${escapeHtml(`${n.title} (${n.category})${orphan ? ' — orphan' : ''}`)}</title>
<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${orphan ? 7 : 5}" fill="${colorOf(n.category)}" ${orphan ? 'stroke="currentColor" stroke-width="1.5" stroke-dasharray="2,2"' : ''}/>
<text x="${p.x.toFixed(1)}" y="${(p.y - 11).toFixed(1)}" font-size="9" text-anchor="middle" fill="currentColor" opacity="0.8">${escapeHtml(n.title.slice(0, 24))}</text>
</g>`
    })
    .join('\n')

  const legend = Object.entries(catColor)
    .map(([cat, c], i) => `<g transform="translate(16, ${20 + i * 18})"><circle r="5" cx="6" cy="-3" fill="${c}"/><text x="18" font-size="12" fill="currentColor">${cat}</text></g>`)
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wiki page graph" style="max-width:100%;height:auto;color:inherit">
${edges}
${circles}
${legend}
</svg>`
}

export function renderGraphPage(graph: WikiGraph): string {
  const dead = graph.deadLinks.length
    ? `<div class="card"><h2>Dead links (${graph.deadLinks.length})</h2><ul>${graph.deadLinks
        .map((d) => `<li><code>${escapeHtml(d.from)}</code> → <span class="dead">${escapeHtml(d.to)}</span></li>`)
        .join('')}</ul></div>`
    : ''
  const orphans = graph.orphans.length
    ? `<p class="muted">${graph.orphans.length} orphan pages (dashed circles)</p>`
    : ''
  return layout('Graph', 'graph', `
<h1>Page graph</h1>
${orphans}
${renderGraphSvg(graph)}
${dead}`)
}
