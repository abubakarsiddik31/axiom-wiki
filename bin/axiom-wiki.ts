#!/usr/bin/env node
import { Command } from 'commander'
import path from 'path'
import { hasConfig } from '../src/config/index.js'
import { renderApp } from '../src/cli/index.js'
import { startMcpServer } from '../src/mcp/server.js'
import { VERSION } from '../src/version.js'
import { createAxiomAgent } from '../src/agent/index.js'
import { getConfig } from '../src/config/index.js'
import type { RerankConfig } from '../src/config/index.js'
import { openUrlInBrowser, runAuthCommand } from '../src/auth/command.js'
import { startServer } from '../src/server/index.js'

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
  .option('--issuer <url>', 'OAuth issuer URL for OIDC discovery (optional)')
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
    issuer?: string
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
  .option('--lang <code>', 'Preferred transcript language for YouTube URLs (default: en)')
  .action((file: string | undefined, opts: { interactive?: boolean; lang?: string }) => {
    requireConfig()
    renderApp({ name: 'ingest', file, interactive: opts.interactive, lang: opts.lang })
  })

program
  .command('query [question]')
  .description('Interactive chat against your wiki')
  .option('-f, --forensic', 'Enable strict forensic grounded mode (zero trained knowledge)')
  .option('-g, --grounded', 'Alias for --forensic')
  .action((question?: string, opts?: { forensic?: boolean; grounded?: boolean }) => {
    requireConfig()
    const forensic = Boolean(opts?.forensic || opts?.grounded)
    renderApp({ name: 'query', prefill: question, forensic })
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
  .command('serve')
  .description('Serve the wiki as a local web UI with a read-only JSON API')
  .option('-p, --port <port>', 'port to listen on', '1717')
  .option('--host <host>', 'host to bind (use 0.0.0.0 to expose on the LAN)', '127.0.0.1')
  .option('--open', 'open the browser after starting')
  .option('--allow-write', 'enable ingest, source management, query, and reindex actions (loopback only)')
  .option('--maintain-interval <minutes>', 'run a maintenance pass every N minutes (requires --allow-write)')
  .action(async (opts: { port: string; host: string; open?: boolean; allowWrite?: boolean; maintainInterval?: string }) => {
    requireConfig()
    const config = getConfig()
    if (!config) return
    try {
      await startServer({
        config,
        port: Number(opts.port),
        host: opts.host,
        open: opts.open,
        allowWrite: opts.allowWrite,
        maintainIntervalMinutes: opts.maintainInterval
          ? Number(opts.maintainInterval)
          : undefined,
      })
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
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
  .description('Check wiki health and forensic citation proofs')
  .option('--forensic', 'Run deterministic forensic citation audit (zero hallucinated citations)')
  .option('--strict', 'Strict mode: fail on uncited paragraphs or unlisted frontmatter')
  .action(async (opts: { forensic?: boolean; strict?: boolean }) => {
    requireConfig()
    const config = getConfig()!
    if (opts.forensic || opts.strict || config.forensicCitations) {
      const { verifyCitations, formatCitationAuditReport } = await import('../src/core/citations.js')
      console.log('Running forensic citation audit...\n')
      const report = await verifyCitations(config.wikiDir, {
        strict: Boolean(opts.strict),
        requireLocators: Boolean(opts.strict),
      })
      console.log(formatCitationAuditReport(report))
      if (!report.passed) {
        process.exit(1)
      }
      return
    }
    const agent = createAxiomAgent(config)
    console.log('Running wiki lint...\n')
    try {
      const result = await agent.generate([{
        role: 'user',
        content: 'Run a full lint check on the wiki. Report all issues found including citation verification.',
      }])
      console.log(result.text)
    } catch (err: unknown) {
      console.error('Lint failed:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command('maintain')
  .description('Plan or apply deterministic maintenance (summaries, orphan links, duplicates)')
  .option('--apply', 'write the safe fixes instead of printing the plan')
  .option('--json', 'print the plan or run result as JSON')
  .option('--limit <n>', 'maximum fixes per category', '25')
  .option('--no-summaries', 'skip summary backfill')
  .option('--no-links', 'skip orphan adoption')
  .option('--no-duplicates', 'skip duplicate proposals')
  .option('--no-dead-links', 'skip dead-link reporting')
  .option('--no-tags', 'skip untagged-page reporting')
  .option('--stubs', 'create stub pages for safe dead links (apply only)')
  .option('--refresh-stale', 'rewrite summaries with no overlap with the body (apply only)')
  .action(async (opts: {
    apply?: boolean
    json?: boolean
    limit?: string
    summaries?: boolean
    links?: boolean
    duplicates?: boolean
    deadLinks?: boolean
    tags?: boolean
    stubs?: boolean
    refreshStale?: boolean
  }) => {
    requireConfig()
    const config = getConfig()!
    const { runMaintenance, formatMaintenancePlan } = await import('../src/core/maintenance.js')
    const limit = Number.parseInt(opts.limit ?? '25', 10)
    try {
      const result = await runMaintenance(config, {
        apply: Boolean(opts.apply),
        limit: Number.isFinite(limit) ? limit : 25,
        summaries: opts.summaries,
        links: opts.links,
        duplicates: opts.duplicates,
        deadLinks: opts.deadLinks,
        tags: opts.tags,
        createStubs: Boolean(opts.stubs),
        refreshStale: Boolean(opts.refreshStale),
        obsidianCompat: Boolean(config.obsidianCompat),
      })

      if (result.status === 'busy') {
        console.error(
          `Another operation is running${result.pid ? ` (pid ${result.pid})` : ''}. Try again when it finishes.`,
        )
        process.exit(1)
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }

      console.log(formatMaintenancePlan(result.plan))
      if (!opts.apply) {
        console.log('')
        console.log('Run with --apply to write the safe fixes.')
        return
      }

      const applied = result.applied
      const changed = applied
        ? applied.summaries + applied.staleSummaries + applied.links + applied.stubs
        : 0
      console.log('')
      if (changed === 0) {
        console.log('Nothing to do — the wiki is already tidy.')
        return
      }
      console.log(
        `Applied: ${applied?.summaries ?? 0} summaries, ` +
          `${applied?.staleSummaries ?? 0} stale refreshes, ` +
          `${applied?.links ?? 0} links, ${applied?.stubs ?? 0} stubs.`,
      )
      console.log(result.committed ? 'Changes committed.' : 'Changes written (not committed).')
    } catch (err: unknown) {
      console.error('Maintenance failed:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command('export')
  .description('Export the wiki as a static HTML site')
  .option('-o, --out <dir>', 'output directory', 'axiom-site')
  .option('--title <title>', 'site title shown in the header and page titles')
  .option('--base-url <url>', 'canonical base URL (enables sitemap and social tags)')
  .option('--no-graph', 'omit the graph page')
  .option('--no-search', 'omit the search page and index')
  .option('--force', 'overwrite a non-empty output directory')
  .option('--open', 'open the exported site in a browser')
  .action(async (opts: {
    out?: string
    title?: string
    baseUrl?: string
    graph?: boolean
    search?: boolean
    force?: boolean
    open?: boolean
  }) => {
    requireConfig()
    const config = getConfig()!
    const { exportSite } = await import('../src/core/export.js')
    try {
      const result = exportSite(config.wikiDir, {
        outDir: path.resolve(opts.out ?? 'axiom-site'),
        title: opts.title,
        baseUrl: opts.baseUrl,
        graph: opts.graph,
        search: opts.search,
        force: opts.force,
      })
      const size = result.bytes >= 1024 * 1024
        ? `${(result.bytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(result.bytes / 1024))} KB`
      console.log(`Exported ${result.pages} pages to ${result.outDir}`)
      console.log(
        `  ${Object.keys(result.categories).length} categories · ${result.media} media · ` +
          `${result.deadLinks} dead links · ${size}`,
      )
      if (result.excludedInbox > 0) {
        console.log(`  ${result.excludedInbox} inbox note(s) left out of the public site`)
      }
      const indexPath = path.join(result.outDir, 'index.html')
      console.log(`  Open: ${indexPath}`)
      if (opts.open) openUrlInBrowser(indexPath)
    } catch (err: unknown) {
      console.error('Export failed:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command('rerank')
  .description('Configure, download, or test the candidate reranker')
  .option('--status', 'show the effective reranker settings')
  .option('--setup', 'download and cache the configured local model')
  .option('--test <query>', 'rerank a few pages for a query')
  .option('--provider <provider>', 'none | local | llm | cohere')
  .option('--model <model>', 'local model id or preset key (fast, balanced, multilingual); Cohere model id')
  .option('--top-n <n>', 'seeds kept after reranking')
  .option('--candidates <n>', 'candidates fetched before reranking')
  .option('--api-key <key>', 'Cohere API key')
  .option('--clear-api-key', 'remove the stored Cohere key')
  .option('--json', 'print JSON')
  .action(async (opts: {
    status?: boolean
    setup?: boolean
    test?: string
    provider?: string
    model?: string
    topN?: string
    candidates?: string
    apiKey?: string
    clearApiKey?: boolean
    json?: boolean
  }) => {
    requireConfig()
    const config = getConfig()!
    const {
      DEFAULT_RERANK_MODEL,
      RERANK_PRESETS,
      describeRerankConfig,
      localModelStatus,
      presetForKey,
      rerankCandidates,
      resolveRerankConfig,
      setupLocalReranker,
    } = await import('../src/core/rerank.js')
    const { setConfig } = await import('../src/config/index.js')

    const hasSave = Boolean(
      opts.provider || opts.model || opts.topN || opts.candidates || opts.apiKey || opts.clearApiKey,
    )

    if (hasSave) {
      const provider = (opts.provider ?? config.rerank?.provider ?? 'local') as RerankConfig['provider']
      if (!['none', 'local', 'llm', 'cohere'].includes(provider)) {
        console.error('Provider must be one of: none, local, llm, cohere.')
        process.exit(1)
      }
      const topN = opts.topN ? Number.parseInt(opts.topN, 10) : undefined
      const candidates = opts.candidates ? Number.parseInt(opts.candidates, 10) : undefined
      const rerank: RerankConfig = {
        provider,
        ...(opts.model ? { model: opts.model } : {}),
        ...(topN !== undefined && Number.isFinite(topN) ? { topN } : {}),
        ...(candidates !== undefined && Number.isFinite(candidates) ? { candidates } : {}),
        ...(opts.clearApiKey
          ? {}
          : opts.apiKey
            ? { apiKey: opts.apiKey }
            : config.rerank?.apiKey
              ? { apiKey: config.rerank.apiKey }
              : {}),
      }
      const resolved = resolveRerankConfig({ ...config, rerank })
      rerank.topN = resolved.topN
      rerank.candidates = resolved.candidates
      setConfig({ rerank })
      config.rerank = rerank
      if (!opts.json) {
        console.log(
          `Reranker: ${resolved.provider}${resolved.model ? ` · ${resolved.model}` : ''} · ` +
            `top ${resolved.topN} of ${resolved.candidates}`,
        )
      }
    }

    if (opts.setup) {
      const resolved = resolveRerankConfig(config)
      const requested =
        opts.model || (resolved.provider === 'local' ? resolved.model : DEFAULT_RERANK_MODEL)
      const model = presetForKey(requested)?.id ?? requested
      console.log(`Preparing ${model}…`)
      const result = await setupLocalReranker(model, (message) => console.log(message))
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(`Ready: ${result.ready ? 'yes' : 'no'} (${result.path})`)
      }
    }

    if (opts.test) {
      const { searchWiki } = await import('../src/core/search.js')
      const results = await searchWiki(config.wikiDir, opts.test, { limit: 6, config })
      const candidates = results.map((result) => ({
        id: result.path.replace(/^wiki\/pages\//, '').replace(/\.md$/, ''),
        title: result.title,
        summary: result.summary,
        text: result.excerpt,
        sectionTitle: result.sectionTitle,
      }))
      if (candidates.length === 0) {
        candidates.push(
          {
            id: 'sample/logic',
            title: 'Logic',
            summary: 'The study of valid inference.',
            text: 'Logic is the study of valid inference and the rules of reasoning.',
            sectionTitle: undefined,
          },
          {
            id: 'sample/bananas',
            title: 'Bananas',
            summary: 'A fruit.',
            text: 'Bananas are yellow and grow in bunches.',
            sectionTitle: undefined,
          },
        )
      }
      const outcome = await rerankCandidates(config, opts.test, candidates, { allowDownload: false })
      if (opts.json) {
        console.log(JSON.stringify(outcome, null, 2))
      } else {
        console.log(
          `Reranker: ${outcome.provider}${outcome.model ? ` · ${outcome.model}` : ''} ` +
            `(${outcome.used ? 'used' : 'fallback'}, ${outcome.latencyMs}ms)`,
        )
        if (!outcome.used && outcome.reason) console.log(`  reason: ${outcome.reason}`)
        outcome.candidates.forEach((candidate, index) => {
          console.log(`  ${index + 1}. ${candidate.title} (${(candidate.score ?? 0).toFixed(3)})`)
        })
      }
    }

    if (opts.status || (!hasSave && !opts.setup && !opts.test)) {
      const described = describeRerankConfig(config)
      if (opts.json) {
        console.log(JSON.stringify(described, null, 2))
      } else {
        console.log(`Reranker: ${described.provider}`)
        if (described.model) console.log(`  model: ${described.model}`)
        console.log(`  keep: ${described.topN} seeds from ${described.candidates} candidates`)
        if (described.provider === 'cohere') {
          console.log(`  Cohere key: ${described.hasApiKey ? 'configured' : 'missing'}`)
        }
        console.log('  local models:')
        for (const preset of RERANK_PRESETS) {
          const status = localModelStatus(preset.id)
          console.log(
            `    ${preset.key.padEnd(12)} ${preset.label} · ${preset.sizeMb} MB · ` +
              `${status.ready ? 'cached' : 'not downloaded'}`,
          )
        }
      }
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
  .option('--lang <code>', 'Preferred transcript language for YouTube URLs (default: en)')
  .action((url?: string, opts?: { lang?: string }) => {
    requireConfig()
    renderApp({ name: 'clip', url, lang: opts?.lang })
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
