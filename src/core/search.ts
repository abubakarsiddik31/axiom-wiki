import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

export interface SearchResult {
  path: string
  title: string
  summary: string
  excerpt: string
  score: number
  matchCount: number
}

export async function searchWiki(
  wikiDir: string,
  query: string,
  options?: {
    limit?: number
    category?: string
  },
): Promise<SearchResult[]> {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (terms.length === 0) return []

  const limit = options?.limit ?? 10
  const pagesDir = options?.category
    ? path.join(wikiDir, 'wiki/pages', options.category)
    : path.join(wikiDir, 'wiki/pages')

  if (!fs.existsSync(pagesDir)) return []

  const files = walkDir(pagesDir).filter((f) => f.endsWith('.md'))
  const results: SearchResult[] = []

  for (const abs of files) {
    const rel = path.relative(wikiDir, abs)
    const raw = fs.readFileSync(abs, 'utf-8')
    const { data, content } = matter(raw)

    const title = String(data['title'] ?? path.basename(abs, '.md'))
    const summary = String(data['summary'] ?? '')
    const tags = Array.isArray(data['tags']) ? (data['tags'] as string[]).join(' ') : ''

    // Search across frontmatter fields + body
    const searchable = `${title} ${summary} ${tags} ${content}`.toLowerCase()

    let matchCount = 0
    for (const term of terms) {
      matchCount += countOccurrences(searchable, term)
    }

    if (matchCount === 0) continue

    const score = matchCount / (searchable.length / 1000 + 1)
    const excerpt = buildExcerpt(content, terms)

    results.push({ path: rel, title, summary, excerpt, score, matchCount })
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function countOccurrences(text: string, term: string): number {
  let count = 0
  let idx = 0
  while ((idx = text.indexOf(term, idx)) !== -1) {
    count++
    idx += term.length
  }
  return count
}

/**
 * Find the 150-char window with the highest density of query term matches,
 * then highlight matched terms with *term*.
 */
export function buildExcerpt(content: string, terms: string[]): string {
  const lower = content.toLowerCase()
  const windowSize = 150

  // Find best window start by sliding in 30-char steps
  let bestStart = 0
  let bestDensity = 0

  for (let i = 0; i < lower.length - windowSize; i += 30) {
    const window = lower.slice(i, i + windowSize)
    let density = 0
    for (const term of terms) {
      density += countOccurrences(window, term)
    }
    if (density > bestDensity) {
      bestDensity = density
      bestStart = i
    }
  }

  let excerpt = content.slice(bestStart, bestStart + windowSize).replace(/\n/g, ' ').trim()

  // Highlight matched terms
  for (const term of terms) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    excerpt = excerpt.replace(re, (match) => `*${match}*`)
  }

  return excerpt
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
