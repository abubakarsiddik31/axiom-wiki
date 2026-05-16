#!/usr/bin/env node
import { Command } from 'commander'
import { hasConfig } from '../src/config/index.js'
import { renderApp } from '../src/cli/index.js'
import { startMcpServer } from '../src/mcp/server.js'
import { VERSION } from '../src/version.js'
import { createAxiomAgent } from '../src/agent/index.js'
import { getConfig } from '../src/config/index.js'
import { runAuthCommand } from '../src/auth/command.js'

function requireConfig() {
  if (!hasConfig()) {
    console.error('Axiom Wiki is not configured. Run: axiom-wiki init')
    process.exit(1)
  }
}

const program = new Command()
  .name('axiom-wiki')
  .description('The wiki that maintains itself.')
  .version(VERSION)

program
  .command('auth [subcommand]')
  .description('Authenticate providers (OpenAI first: auth openai, auth status, auth logout openai)')
  .option('--api-key <key>', 'Set API key non-interactively')
  .option('--activate', 'Switch active provider/model to OpenAI after auth')
  .option('--oauth', 'Use OAuth flow instead of API key')
  .option('--no-open', 'Do not auto-open browser in OAuth mode')
  .option('--client-id <id>', 'OAuth client ID override (or AXIOM_OPENAI_OAUTH_CLIENT_ID)')
  .option('--auth-url <url>', 'OAuth authorization URL override (or AXIOM_OPENAI_OAUTH_AUTH_URL)')
  .option('--token-url <url>', 'OAuth token URL override (or AXIOM_OPENAI_OAUTH_TOKEN_URL)')
  .option('--scope <scope>', 'OAuth scope override (or AXIOM_OPENAI_OAUTH_SCOPE)')
  .option('--redirect-port <port>', 'OAuth localhost callback port override (or AXIOM_OPENAI_OAUTH_PORT)')
  .action(async (subcommand?: string, opts?: {
    apiKey?: string
    activate?: boolean
    oauth?: boolean
    open?: boolean
    clientId?: string
    authUrl?: string
    tokenUrl?: string
    scope?: string
    redirectPort?: string
  }) => {
    await runAuthCommand(subcommand, {
      ...opts,
      noOpen: opts?.open === false,
    })
  })

program
  .command('init')
  .description('First-time setup wizard')
  .action(() => renderApp({ name: 'init' }))

program
  .command('ingest [file-or-url]')
  .description('Ingest a file or URL, or scan raw/ for new files')
  .option('--interactive', 'Enable interactive ingest mode')
  .action((file: string | undefined, opts: { interactive?: boolean }) => {
    requireConfig()
    renderApp({ name: 'ingest', file, interactive: opts.interactive })
  })

program
  .command('query')
  .description('Interactive chat against your wiki')
  .action(() => {
    requireConfig()
    renderApp({ name: 'query' })
  })

program
  .command('model')
  .description('Switch LLM provider or model')
  .action(() => renderApp({ name: 'model' }))

program
  .command('status')
  .description('Show wiki statistics')
  .action(() => {
    requireConfig()
    renderApp({ name: 'status' })
  })

program
  .command('graph')
  .description('Visualize the wiki page graph')
  .action(() => {
    requireConfig()
    renderApp({ name: 'graph' })
  })

program
  .command('lint')
  .description('Check wiki health')
  .action(async () => {
    requireConfig()
    const config = getConfig()!
    const agent = createAxiomAgent(config)
    console.log('Running wiki lint...\n')
    try {
      const result = await agent.generate([{
        role: 'user',
        content: 'Run a full lint check on the wiki. Report all issues found.',
      }])
      console.log(result.text)
    } catch (err: unknown) {
      console.error('Lint failed:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command('watch')
  .description('Watch raw/ for new files and auto-ingest them')
  .action(() => {
    requireConfig()
    renderApp({ name: 'watch' })
  })

program
  .command('clip [url]')
  .description('Clip a URL and save it to raw/ for ingest')
  .action((url?: string) => {
    requireConfig()
    renderApp({ name: 'clip', url })
  })

program
  .command('sources')
  .description('List and manage ingested sources')
  .action(() => {
    requireConfig()
    renderApp({ name: 'sources' })
  })

program
  .command('review')
  .description('Review and resolve wiki contradictions')
  .action(() => {
    requireConfig()
    renderApp({ name: 'review' })
  })

program
  .command('autowiki')
  .alias('map')
  .description('Auto-generate wiki from a project folder')
  .action(() => {
    requireConfig()
    renderApp({ name: 'map' })
  })

program
  .command('sync')
  .description('Update wiki pages for recent codebase changes')
  .action(() => {
    requireConfig()
    renderApp({ name: 'sync' })
  })

program
  .command('start')
  .description('Start MCP server and open home menu')
  .action(() => {
    requireConfig()
    // MCP server uses stdio transport — render home screen alongside it
    renderApp({ name: 'home' })
  })

program
  .command('mcp')
  .description('Start MCP server only (for Claude Code / Cursor)')
  .action(async () => {
    requireConfig()
    await startMcpServer()
    // No Ink — process stays alive serving MCP requests via stdio
  })

program
  .command('setup-agent')
  .description('Add axiom-wiki instructions to agent config files (CLAUDE.md, AGENTS.md, etc.)')
  .action(() => {
    renderApp({ name: 'setup-agent' })
  })

program
  .command('embed')
  .description('Manage semantic search embeddings')
  .option('--setup', 'Setup embedding provider')
  .option('--reindex', 'Re-index all wiki pages')
  .option('--status', 'Show embedding status')
  .action((opts: { setup?: boolean; reindex?: boolean; status?: boolean }) => {
    requireConfig()
    renderApp({ name: 'embed', ...opts })
  })

// No command given → home menu
program.action(() => {
  if (hasConfig()) {
    renderApp({ name: 'home' })
  } else {
    console.log('Welcome to Axiom Wiki.')
    console.log('Run axiom-wiki init to get started.')
  }
})

program.parse()
