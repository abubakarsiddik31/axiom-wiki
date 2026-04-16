import path from 'path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import { getConfig } from '../config/index.js'
import { createAxiomTools } from '../agent/tools.js'
import { createPlanningTools } from './planning-tools.js'

// When true, all logging must go to stderr — stdout is reserved for JSON-RPC
export let isMcpMode = false

function deriveProjectRoot(wikiDir: string): string | undefined {
  if (wikiDir.endsWith('.axiom') || wikiDir.endsWith('.axiom/')) {
    return path.dirname(wikiDir.replace(/\/$/, ''))
  }
  return undefined
}

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
    if (!tool.execute) continue

    const executeFn = tool.execute
    const inputSchema = tool.inputSchema as unknown as AnySchema

    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema,
      },
      async (args: unknown) => {
        const result = await executeFn(args as never, {} as never)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        }
      },
    )
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
