import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import { getConfig } from '../config/index.js'
import { createAxiomTools } from '../agent/tools.js'
import { createPlanningTools } from './planning-tools.js'
import { deriveProjectRoot, loadMapState, getStalePages } from '../core/sync.js'
import * as wiki from '../core/wiki.js'
import fs from 'fs'
import path from 'path'

// When true, all logging must go to stderr — stdout is reserved for JSON-RPC
export let isMcpMode = false

export async function startMcpServer(): Promise<void> {
  isMcpMode = true

  const config = getConfig()
  if (!config) {
    process.stderr.write('Axiom Wiki is not configured. Run: axiom-wiki init\n')
    process.exit(1)
  }

  const projectRoot = deriveProjectRoot(config.wikiDir)
  const tools = createAxiomTools(config, projectRoot)
  const planningTools = createPlanningTools(config)
  const allTools = { ...tools, ...planningTools }

  const server = new McpServer(
    { name: 'axiom-wiki', version: '1.0.0' },
    { capabilities: { logging: {}, resources: {} } },
  )

  // ── Register tools ──────────────────────────────────────────────────────

  for (const [name, tool] of Object.entries(allTools)) {
    if (!tool.execute) {
      process.stderr.write(`[axiom-wiki] Warning: tool "${name}" has no execute function, skipping\n`)
      continue
    }

    const executeFn = tool.execute
    const inputSchema = tool.inputSchema as unknown as AnySchema

    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema,
      },
      async (args: unknown) => {
        try {
          const result = await executeFn(args as never, {} as never)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
            isError: true,
          }
        }
      },
    )
  }

  // ── Register resources ────────────────────────────────────────────────

  const { wikiDir } = config

  server.registerResource(
    'overview',
    'axiom://overview',
    { description: 'Project architecture overview — pin this for ambient context in every conversation.' },
    async () => {
      const pages = await wiki.listPages(wikiDir)
      const mapState = loadMapState(wikiDir)

      const overviewPage = pages.find(
        (p) =>
          p.category === 'analyses' &&
          (p.title.toLowerCase().includes('overview') ||
           p.title.toLowerCase().includes('architecture') ||
           p.tags.some((t) => ['overview', 'architecture'].includes(t.toLowerCase()))),
      )

      let overview = 'No overview page found. Run axiom-wiki autowiki to generate one.'
      if (overviewPage) {
        try {
          overview = await wiki.readPage(wikiDir, overviewPage.path)
        } catch { /* missing */ }
      }

      const staleCount = mapState ? getStalePages(mapState, 0.5).length : 0
      const footer = `\n\n---\nWiki: ${pages.length} pages | ${staleCount} stale | Last sync: ${mapState?.lastSyncAt ?? 'never'}`

      return {
        contents: [{
          uri: 'axiom://overview',
          text: overview + footer,
          mimeType: 'text/markdown',
        }],
      }
    },
  )

  server.registerResource(
    'index',
    'axiom://index',
    { description: 'Wiki page index with titles, summaries, and categories.' },
    async () => {
      const pages = await wiki.listPages(wikiDir)
      const mapState = loadMapState(wikiDir)

      const lines = pages.map((p) => {
        const confidence = mapState?.pages.find((mp) => p.path.includes(mp.slug))?._confidence ?? 1.0
        const staleMarker = confidence < 0.5 ? ' [STALE]' : confidence < 0.8 ? ' [~]' : ''
        return `- **${p.title}** (${p.category})${staleMarker}: ${p.summary}`
      })

      return {
        contents: [{
          uri: 'axiom://index',
          text: `# Wiki Index\n\n${lines.join('\n')}`,
          mimeType: 'text/markdown',
        }],
      }
    },
  )

  server.registerResource(
    'recent-changes',
    'axiom://recent-changes',
    { description: 'Last 10 wiki operations from the log.' },
    async () => {
      const logPath = path.join(wikiDir, 'wiki', 'log.md')
      let logContent = ''
      try {
        logContent = fs.readFileSync(logPath, 'utf-8')
      } catch { /* no log yet */ }

      // Extract last 10 log entries (lines starting with "- ")
      const entries = logContent.split('\n').filter((l) => l.startsWith('- '))
      const recent = entries.slice(-10).reverse()

      return {
        contents: [{
          uri: 'axiom://recent-changes',
          text: `# Recent Changes\n\n${recent.join('\n')}`,
          mimeType: 'text/markdown',
        }],
      }
    },
  )

  // ── Connect transport ─────────────────────────────────────────────────

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
