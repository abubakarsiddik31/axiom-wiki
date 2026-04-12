import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

export interface PageMeta {
  path: string
  title: string
  summary: string
  tags: string[]
  category: string
  updatedAt: string
}

export interface SearchResult {
  path: string
  title: string
  excerpt: string
  score: number
}

export interface WikiStatus {
  totalPages: number
  pagesByCategory: Record<string, number>
  rawSourceCount: number
  wikiSizeBytes: number
  lastIngest: string | null
  lastQuery: string | null
  lastLint: string | null
}

const SCHEMA_MD = `# Wiki Schema

## Page Frontmatter

Every wiki page starts with YAML frontmatter:

\`\`\`yaml
---
title: Page Title
summary: One-line description of this page
tags: [tag1, tag2]
category: entities | concepts | sources | analyses
sources: [sources/source-name]
updatedAt: YYYY-MM-DD
---
\`\`\`

## Naming Conventions

- File names use kebab-case: \`alan-turing.md\`, \`turing-completeness.md\`
- Titles are descriptive: "Alan Turing" not "turing"
- Source pages named after their source: \`intelligence-trap.md\`

## Cross-References

Use wiki-link style for cross-references:
- \`[[entities/alan-turing]]\`
- \`[[concepts/turing-completeness]]\`

## Categories

- **entities/** — People, places, organisations, things
- **concepts/** — Ideas, topics, themes, theories
- **sources/** — One summary page per raw source file
- **analyses/** — Comparison pages, filed answers, syntheses
`

const INDEX_TEMPLATE = `# Wiki Index
_Last updated: {DATE}_

## Entities

## Concepts

## Sources

## Analyses
`

const LOG_TEMPLATE = `# Wiki Log
<!-- Append-only. Do not edit manually. -->

`

const AXIOMIGNORE_DEFAULTS = `# axiomignore — patterns to skip during watch/ingest
# Uses the same syntax as .gitignore

# Temporary files
*.tmp
*.swp
.DS_Store
`

export async function scaffoldWiki(wikiDir: string): Promise<void> {
  const dirs = [
    'raw/assets',
    'wiki/pages/entities',
    'wiki/pages/concepts',
    'wiki/pages/sources',
    'wiki/pages/analyses',
    '.axiom',
  ]
  for (const dir of dirs) {
    fs.mkdirSync(path.join(wikiDir, dir), { recursive: true })
  }

  const indexPath = path.join(wikiDir, 'wiki/index.md')
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, INDEX_TEMPLATE.replace('{DATE}', today()))
  }

  const logPath = path.join(wikiDir, 'wiki/log.md')
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, LOG_TEMPLATE)
  }

  const schemaPath = path.join(wikiDir, 'wiki/schema.md')
  if (!fs.existsSync(schemaPath)) {
    fs.writeFileSync(schemaPath, SCHEMA_MD)
  }

  const axiomConfigPath = path.join(wikiDir, '.axiom/config.json')
  if (!fs.existsSync(axiomConfigPath)) {
    fs.writeFileSync(axiomConfigPath, '{}')
  }

  const stateJsonPath = path.join(wikiDir, '.axiom/state.json')
  if (!fs.existsSync(stateJsonPath)) {
    fs.writeFileSync(stateJsonPath, JSON.stringify({ version: 1, sources: {}, frozenSlugs: [] }, null, 2))
  }

  const rawDir = path.join(wikiDir, 'raw')
  fs.mkdirSync(rawDir, { recursive: true })
  const axiomignorePath = path.join(rawDir, '.axiomignore')
  if (!fs.existsSync(axiomignorePath)) {
    fs.writeFileSync(axiomignorePath, AXIOMIGNORE_DEFAULTS)
  }
}

export async function readPage(wikiDir: string, pagePath: string): Promise<string> {
  const abs = path.join(wikiDir, pagePath)
  if (!fs.existsSync(abs)) {
    throw new Error(`Page not found: ${pagePath}`)
  }
  return fs.readFileSync(abs, 'utf-8')
}

export async function writePage(wikiDir: string, pagePath: string, content: string): Promise<void> {
  const abs = path.join(wikiDir, pagePath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const tmp = abs + '.tmp'
  fs.writeFileSync(tmp, content, 'utf-8')
  fs.renameSync(tmp, abs)
}

export async function listPages(
  wikiDir: string,
  filter?: string,
  category?: string,
): Promise<PageMeta[]> {
  const pagesDir = path.join(wikiDir, 'wiki/pages')
  if (!fs.existsSync(pagesDir)) return []

  const files = walkDir(pagesDir).filter((f) => f.endsWith('.md'))
  const results: PageMeta[] = []

  for (const abs of files) {
    const rel = path.relative(wikiDir, abs)
    const raw = fs.readFileSync(abs, 'utf-8')
    let data: Record<string, unknown> = {}
    try { data = matter(raw).data } catch { /* skip pages with invalid frontmatter YAML */ }
    const stat = fs.statSync(abs)

    const cat = rel.split('/')[2] ?? ''

    if (category && cat !== category) continue

    const meta: PageMeta = {
      path: rel,
      title: String(data['title'] ?? path.basename(abs, '.md')),
      summary: String(data['summary'] ?? ''),
      tags: Array.isArray(data['tags']) ? data['tags'] : [],
      category: String(data['category'] ?? cat),
      updatedAt: String(data['updatedAt'] ?? stat.mtime.toISOString().slice(0, 10)),
    }

    if (filter) {
      const lf = filter.toLowerCase()
      if (!meta.title.toLowerCase().includes(lf) && !meta.summary.toLowerCase().includes(lf)) {
        continue
      }
    }

    results.push(meta)
  }

  return results
}

export async function searchWiki(
  wikiDir: string,
  query: string,
  limit = 10,
): Promise<SearchResult[]> {
  const pagesDir = path.join(wikiDir, 'wiki/pages')
  if (!fs.existsSync(pagesDir)) return []

  const files = walkDir(pagesDir).filter((f) => f.endsWith('.md'))
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const results: SearchResult[] = []

  for (const abs of files) {
    const rel = path.relative(wikiDir, abs)
    const raw = fs.readFileSync(abs, 'utf-8')
    const { data, content } = matter(raw)
    const lower = content.toLowerCase()

    let score = 0
    for (const term of terms) {
      const matches = lower.split(term).length - 1
      score += matches
    }

    if (score === 0) continue

    const firstIdx = lower.indexOf(terms[0] ?? '')
    const start = Math.max(0, firstIdx - 60)
    const excerpt = content.slice(start, start + 150).replace(/\n/g, ' ').trim()

    results.push({
      path: rel,
      title: String(data['title'] ?? path.basename(abs, '.md')),
      excerpt,
      score: score / (content.length / 1000 + 1),
    })
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function buildIndex(pages: PageMeta[]): string {
  const byCategory: Record<string, PageMeta[]> = {
    entities: [],
    concepts: [],
    sources: [],
    analyses: [],
  }

  for (const p of pages) {
    const cat = p.category in byCategory ? p.category : 'entities'
    byCategory[cat].push(p)
  }

  const lines: string[] = [`# Wiki Index`, `_Last updated: ${today()}_`, '']

  for (const [cat, entries] of Object.entries(byCategory)) {
    lines.push(`## ${capitalize(cat)}`)
    if (entries.length === 0) {
      lines.push('')
    } else {
      for (const e of entries) {
        const linkPath = e.path.replace(/^wiki\//, '').replace(/\.md$/, '')
        const tagStr = e.tags.length > 0 ? ' · ' + e.tags.join(', ') : ''
        lines.push(`- [[${linkPath}]] — ${e.title} · ${e.summary}${tagStr}`)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}

export async function updateIndex(wikiDir: string): Promise<void> {
  const pages = await listPages(wikiDir)
  const content = buildIndex(pages)
  await writePage(wikiDir, 'wiki/index.md', content)
}

export async function appendLog(
  wikiDir: string,
  entry: string,
  type: 'ingest' | 'query' | 'lint' | 'status' | 'map' | 'sync',
): Promise<void> {
  const logPath = path.join(wikiDir, 'wiki/log.md')
  const line = `## [${today()}] ${type} | ${entry}\n`
  fs.appendFileSync(logPath, line, 'utf-8')
}

export async function getStatus(wikiDir: string, rawDir: string): Promise<WikiStatus> {
  const pages = await listPages(wikiDir)
  const pagesByCategory: Record<string, number> = {}
  for (const p of pages) {
    pagesByCategory[p.category] = (pagesByCategory[p.category] ?? 0) + 1
  }

  const rawFiles = fs.existsSync(rawDir)
    ? fs.readdirSync(rawDir).filter((f: string) => {
        const full = path.join(rawDir, f)
        return fs.statSync(full).isFile()
      })
    : []

  const wikiSize = dirSize(path.join(wikiDir, 'wiki'))

  const logPath = path.join(wikiDir, 'wiki/log.md')
  let lastIngest: string | null = null
  let lastQuery: string | null = null
  let lastLint: string | null = null

  if (fs.existsSync(logPath)) {
    const log = fs.readFileSync(logPath, 'utf-8')
    const logLines = log.split('\n').filter((l: string) => l.startsWith('## ['))
    for (const line of logLines) {
      const m = line.match(/^## \[(\d{4}-\d{2}-\d{2})\] (\w+) \|/)
      if (!m) continue
      const [, date, type] = m
      if (type === 'ingest') lastIngest = date ?? null
      if (type === 'query') lastQuery = date ?? null
      if (type === 'lint') lastLint = date ?? null
    }
  }

  return {
    totalPages: pages.length,
    pagesByCategory,
    rawSourceCount: rawFiles.length,
    wikiSizeBytes: wikiSize,
    lastIngest,
    lastQuery,
    lastLint,
  }
}

export function snapshotWiki(wikiDir: string): Map<string, number> {
  const snap = new Map<string, number>()
  const pagesDir = path.join(wikiDir, 'wiki/pages')
  const extras = [path.join(wikiDir, 'wiki/index.md'), path.join(wikiDir, 'wiki/log.md')]
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else snap.set(full, fs.statSync(full).mtimeMs)
    }
  }
  walk(pagesDir)
  for (const f of extras) if (fs.existsSync(f)) snap.set(f, fs.statSync(f).mtimeMs)
  return snap
}

export function diffWiki(
  before: Map<string, number>,
  wikiDir: string,
): Array<{ path: string; type: 'created' | 'modified' }> {
  const after = snapshotWiki(wikiDir)
  const changes: Array<{ path: string; type: 'created' | 'modified' }> = []
  for (const [file, mtime] of after) {
    const rel = path.relative(wikiDir, file)
    const prev = before.get(file)
    if (prev === undefined) changes.push({ path: rel, type: 'created' })
    else if (mtime > prev) changes.push({ path: rel, type: 'modified' })
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function walkDir(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) files.push(...walkDir(full))
    else files.push(full)
  }
  return files
}

function dirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  return walkDir(dir).reduce((acc, f) => acc + fs.statSync(f).size, 0)
}
