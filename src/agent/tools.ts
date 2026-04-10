import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { AxiomConfig } from '../config/index.js'
import * as wiki from '../core/wiki.js'
import * as search from '../core/search.js'
import * as files from '../core/files.js'
import * as sources from '../core/sources.js'

export function createAxiomTools(config: AxiomConfig) {
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
      type: z.enum(['ingest', 'query', 'lint', 'status']),
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
    execute: async () => wiki.getStatus(wikiDir, rawDir),
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
      return 'resolved'
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
  }
}

export type AxiomTools = ReturnType<typeof createAxiomTools>
