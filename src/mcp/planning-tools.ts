import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { AxiomConfig } from '../config/index.js'
import * as wiki from '../core/wiki.js'
import * as searchMod from '../core/search.js'
import { loadMapState, pageCoversFile, getStalePages } from '../core/sync.js'

export function createPlanningTools(config: AxiomConfig) {
  const { wikiDir } = config

  const get_architecture_brief = createTool({
    id: 'get_architecture_brief',
    description:
      'Get a single-call project architecture overview from the wiki. Returns the overview page, page listing, and staleness summary. No LLM calls.',
    inputSchema: z.object({}),
    execute: async () => {
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
          overview = await wiki.readPage(wikiDir, overviewPage.path)
        } catch { /* missing page */ }
      }

      const staleCount = mapState ? getStalePages(mapState, 0.5).length : 0

      return {
        overview: overview || 'No overview page found. Run autowiki to generate one.',
        pages: pages.map((p) => ({
          path: p.path,
          title: p.title,
          summary: p.summary,
          category: p.category,
          confidence: mapState?.pages.find((mp) => p.path.includes(mp.slug))?._confidence ?? 1.0,
        })),
        totalPages: pages.length,
        staleCount,
        lastSyncAt: mapState?.lastSyncAt ?? null,
        coveredCommit: mapState?.gitCommitHash ?? null,
      }
    },
  })

  const plan_with_wiki = createTool({
    id: 'plan_with_wiki',
    description:
      'Given a task description, search the wiki for all relevant context. Returns relevant wiki pages with content and confidence scores.',
    inputSchema: z.object({
      task: z.string().describe('What you want to do, e.g. "add authentication to the API"'),
      max_pages: z.number().optional().describe('Max pages to return (default: 5)'),
    }),
    execute: async (input) => {
      const maxPages = input.max_pages ?? 5
      const mapState = loadMapState(wikiDir)

      const results = await searchMod.searchWiki(wikiDir, input.task, { limit: maxPages })
      const pages = []

      for (const r of results) {
        let content = ''
        try {
          content = await wiki.readPage(wikiDir, r.path)
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
    }),
    execute: async (input) => {
      const mapState = loadMapState(wikiDir)
      if (!mapState) return { error: 'No map-state.json found. Run autowiki first.' }

      // Find pages directly covering the input files
      const directlyAffected: Array<{ slug: string; title: string; content: string; confidence: number }> = []
      const seenSlugs = new Set<string>()

      for (const page of mapState.pages) {
        const covers = input.files.some((f) => pageCoversFile(page, f))
        if (covers && !seenSlugs.has(page.slug)) {
          seenSlugs.add(page.slug)
          const pagePath = `wiki/pages/${page.category}/${page.slug}.md`
          let content = ''
          try {
            content = await wiki.readPage(wikiDir, pagePath)
          } catch { /* missing */ }

          directlyAffected.push({
            slug: page.slug,
            title: page.title,
            content,
            confidence: page._confidence ?? 1.0,
          })
        }
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

  return {
    get_architecture_brief,
    plan_with_wiki,
    get_context_for_change,
    check_before_commit,
  }
}
