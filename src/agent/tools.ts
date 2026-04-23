import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { AxiomConfig } from '../config/index.js'
import * as wiki from '../core/wiki.js'
import * as search from '../core/search.js'
import * as files from '../core/files.js'
import * as sources from '../core/sources.js'
import * as graph from '../core/graph.js'
import {
  loadMapState, saveMapState, getGitHeadHash, getGitChangedFiles,
  updateStaleness, getStalePages, deriveProjectRoot,
} from '../core/sync.js'
import { applyTier1Updates, type FileChange } from '../core/wiki-sync-lite.js'
import { applyTier2Updates } from '../core/incremental-sync.js'
import { indexWikiPage, persistOrama } from '../core/indexing.js'
import { acquireLock, releaseLock } from '../core/lock.js'

export function createAxiomTools(config: AxiomConfig, projectRoot?: string) {
  const { wikiDir, rawDir } = config

  const read_page = createTool({
    id: 'read_page',
    description: 'Read a wiki page by its path relative to the wiki directory',
    inputSchema: z.object({
      path: z.string().describe('Path relative to wikiDir, e.g. "wiki/pages/entities/alan-turing.md"'),
    }),
    execute: async (input) => wiki.readPage(wikiDir, input.path),
  })

  const write_page = createTool({
    id: 'write_page',
    description: 'Write or update a wiki page. Uses atomic write to prevent corruption.',
    inputSchema: z.object({
      path: z.string().describe('Path relative to wikiDir'),
      content: z.string().describe('Full markdown content including frontmatter'),
    }),
    execute: async (input) => {
      await wiki.writePage(wikiDir, input.path, input.content)
      
      // Update semantic index if enabled
      if (config.embeddings && config.embeddings.provider !== 'none') {
        try {
          await indexWikiPage(config, input.path)
          await persistOrama(config)
        } catch (err) {
          // Non-fatal for the agent
        }
      }
      
      return 'written'
    },
  })

  const list_pages = createTool({
    id: 'list_pages',
    description: 'List wiki pages with metadata. Optionally filter by category or text.',
    inputSchema: z.object({
      category: z.enum(['entities', 'concepts', 'sources', 'analyses']).optional(),
      filter: z.string().optional().describe('Text to match in title or summary'),
    }),
    execute: async (input) => wiki.listPages(wikiDir, input.filter, input.category),
  })

  const search_wiki = createTool({
    id: 'search_wiki',
    description: 'Full-text search across all wiki pages. Returns ranked results with excerpts.',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
      category: z.enum(['entities', 'concepts', 'sources', 'analyses']).optional(),
    }),
    execute: async (input) =>
      search.searchWiki(wikiDir, input.query, {
        limit: input.limit,
        category: input.category,
        config,
      }),
  })

  const update_index = createTool({
    id: 'update_index',
    description: 'Rebuild wiki/index.md from all current pages. Call after writing new pages.',
    inputSchema: z.object({}),
    execute: async () => {
      await wiki.updateIndex(wikiDir)
      return 'index updated'
    },
  })

  const append_log = createTool({
    id: 'append_log',
    description: 'Append an entry to wiki/log.md. Use after completing each operation.',
    inputSchema: z.object({
      entry: z.string().describe('Log entry text, e.g. source title or question asked'),
      type: z.enum(['ingest', 'query', 'lint', 'status', 'map', 'sync']),
    }),
    execute: async (input) => {
      await wiki.appendLog(wikiDir, input.entry, input.type)
      return 'logged'
    },
  })

  const ingest_source = createTool({
    id: 'ingest_source',
    description:
      'Read a raw source file and return its content for processing. Handles PDF, images, text, docx, html.',
    inputSchema: z.object({
      filepath: z.string().describe('Absolute path to the source file in the raw/ directory'),
    }),
    execute: async (input) => files.readSourceFile(input.filepath),
  })

  const get_status = createTool({
    id: 'get_status',
    description: 'Get current wiki statistics: page counts, source count, last operation dates.',
    inputSchema: z.object({}),
    execute: async () => wiki.getStatus(config),
  })

  const lint_wiki = createTool({
    id: 'lint_wiki',
    description:
      'Scan the wiki for health issues: orphan pages, broken links, stale claims, missing pages, data gaps.',
    inputSchema: z.object({}),
    execute: async () => {
      const pages = await wiki.listPages(wikiDir)
      const allContent = await Promise.all(pages.map((p) => wiki.readPage(wikiDir, p.path)))
      return { pages, allContent }
    },
  })

  const list_sources = createTool({
    id: 'list_sources',
    description: 'List all ingested source files with dates and summary page paths.',
    inputSchema: z.object({}),
    execute: async () => sources.listSources(wikiDir),
  })

  const get_source = createTool({
    id: 'get_source',
    description: 'Get the wiki summary page for a specific source file.',
    inputSchema: z.object({
      filename: z.string().describe('Original source filename, e.g. "article.pdf"'),
    }),
    execute: async (input) => sources.getSource(wikiDir, input.filename),
  })

  const remove_source = createTool({
    id: 'remove_source',
    description: 'Remove the wiki summary page for a source. Returns list of pages that may be affected.',
    inputSchema: z.object({
      filename: z.string().describe('Original source filename to remove'),
    }),
    execute: async (input) => sources.removeSource(wikiDir, input.filename),
  })

  const get_contradictions = createTool({
    id: 'get_contradictions',
    description: 'Find all wiki pages containing unresolved contradiction blocks (⚠️ Contradiction:).',
    inputSchema: z.object({}),
    execute: async () => {
      const pages = await wiki.listPages(wikiDir)
      const results = []
      for (const p of pages) {
        const content = await wiki.readPage(wikiDir, p.path)
        if (content.includes('⚠️ Contradiction:')) {
          results.push({ path: p.path, title: p.title, content })
        }
      }
      return results
    },
  })

  const resolve_contradiction = createTool({
    id: 'resolve_contradiction',
    description: 'Update a wiki page to resolve or remove a contradiction block.',
    inputSchema: z.object({
      path: z.string().describe('Page path relative to wikiDir'),
      resolution: z.string().describe('The resolved text to replace the ⚠️ block with, or empty string to remove it'),
    }),
    execute: async (input) => {
      const content = await wiki.readPage(wikiDir, input.path)
      const updated = content.replace(/> ⚠️ Contradiction:.*$/m, input.resolution || '')
      await wiki.writePage(wikiDir, input.path, updated.trim())
      
      // Update semantic index if enabled
      if (config.embeddings && config.embeddings.provider !== 'none') {
        try {
          await indexWikiPage(config, input.path)
          await persistOrama(config)
        } catch { /* skip */ }
      }

      return 'resolved'
    },
  })

  const update_moc = createTool({
    id: 'update_moc',
    description: 'Rebuild wiki/moc.md — a tag-grouped Map of Content. Call after writing new pages.',
    inputSchema: z.object({}),
    execute: async () => {
      await wiki.updateMOC(wikiDir)
      return 'moc updated'
    },
  })

  const analyze_graph = createTool({
    id: 'analyze_graph',
    description:
      'Perform static analysis of the wiki graph to find orphans (pages with no inbound links) and dead links (links to non-existent pages).',
    inputSchema: z.object({}),
    execute: async () => {
      const g = graph.buildGraph(wikiDir)
      return {
        nodeCount: g.nodes.size,
        edgeCount: g.edges.length,
        orphans: g.orphans.map((id) => ({ id, title: g.nodes.get(id)?.title })),
        deadLinks: g.deadLinks,
      }
    },
  })

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

      const root = projectRoot ?? deriveProjectRoot(wikiDir)
      if (!root) return { error: 'Cannot determine project root. This tool requires a local wiki.' }

      if (!acquireLock(wikiDir)) return { error: 'Wiki is locked by another operation. Try again later.' }
      try {
        // Tier 1: deterministic updates
        const tier1 = await applyTier1Updates(wikiDir, input.files as FileChange[], mapState)

        // Update staleness scores (only for files NOT already adjusted by Tier 1)
        const tier1Handled = new Set([...tier1.updatedPages, ...tier1.flaggedStale])
        const changedPaths = input.files.map((f) => f.path)
        const currentCommit = getGitHeadHash(root) ?? ''
        // Only run updateStaleness for pages not already touched by Tier 1
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

        // Rebuild index/moc if Tier 1 wrote pages
        if (tier1.updatedPages.length > 0) {
          await wiki.updateIndex(wikiDir)
          await wiki.updateMOC(wikiDir)
          
          if (config.embeddings && config.embeddings.provider !== 'none') {
            for (const slug of tier1.updatedPages) {
              const page = mapState.pages.find((p) => p.slug === slug)
              if (page) {
                const pagePath = `wiki/pages/${page.category}/${page.slug}.md`
                try { await indexWikiPage(config, pagePath) } catch { /* skip */ }
              }
            }
            await persistOrama(config)
          }

          await wiki.appendLog(wikiDir, `notify: tier1 updated ${tier1.updatedPages.join(', ')}`, 'sync')
        }

        // Save after Tier 1 so mutations are persisted even if Tier 2 fails
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

      const root = projectRoot ?? deriveProjectRoot(wikiDir)
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

  const log_decision = createTool({
    id: 'log_decision',
    description:
      'Log an architectural decision, user clarification, or important rationale to the wiki. Creates a running decision log.',
    inputSchema: z.object({
      decision: z.string().describe('The decision that was made, e.g. "Chose JWT over session cookies"'),
      context: z.string().optional().describe('Why this decision was made'),
      alternatives: z.array(z.string()).optional().describe('What alternatives were considered'),
      affected_areas: z.array(z.string()).optional().describe('Areas affected, e.g. ["auth", "api"]'),
    }),
    execute: async (input) => {
      if (!acquireLock(wikiDir)) return { error: 'Wiki is locked by another operation. Try again later.' }
      try {
        const decisionPagePath = 'wiki/pages/analyses/decisions.md'
        const today = new Date().toISOString().slice(0, 10)
        const entryId = `decision-${Date.now()}`

        // Read or create the decisions page
        let existingContent: string
        try {
          existingContent = await wiki.readPage(wikiDir, decisionPagePath)
        } catch (err: unknown) {
          // Only create fresh page on "not found" — rethrow other errors
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('not found') && !msg.includes('ENOENT')) throw err
          existingContent = `---
title: "Decision Log"
summary: "Architectural decisions, user clarifications, and rationale"
tags: [decisions, architecture]
category: analyses
updatedAt: "${today}"
---

# Decision Log

_Append-only record of key decisions made during development._
`
        }

        // Build the new entry
        const lines: string[] = [
          '',
          `## [${today}] ${input.decision} {#${entryId}}`,
          '',
        ]
        if (input.context) {
          lines.push(`**Context:** ${input.context}`, '')
        }
        if (input.alternatives && input.alternatives.length > 0) {
          lines.push('**Alternatives considered:**')
          for (const alt of input.alternatives) {
            lines.push(`- ${alt}`)
          }
          lines.push('')
        }
        if (input.affected_areas && input.affected_areas.length > 0) {
          lines.push(`**Affected areas:** ${input.affected_areas.join(', ')}`, '')
        }

        // Update the updatedAt in frontmatter
        const updated = existingContent.replace(
          /updatedAt: ".*?"/,
          `updatedAt: "${today}"`,
        ) + lines.join('\n')

        await wiki.writePage(wikiDir, decisionPagePath, updated)
        await wiki.updateIndex(wikiDir)

        // Update semantic index if enabled
        if (config.embeddings && config.embeddings.provider !== 'none') {
          try {
            await indexWikiPage(config, decisionPagePath)
            await persistOrama(config)
          } catch { /* skip */ }
        }

        return { page: decisionPagePath, entry_id: entryId }
      } finally {
        releaseLock(wikiDir)
      }
    },
  })

  return {
    read_page,
    write_page,
    list_pages,
    search_wiki,
    update_index,
    append_log,
    ingest_source,
    get_status,
    lint_wiki,
    list_sources,
    get_source,
    remove_source,
    get_contradictions,
    resolve_contradiction,
    update_moc,
    analyze_graph,
    notify_code_change,
    report_task_complete,
    log_decision,
  }
}


export type AxiomTools = ReturnType<typeof createAxiomTools>
