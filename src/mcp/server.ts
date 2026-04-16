import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import { getConfig } from '../config/index.js'
import { createAxiomTools } from '../agent/tools.js'
import { createPlanningTools } from './planning-tools.js'
import { deriveProjectRoot } from '../core/sync.js'

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
    { capabilities: { logging: {} } },
  )

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

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
