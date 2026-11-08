import type { AxiomConfig } from '../config/index.js'
import { buildLinkIndex, type PageLinkEntry } from './links.js'
import { searchWiki } from './search.js'
import {
  rerankCandidates,
  resolveRerankConfig,
  type RerankCandidate,
  type RerankProvider,
  type ResolvedRerank,
} from './rerank.js'

/**
 * Deliberate retrieval for query answering.
 *
 * The agent used to discover context by calling `search_wiki` in a loop, which
 * made every answer pay for several round-trips and left the retrieved set
 * dependent on the model's tool choices. This assembles one bounded context
 * instead: hybrid search finds seeds, the link graph expands them one hop in
 * both directions, and the whole thing is rendered as a citable evidence block.
 */

export type ContextOrigin = 'search' | 'link' | 'backlink'

export interface ContextSource {
  id: string
  title: string
  category: string
  summary: string
  /** The portion of the page that was actually sent to the model. */
  excerpt: string
  sources: string[]
  score: number
  origin: ContextOrigin
}

export interface AssembledContext {
  query: string
  sources: ContextSource[]
  /** Ready-to-append evidence block, or empty when nothing was found. */
  text: string
  estimatedTokens: number
  truncated: boolean
  /** Which reranker (if any) shaped the seed order. */
  rerank?: {
    provider: RerankProvider
    model: string
    used: boolean
    reason?: string
  }
}

export interface AssembleOptions {
  /** Search seeds. */
  limit?: number
  /** How many seeds get a one-hop expansion. */
  expand?: number
  /** Characters per excerpt. */
  excerptChars?: number
  /** Total character budget for the evidence block. */
  maxChars?: number
  /** Reuse a corpus index instead of rebuilding it. */
  index?: Map<string, PageLinkEntry>
  /** Bypass hybrid search (used by tests and by callers that already ranked). */
  seeds?: string[]
  /** Override or disable reranking. `false` keeps the hybrid order. */
  rerank?: false | (Partial<ResolvedRerank> & { allowDownload?: boolean })
  /** Progress messages (model download, reranker fallback). */
  onStatus?: (message: string) => void
}

const DEFAULT_LIMIT = 6
const DEFAULT_EXPAND = 3
const DEFAULT_EXCERPT = 700
const DEFAULT_MAX_CHARS = 24_000
const CHARS_PER_TOKEN = 4

function idFromPath(pagePath: string): string {
  return pagePath.replace(/^wiki\/pages\//, '').replace(/\.md$/, '')
}

function excerptFor(page: PageLinkEntry, sectionTitle?: string): string {
  const body = page.body.trim()
  if (!body) return page.summary

  if (sectionTitle) {
    const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const heading = new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'im')
    const match = heading.exec(body)
    if (match) {
      const start = match.index
      const rest = body.slice(start + match[0].length)
      const nextHeading = /^#{1,6}\s+/m.exec(rest)
      const section = nextHeading ? rest.slice(0, nextHeading.index) : rest
      return collapse(section)
    }
  }

  return collapse(body)
}

function collapse(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/** Reverse link map: page id → ids that link to it. */
function buildInbound(pages: Map<string, PageLinkEntry>): Map<string, string[]> {
  const inbound = new Map<string, string[]>()
  for (const page of pages.values()) {
    for (const target of page.links) {
      const list = inbound.get(target) ?? []
      list.push(page.id)
      inbound.set(target, list)
    }
  }
  return inbound
}

function toSource(
  page: PageLinkEntry,
  origin: ContextOrigin,
  score: number,
  excerptChars: number,
  sectionTitle?: string,
): ContextSource {
  return {
    id: page.id,
    title: page.title,
    category: page.category,
    summary: page.summary,
    excerpt: clamp(excerptFor(page, sectionTitle), excerptChars),
    sources: page.sources,
    score: Number(score.toFixed(3)),
    origin,
  }
}

/**
 * Builds the evidence block for a question. Never throws: a retrieval failure
 * degrades to an empty block so the caller can still answer with tools.
 */
export async function assembleContext(
  config: AxiomConfig,
  question: string,
  options: AssembleOptions = {},
): Promise<AssembledContext> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const expand = options.expand ?? DEFAULT_EXPAND
  const excerptChars = options.excerptChars ?? DEFAULT_EXCERPT
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS

  const pages = options.index ?? buildLinkIndex(config.wikiDir)
  const inbound = buildInbound(pages)

  const seeds: Array<{ id: string; score: number; sectionTitle?: string }> = []
  let rerankInfo: AssembledContext['rerank']

  if (options.seeds) {
    options.seeds.forEach((id, position) => {
      if (pages.has(id)) seeds.push({ id, score: 1 - position * 0.05 })
    })
  } else {
    const overrides =
      options.rerank && typeof options.rerank === 'object' ? options.rerank : {}
    const settings = { ...resolveRerankConfig(config), ...overrides }
    const rerankEnabled = options.rerank !== false && settings.provider !== 'none'
    const searchLimit = rerankEnabled ? Math.max(settings.candidates, limit) : limit

    if (options.rerank !== false && settings.provider === 'none') {
      rerankInfo = { provider: 'none', model: '', used: false }
    }

    try {
      const results = await searchWiki(config.wikiDir, question, { limit: searchLimit, config })

      if (rerankEnabled && results.length > 1) {
        const candidates: RerankCandidate[] = results.map((result) => ({
          id: idFromPath(result.path),
          title: result.title,
          summary: result.summary,
          text: result.excerpt,
          sectionTitle: result.sectionTitle,
          score: result.score,
        }))
        const outcome = await rerankCandidates(config, question, candidates, {
          ...settings,
          allowDownload: Boolean(overrides.allowDownload),
          onStatus: options.onStatus,
        })
        rerankInfo = {
          provider: outcome.provider,
          model: outcome.model,
          used: outcome.used,
          reason: outcome.reason,
        }
        if (!outcome.used && outcome.reason) {
          options.onStatus?.(`Reranker unavailable: ${outcome.reason}`)
        }

        const ranked = outcome.used ? outcome.candidates : candidates
        for (const candidate of ranked.slice(0, limit)) {
          if (!pages.has(candidate.id)) continue
          seeds.push({
            id: candidate.id,
            score: candidate.score ?? 1 - seeds.length * 0.05,
            sectionTitle: candidate.sectionTitle,
          })
        }
      } else {
        for (const result of results) {
          const id = idFromPath(result.path)
          if (!pages.has(id)) continue
          seeds.push({ id, score: result.score, sectionTitle: result.sectionTitle })
        }
      }
    } catch {
      // Retrieval failure is not fatal; the caller still has the agent tools.
    }
  }

  const chosen = new Map<string, ContextSource>()
  const budget = { used: 0, truncated: false }

  const add = (source: ContextSource): boolean => {
    if (chosen.has(source.id)) return false
    const cost = source.excerpt.length + 200
    if (budget.used + cost > maxChars && chosen.size > 0) {
      budget.truncated = true
      return false
    }
    budget.used += cost
    chosen.set(source.id, source)
    return true
  }

  for (const seed of seeds) {
    const page = pages.get(seed.id)
    if (page) add(toSource(page, 'search', seed.score, excerptChars, seed.sectionTitle))
  }

  // One hop out and one hop in, so the model sees the neighbourhood that makes
  // the seed pages meaningful rather than isolated snippets.
  for (const seed of seeds.slice(0, expand)) {
    const page = pages.get(seed.id)
    if (!page) continue

    for (const link of page.links) {
      const target = pages.get(link)
      if (target) add(toSource(target, 'link', 0.4, Math.round(excerptChars * 0.5)))
    }

    for (const referrerId of inbound.get(seed.id) ?? []) {
      const referrer = pages.get(referrerId)
      if (referrer) add(toSource(referrer, 'backlink', 0.35, Math.round(excerptChars * 0.5)))
    }
  }

  const sources = [...chosen.values()]
  const text = renderContext(question, sources)

  return {
    query: question,
    sources,
    text,
    estimatedTokens: Math.ceil(text.length / CHARS_PER_TOKEN),
    truncated: budget.truncated,
    ...(rerankInfo ? { rerank: rerankInfo } : {}),
  }
}

function renderContext(question: string, sources: ContextSource[]): string {
  if (sources.length === 0) return ''

  const blocks = sources.map((source, index) => {
    const header = `### ${index + 1}. ${source.title} (\`${source.id}\`)`
    const lines = [header]
    if (source.summary) lines.push(`Summary: ${source.summary}`)
    if (source.sources.length > 0) lines.push(`Cited sources: ${source.sources.join(', ')}`)
    lines.push('', source.excerpt)
    return lines.join('\n')
  })

  return [
    '## Retrieved wiki evidence',
    '',
    `The following pages were retrieved from this wiki for the question: "${question}".`,
    'Treat them as the primary evidence, prefer them over further tool calls, and cite every',
    'claim with a `[[page-id]]` link. If the evidence is insufficient, say what is missing.',
    '',
    ...blocks,
  ].join('\n')
}
