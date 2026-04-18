import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { AxiomConfig } from '../config/index.js'
import * as wiki from '../core/wiki.js'
import * as searchMod from '../core/search.js'
import { loadMapState, saveMapState, pageCoversFile, getStalePages, getGitHeadHash, getGitChangedFiles, updateStaleness, deriveProjectRoot } from '../core/sync.js'
import { applyTier1Updates, type FileChange } from '../core/wiki-sync-lite.js'
import { applyTier2Updates } from '../core/incremental-sync.js'
import { acquireLock, releaseLock } from '../core/lock.js'
import { estimateTokens } from '../config/models.js'
import matter from 'gray-matter'

// ── Format helpers ──────────────────────────────────────────────────────────

type OutputFormat = 'full' | 'compact' | 'summary'

interface PageFrontmatter {
  title?: string
  summary?: string
  tags?: string[]
  category?: string
  sources?: string[]
}

function formatPageContent(raw: string, format: OutputFormat): string {
  if (format === 'full') return raw

  try {
    const { data, content } = matter(raw) as { data: PageFrontmatter; content: string }

    if (format === 'summary') {
      const parts = [`# ${data.title ?? 'Untitled'}`]
      if (data.summary) parts.push(data.summary)
      if (data.tags?.length) parts.push(`Tags: ${data.tags.join(', ')}`)
      if (data.category) parts.push(`Category: ${data.category}`)
      return parts.join('\n')
    }

    // compact: frontmatter + first paragraph + cross-references
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim())
    const firstPara = paragraphs[0] ?? ''

    // Extract wiki-links and markdown links
    const links = new Set<string>()
    const wikiLinkRe = /\[\[([^\]]+)\]\]/g
    const mdLinkRe = /\[([^\]]+)\]\(([^)]+)\)/g
    let m: RegExpExecArray | null
    while ((m = wikiLinkRe.exec(content)) !== null) links.add(m[1])
    while ((m = mdLinkRe.exec(content)) !== null) links.add(m[2])

    const parts = [`# ${data.title ?? 'Untitled'}`]
    if (data.summary) parts.push(data.summary)
    if (data.tags?.length) parts.push(`Tags: ${data.tags.join(', ')}`)
    parts.push('', firstPara)
    if (links.size > 0) parts.push('', `Cross-references: ${[...links].join(', ')}`)
    return parts.join('\n')
  } catch {
    // If parsing fails, return raw for full, truncated for others
    return format === 'summary' ? raw.slice(0, 200) : raw.slice(0, 1000)
  }
}

function truncateToTokenBudget(items: Array<{ content: string; [k: string]: unknown }>, maxTokens: number): typeof items {
  let remaining = maxTokens
  const result: typeof items = []
  for (const item of items) {
    const tokens = estimateTokens(item.content)
    if (tokens <= remaining) {
      result.push(item)
      remaining -= tokens
    } else if (remaining > 100) {
      // Truncate last item to fit
      const chars = Math.floor(remaining * 3.5)
      result.push({ ...item, content: item.content.slice(0, chars) + '\n\n[truncated]' })
      break
    } else {
      break
    }
  }
  return result
}

// ── Shared schemas ──────────────────────────────────────────────────────────

const formatSchema = z.enum(['full', 'compact', 'summary']).optional().describe('Output format: full (default), compact (~80% smaller), summary (~95% smaller)')
const maxTokensSchema = z.number().optional().describe('Approximate token budget for the response. Content is truncated to fit.')

// ── Tool definitions ────────────────────────────────────────────────────────

export function createPlanningTools(config: AxiomConfig) {
  const { wikiDir } = config

  const get_architecture_brief = createTool({
    id: 'get_architecture_brief',
    description:
      'Get a single-call project architecture overview from the wiki. Returns the overview page, page listing, and staleness summary. No LLM calls.',
    inputSchema: z.object({
      format: formatSchema,
      maxTokens: maxTokensSchema,
    }),
    execute: async (input) => {
      const format: OutputFormat = (input as { format?: OutputFormat }).format ?? 'full'
      const maxTokens = (input as { maxTokens?: number }).maxTokens
      const mapState = loadMapState(wikiDir)
      const pages = await wiki.listPages(wikiDir)

      // Find overview/architecture page
      let overview = ''
      const overviewPage = pages.find(
        (p) =>
          p.category === 'analyses' &&
          (p.title.toLowerCase().includes('overview') ||
           p.title.toLowerCase().includes('architecture') ||
           p.tags.some((t) => ['overview', 'architecture'].includes(t.toLowerCase()))),
      )
      if (overviewPage) {
        try {
          const raw = await wiki.readPage(wikiDir, overviewPage.path)
          overview = formatPageContent(raw, format)
        } catch { /* missing page */ }
      }

      const staleCount = mapState ? getStalePages(mapState, 0.5).length : 0

      const pageList = pages.map((p) => ({
        path: p.path,
        title: p.title,
        summary: p.summary,
        category: p.category,
        confidence: mapState?.pages.find((mp) => p.path.includes(mp.slug))?._confidence ?? 1.0,
      }))

      const result = {
        overview: overview || 'No overview page found. Run autowiki to generate one.',
        pages: format === 'summary'
          ? pageList.map((p) => ({ path: p.path, title: p.title, category: p.category, confidence: p.confidence }))
          : pageList,
        totalPages: pages.length,
        staleCount,
        lastSyncAt: mapState?.lastSyncAt ?? null,
        coveredCommit: mapState?.gitCommitHash ?? null,
      }

      if (maxTokens) {
        const json = JSON.stringify(result)
        if (estimateTokens(json) > maxTokens) {
          // Trim overview to fit budget
          const overheadTokens = estimateTokens(JSON.stringify({ ...result, overview: '' }))
          const overviewBudget = Math.max(200, maxTokens - overheadTokens)
          const overviewChars = Math.floor(overviewBudget * 3.5)
          result.overview = result.overview.slice(0, overviewChars) + '\n\n[truncated to fit token budget]'
        }
      }

      return result
    },
  })

  const plan_with_wiki = createTool({
    id: 'plan_with_wiki',
    description:
      'Given a task description, search the wiki for all relevant context. Returns relevant wiki pages with content and confidence scores.',
    inputSchema: z.object({
      task: z.string().describe('What you want to do, e.g. "add authentication to the API"'),
      max_pages: z.number().optional().describe('Max pages to return (default: 5)'),
      format: formatSchema,
      maxTokens: maxTokensSchema,
    }),
    execute: async (input) => {
      const maxPages = input.max_pages ?? 5
      const format: OutputFormat = (input as { format?: OutputFormat }).format ?? 'full'
      const maxTokens = (input as { maxTokens?: number }).maxTokens
      const mapState = loadMapState(wikiDir)

      const results = await searchMod.searchWiki(wikiDir, input.task, { limit: maxPages })
      let pages: Array<{ path: string; title: string; content: string; confidence: number; excerpt: string; score: number }> = []

      for (const r of results) {
        let content = ''
        try {
          const raw = await wiki.readPage(wikiDir, r.path)
          content = formatPageContent(raw, format)
        } catch { /* missing page */ }

        const confidence = mapState?.pages.find((mp) => r.path.includes(mp.slug))?._confidence ?? 1.0

        pages.push({
          path: r.path,
          title: r.title,
          content,
          confidence,
          excerpt: r.excerpt,
          score: r.score,
        })
      }

      if (maxTokens) {
        pages = truncateToTokenBudget(pages, maxTokens) as typeof pages
      }

      return {
        pages,
        warning: mapState ? undefined : 'No map-state.json found. Wiki may not be synced with codebase.',
      }
    },
  })

  const get_context_for_change = createTool({
    id: 'get_context_for_change',
    description:
      'Get wiki context relevant to changing specific files. Returns wiki pages that cover those files plus related pages.',
    inputSchema: z.object({
      files: z.array(z.string()).describe('File paths being changed, relative to project root'),
      format: formatSchema,
      maxTokens: maxTokensSchema,
    }),
    execute: async (input) => {
      const format: OutputFormat = (input as { format?: OutputFormat }).format ?? 'full'
      const maxTokens = (input as { maxTokens?: number }).maxTokens
      const mapState = loadMapState(wikiDir)
      if (!mapState) return { error: 'No map-state.json found. Run autowiki first.' }

      // Find pages directly covering the input files
      let directlyAffected: Array<{ slug: string; title: string; content: string; confidence: number }> = []
      const seenSlugs = new Set<string>()

      for (const page of mapState.pages) {
        const covers = input.files.some((f) => pageCoversFile(page, f))
        if (covers && !seenSlugs.has(page.slug)) {
          seenSlugs.add(page.slug)
          const pagePath = `wiki/pages/${page.category}/${page.slug}.md`
          let content = ''
          try {
            const raw = await wiki.readPage(wikiDir, pagePath)
            content = formatPageContent(raw, format)
          } catch { /* missing */ }

          directlyAffected.push({
            slug: page.slug,
            title: page.title,
            content,
            confidence: page._confidence ?? 1.0,
          })
        }
      }

      if (maxTokens) {
        directlyAffected = truncateToTokenBudget(directlyAffected, maxTokens) as typeof directlyAffected
      }

      // Find related pages by extracting wiki-links from affected pages
      const related: Array<{ slug: string; title: string; summary: string }> = []
      const allPages = await wiki.listPages(wikiDir)

      for (const affected of directlyAffected) {
        const linkPattern = /\[\[([^\]]+)\]\]/g
        let match: RegExpExecArray | null
        while ((match = linkPattern.exec(affected.content)) !== null) {
          const linkTarget = match[1]
          const linkedPage = allPages.find(
            (p) => p.path.includes(linkTarget) || p.title.toLowerCase() === linkTarget.toLowerCase(),
          )
          if (linkedPage && !seenSlugs.has(linkedPage.path)) {
            seenSlugs.add(linkedPage.path)
            related.push({ slug: linkedPage.path, title: linkedPage.title, summary: linkedPage.summary })
          }
        }
      }

      return { directlyAffected, related }
    },
  })

  const check_before_commit = createTool({
    id: 'check_before_commit',
    description:
      'Pre-commit check: given changed files, identify which wiki pages will become stale and their projected confidence.',
    inputSchema: z.object({
      files: z.array(z.string()).describe('Files being committed, relative to project root'),
    }),
    execute: async (input) => {
      const mapState = loadMapState(wikiDir)
      if (!mapState) return { error: 'No map-state.json found. Run autowiki first.' }

      const affectedPages: Array<{
        slug: string
        title: string
        currentConfidence: number
        projectedConfidence: number
      }> = []

      for (const page of mapState.pages) {
        const covers = input.files.some((f) => pageCoversFile(page, f))
        if (!covers) continue

        const current = page._confidence ?? 1.0
        const projected = Math.max(0.1, current * 0.85)
        affectedPages.push({
          slug: page.slug,
          title: page.title,
          currentConfidence: current,
          projectedConfidence: projected,
        })
      }

      const severeCount = affectedPages.filter((p) => p.projectedConfidence < 0.5).length
      const recommendation = severeCount > 3
        ? 'Multiple pages will become significantly stale. Run notify_code_change with run_tier2: true after committing.'
        : severeCount > 0
          ? `${severeCount} page(s) will need updating. Consider running a sync after this commit.`
          : affectedPages.length > 0
            ? 'Minor staleness. Pages will auto-correct on next sync.'
            : 'No wiki pages affected by these changes.'

      return { affectedPages, recommendation }
    },
  })

  // ── notify_code_change (mirrors agent/tools.ts but exposed via MCP) ─────

  const notify_code_change = createTool({
    id: 'notify_code_change',
    description:
      'Notify the wiki that code files have changed. Runs Tier 1 (instant, deterministic) updates immediately. Optionally runs Tier 2 (LLM-based) updates for stale pages.',
    inputSchema: z.object({
      files: z.array(z.object({
        path: z.string().describe('File path relative to project root'),
        type: z.enum(['created', 'modified', 'deleted', 'renamed']),
        oldPath: z.string().optional().describe('Previous path for renamed files'),
      })),
      description: z.string().optional().describe('Brief description of what changed and why'),
      run_tier2: z.boolean().optional().describe('Whether to run LLM-based updates (default: false)'),
    }),
    execute: async (input) => {
      const mapState = loadMapState(wikiDir)
      if (!mapState) return { error: 'No map-state.json found. Run autowiki first to build the initial wiki.' }

      const root = deriveProjectRoot(wikiDir)
      if (!root) return { error: 'Cannot determine project root. This tool requires a local wiki.' }

      if (!acquireLock(wikiDir)) return { error: 'Wiki is locked by another operation. Try again later.' }
      try {
        // Tier 1: deterministic updates
        const tier1 = await applyTier1Updates(wikiDir, input.files as FileChange[], mapState)

        // Update staleness scores
        const tier1Handled = new Set([...tier1.updatedPages, ...tier1.flaggedStale])
        const changedPaths = input.files.map((f) => f.path)
        const currentCommit = getGitHeadHash(root) ?? ''
        for (const page of mapState.pages) {
          if (tier1Handled.has(page.slug)) continue
          const touched = changedPaths.some((f) => {
            if (page.paths.length === 0) return false
            return page.paths.some((p) => p.endsWith('/') ? f.startsWith(p) : f === p)
          })
          if (touched) {
            page._confidence = Math.max(0.1, (page._confidence ?? 1.0) * 0.85)
          }
        }
        mapState.gitCommitHash = currentCommit || mapState.gitCommitHash

        if (tier1.updatedPages.length > 0) {
          await wiki.updateIndex(wikiDir)
          await wiki.updateMOC(wikiDir)
          await wiki.appendLog(wikiDir, `notify: tier1 updated ${tier1.updatedPages.join(', ')}`, 'sync')
        }

        saveMapState(wikiDir, mapState)

        let tier2 = null
        if (input.run_tier2) {
          const stalePages = getStalePages(mapState, 0.5)
          if (stalePages.length > 0) {
            tier2 = await applyTier2Updates(config, wikiDir, stalePages, changedPaths, root, mapState)
            saveMapState(wikiDir, mapState)
          }
        }

        return {
          tier1,
          tier2,
          stalePages: getStalePages(mapState, 0.8).map((p) => ({ slug: p.slug, confidence: p._confidence })),
        }
      } finally {
        releaseLock(wikiDir)
      }
    },
  })

  // ── report_task_complete ────────────────────────────────────────────────

  const report_task_complete = createTool({
    id: 'report_task_complete',
    description:
      'Report that a coding task is complete. Detects changed files and returns wiki staleness info with recommendations.',
    inputSchema: z.object({
      task_description: z.string().describe('What was done'),
      files_changed: z.array(z.string()).optional().describe('Files that were modified (auto-detected from git if omitted)'),
    }),
    execute: async (input) => {
      const mapState = loadMapState(wikiDir)
      if (!mapState) return { status: 'no_wiki', message: 'No map-state.json found. Run autowiki first.' }

      const root = deriveProjectRoot(wikiDir)
      let changedFiles = input.files_changed ?? []

      if (changedFiles.length === 0 && root) {
        const currentHash = getGitHeadHash(root)
        if (currentHash && mapState.gitCommitHash) {
          changedFiles = getGitChangedFiles(root, mapState.gitCommitHash)
        }
      }

      if (changedFiles.length > 0) {
        if (!acquireLock(wikiDir)) return { status: 'locked', message: 'Wiki is locked by another operation.' }
        try {
          const currentCommit = root ? getGitHeadHash(root) ?? '' : ''
          updateStaleness(mapState, changedFiles, currentCommit)
          saveMapState(wikiDir, mapState)
        } finally {
          releaseLock(wikiDir)
        }
      }

      const stale = getStalePages(mapState, 0.7)
      const recommendation = stale.length > 5
        ? 'Many stale pages. Run notify_code_change with run_tier2: true, or run axiom-wiki sync.'
        : stale.length > 0
          ? `${stale.length} page(s) slightly stale. Will auto-correct on next sync.`
          : 'Wiki is up to date.'

      return {
        status: 'ok',
        stalePages: stale.map((p) => ({ slug: p.slug, confidence: p._confidence })),
        recommendation,
      }
    },
  })

  // ── get_wiki_health ─────────────────────────────────────────────────────

  const get_wiki_health = createTool({
    id: 'get_wiki_health',
    description:
      'Get wiki health status: staleness scores, pending updates, last sync time, overall health rating.',
    inputSchema: z.object({}),
    execute: async () => {
      const mapState = loadMapState(wikiDir)
      const pages = await wiki.listPages(wikiDir)

      if (!mapState) {
        return {
          status: 'no_wiki',
          message: 'No map-state.json found. Run autowiki to build the wiki first.',
          totalPages: pages.length,
        }
      }

      const root = deriveProjectRoot(wikiDir)
      const currentCommit = root ? getGitHeadHash(root) : null
      const commitsBehind = currentCommit && mapState.gitCommitHash && currentCommit !== mapState.gitCommitHash

      const stalePages = getStalePages(mapState, 0.5)
      const warningPages = getStalePages(mapState, 0.8)
      const healthyPages = mapState.pages.filter((p) => (p._confidence ?? 1.0) >= 0.8)

      const avgConfidence = mapState.pages.length > 0
        ? mapState.pages.reduce((sum, p) => sum + (p._confidence ?? 1.0), 0) / mapState.pages.length
        : 1.0

      const healthRating = avgConfidence >= 0.9 ? 'excellent'
        : avgConfidence >= 0.7 ? 'good'
        : avgConfidence >= 0.5 ? 'fair'
        : 'poor'

      return {
        status: healthRating,
        totalPages: pages.length,
        trackedPages: mapState.pages.length,
        healthyPages: healthyPages.length,
        warningPages: warningPages.length - stalePages.length,
        stalePages: stalePages.length,
        avgConfidence: Math.round(avgConfidence * 100) / 100,
        lastSyncAt: mapState.lastSyncAt,
        coveredCommit: mapState.gitCommitHash,
        currentCommit: currentCommit ?? null,
        commitsBehind: commitsBehind ?? false,
        pendingChanges: mapState.pendingChanges?.length ?? 0,
        stalestPages: stalePages.slice(0, 5).map((p) => ({
          slug: p.slug,
          title: p.title,
          confidence: p._confidence,
        })),
        recommendation: stalePages.length > 5
          ? 'Wiki is significantly stale. Run axiom-wiki sync to update.'
          : stalePages.length > 0
            ? `${stalePages.length} page(s) need updating. Run notify_code_change with run_tier2: true.`
            : commitsBehind
              ? 'Wiki is behind HEAD. Run notify_code_change to update staleness scores.'
              : 'Wiki is healthy and up to date.',
      }
    },
  })

  return {
    get_architecture_brief,
    plan_with_wiki,
    get_context_for_change,
    check_before_commit,
    notify_code_change,
    report_task_complete,
    get_wiki_health,
  }
}
