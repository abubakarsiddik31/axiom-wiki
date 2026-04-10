#!/usr/bin/env node
import { Command } from 'commander'
import { hasConfig } from '../src/config/index.js'
import { renderApp } from '../src/cli/index.js'
import { startMcpServer } from '../src/mcp/server.js'
import { createAxiomAgent } from '../src/agent/index.js'
import { getConfig } from '../src/config/index.js'

function requireConfig() {
  if (!hasConfig()) {
    console.error('Axiom Wiki is not configured. Run: axiom-wiki init')
    process.exit(1)
  }
}

const program = new Command()
  .name('axiom-wiki')
  .description('The wiki that maintains itself.')
  .version('0.1.0')

program
  .command('init')
  .description('First-time setup wizard')
  .action(() => renderApp({ name: 'init' }))

program
  .command('ingest [file]')
  .description('Ingest a source file, or scan raw/ for new files')
  .action((file?: string) => {
    requireConfig()
    renderApp({ name: 'ingest', file })
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
