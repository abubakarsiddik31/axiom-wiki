import { createAutowikiAgent } from '../agent/index.js'
import { AUTOWIKI_CONTINUE_PROMPT } from '../agent/prompts.js'
import { updateIndex, appendLog } from './wiki.js'
import { indexWikiPage, persistOrama } from './indexing.js'
import { calcCost, appendUsageLog } from './usage.js'
import { saveMapState, getGitHeadHash, type MapState } from './sync.js'
import { withRetry, classifyError, friendlyErrorMessage } from './retry.js'
import type { AxiomConfig } from '../config/index.js'
import type { ProjectSnapshot } from './mapper.js'

export interface AutowikiBatchResult {
  pagesWritten: string[]
  done: boolean
  inputTokens: number
  outputTokens: number
  costUsd: number | null
  error?: string
}

export interface AutowikiProgress {
  batch: number
  totalBatches: number
  pagesWritten: string[]
  totalCostUsd: number
  done: boolean
  log: string[]
}

export interface AutowikiOptions {
  maxBatches?: number
  maxCostUsd?: number
  onBatchStart?: (batch: number) => void
  onBatchEnd?: (batch: number, result: AutowikiBatchResult) => void
  onToolCall?: (toolName: string, args: string) => void
  onLog?: (message: string) => void
}

export interface AutowikiResult {
  pagesWritten: string[]
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  batches: number
  abortReason?: string
}

function extractPagesFromToolCalls(steps: any[]): string[] {
  const pages: string[] = []
  for (const step of steps) {
    for (const call of step.toolCalls ?? []) {
      const name = call.toolName ?? call.payload?.toolName
      const args = call.args ?? call.payload?.args
      if (name === 'write_page' && args?.path) {
        const p = args.path as string
        if (!pages.includes(p)) pages.push(p)
      }
    }
  }
  return pages
}

export async function runAutowiki(
  config: AxiomConfig,
  projectRoot: string,
  snapshot: ProjectSnapshot,
  opts: AutowikiOptions = {},
): Promise<AutowikiResult> {
  const maxBatches = opts.maxBatches ?? 10
  const maxCostUsd = opts.maxCostUsd ?? 5.0
  const log = opts.onLog ?? (() => {})

  const allPagesWritten: string[] = []
  let totalCostUsd = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let batchCount = 0
  let abortReason: string | undefined

  const today = new Date().toISOString().slice(0, 10)

  for (let batch = 0; batch < maxBatches; batch++) {
    batchCount = batch + 1
    opts.onBatchStart?.(batchCount)
    log(`Batch ${batchCount}/${maxBatches}`)

    const agent = createAutowikiAgent(config, projectRoot, snapshot, 'autowiki')

    const prompt = batch === 0
      ? `Build a wiki for this software project. Start by calling get_project_overview to understand the structure, then explore and create wiki pages.\n\nToday's date: ${today}`
      : `${AUTOWIKI_CONTINUE_PROMPT}\n\nToday's date: ${today}`

    let batchResult: AutowikiBatchResult

    try {
      const steps: any[] = []
      const stepFinish = (step: any) => {
        steps.push(step)
        try {
          for (const call of step.toolCalls ?? []) {
            const toolName = call.toolName ?? call.payload?.toolName ?? 'tool'
            const args = JSON.stringify(call.args ?? call.payload?.args ?? {})
            opts.onToolCall?.(toolName, args)
          }
        } catch { /* never crash the agent loop */ }
      }

      const result = await withRetry(() => agent.generate(
        [{ role: 'user', content: prompt }],
        { onStepFinish: stepFinish } as any,
      ))

      const usage = (result as any).usage ?? null
      const inputTokens = usage?.inputTokens ?? usage?.promptTokens ?? 0
      const outputTokens = usage?.outputTokens ?? usage?.completionTokens ?? 0
      const costUsd = calcCost(config.provider, config.model, inputTokens, outputTokens)

      const pagesWritten = extractPagesFromToolCalls(steps)
      const isDone = /\bDONE\b/.test(result.text?.trim().split('\n').pop() ?? '')

      batchResult = { pagesWritten, done: isDone, inputTokens, outputTokens, costUsd }

      try {
        appendUsageLog(config.wikiDir, {
          timestamp: new Date().toISOString(),
          operation: 'map',
          source: `batch-${batchCount}`,
          provider: config.provider,
          model: config.model,
          inputTokens,
          outputTokens,
          costUsd,
        })
      } catch { /* non-fatal */ }
    } catch (err: unknown) {
      const errorClass = classifyError(err)

      if (errorClass === 'auth' || errorClass === 'billing') {
        abortReason = friendlyErrorMessage(errorClass)
        log(`Aborting: ${abortReason}`)
        break
      }

      const errMsg = errorClass !== 'unknown'
        ? friendlyErrorMessage(errorClass)
        : (err instanceof Error ? err.message : String(err))
      log(`Batch ${batchCount} failed: ${errMsg}`)

      batchResult = {
        pagesWritten: [],
        done: false,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        error: errMsg,
      }
    }

    // Accumulate results
    for (const p of batchResult.pagesWritten) {
      if (!allPagesWritten.includes(p)) allPagesWritten.push(p)
    }
    totalInputTokens += batchResult.inputTokens
    totalOutputTokens += batchResult.outputTokens
    if (batchResult.costUsd !== null) totalCostUsd += batchResult.costUsd

    opts.onBatchEnd?.(batchCount, batchResult)
    log(`Batch ${batchCount} done: ${batchResult.pagesWritten.length} pages written`)

    // Update index after each batch so next batch sees current state
    try {
      await updateIndex(config.wikiDir)
      if (config.embeddings && config.embeddings.provider !== 'none') {
        log(`Indexing ${batchResult.pagesWritten.length} pages...`)
        for (const p of batchResult.pagesWritten) {
          try { await indexWikiPage(config, p) } catch { /* skip failed index */ }
        }
        await persistOrama(config)
      }
    } catch { /* non-fatal */ }

    // Stop conditions
    if (batchResult.done) {
      log('Agent signaled DONE')
      break
    }

    if (totalCostUsd >= maxCostUsd) {
      abortReason = `Cost limit reached ($${totalCostUsd.toFixed(2)} >= $${maxCostUsd.toFixed(2)})`
      log(abortReason)
      break
    }

    if (batchResult.pagesWritten.length === 0 && !batchResult.error) {
      // Agent produced no pages and no error — likely nothing left to do
      log('No pages written in this batch — stopping')
      break
    }
  }

  // Final index update + log
  try { await updateIndex(config.wikiDir) } catch { /* non-fatal */ }
  try {
    await appendLog(
      config.wikiDir,
      `autowiki: created ${allPagesWritten.length} pages in ${batchCount} batches from project at ${projectRoot.split('/').pop()}`,
      'map',
    )
  } catch { /* non-fatal */ }

  // Save map state for sync
  try {
    const mapState: MapState = {
      version: 1 as const,
      createdAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString(),
      gitCommitHash: getGitHeadHash(projectRoot),
      pages: allPagesWritten.map((pagePath) => {
        const parts = pagePath.replace('wiki/pages/', '').replace('.md', '').split('/')
        const category = parts[0] ?? 'analyses'
        const slug = parts.slice(1).join('/') || parts[0] || 'unknown'
        return { slug, title: slug, category, description: '', paths: [] }
      }),
    }
    saveMapState(config.wikiDir, mapState)
  } catch { /* non-fatal */ }

  return {
    pagesWritten: allPagesWritten,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    batches: batchCount,
    abortReason,
  }
}

export async function runSync(
  config: AxiomConfig,
  projectRoot: string,
  snapshot: ProjectSnapshot,
  changedFiles: string[],
  existingMapState: MapState,
  opts: AutowikiOptions = {},
): Promise<AutowikiResult> {
  const maxBatches = opts.maxBatches ?? 3
  const log = opts.onLog ?? (() => {})

  const agent = createAutowikiAgent(config, projectRoot, snapshot, 'sync')
  const today = new Date().toISOString().slice(0, 10)

  const changedSummary = changedFiles.length > 50
    ? changedFiles.slice(0, 50).join('\n') + `\n... and ${changedFiles.length - 50} more files`
    : changedFiles.join('\n')

  const prompt = `The codebase has changed since the wiki was last updated. Here are the changed files:

${changedSummary}

Read the wiki index to see existing pages, then check which pages need updating based on the changes above. Also check if any new areas need documentation.

Today's date: ${today}`

  const allPagesWritten: string[] = []
  let totalCostUsd = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let batchCount = 0
  let abortReason: string | undefined

  for (let batch = 0; batch < maxBatches; batch++) {
    batchCount = batch + 1
    opts.onBatchStart?.(batchCount)

    const batchPrompt = batch === 0
      ? prompt
      : `${AUTOWIKI_CONTINUE_PROMPT}\n\nToday's date: ${today}`

    try {
      const steps: any[] = []
      const stepFinish = (step: any) => {
        steps.push(step)
        try {
          for (const call of step.toolCalls ?? []) {
            const toolName = call.toolName ?? call.payload?.toolName ?? 'tool'
            const args = JSON.stringify(call.args ?? call.payload?.args ?? {})
            opts.onToolCall?.(toolName, args)
          }
        } catch { /* never crash */ }
      }

      const result = await withRetry(() => agent.generate(
        [{ role: 'user', content: batchPrompt }],
        { onStepFinish: stepFinish } as any,
      ))

      const usage = (result as any).usage ?? null
      const inputTokens = usage?.inputTokens ?? usage?.promptTokens ?? 0
      const outputTokens = usage?.outputTokens ?? usage?.completionTokens ?? 0
      const costUsd = calcCost(config.provider, config.model, inputTokens, outputTokens)

      totalInputTokens += inputTokens
      totalOutputTokens += outputTokens
      if (costUsd !== null) totalCostUsd += costUsd

      const pagesWritten = extractPagesFromToolCalls(steps)
      for (const p of pagesWritten) {
        if (!allPagesWritten.includes(p)) allPagesWritten.push(p)
      }

      opts.onBatchEnd?.(batchCount, { pagesWritten, done: true, inputTokens, outputTokens, costUsd })

      try {
        appendUsageLog(config.wikiDir, {
          timestamp: new Date().toISOString(),
          operation: 'sync',
          source: `batch-${batchCount}`,
          provider: config.provider,
          model: config.model,
          inputTokens,
          outputTokens,
          costUsd,
        })
      } catch { /* non-fatal */ }

      const isDone = /\bDONE\b/.test(result.text?.trim().split('\n').pop() ?? '')
      if (isDone || pagesWritten.length === 0) break

      try {
        await updateIndex(config.wikiDir)
        if (config.embeddings && config.embeddings.provider !== 'none') {
          log(`Indexing ${pagesWritten.length} pages...`)
          for (const p of pagesWritten) {
            try { await indexWikiPage(config, p) } catch { /* skip failed index */ }
          }
          await persistOrama(config)
        }
      } catch { /* non-fatal */ }
    } catch (err: unknown) {
      const errorClass = classifyError(err)
      const errMsg = errorClass !== 'unknown'
        ? friendlyErrorMessage(errorClass)
        : (err instanceof Error ? err.message : String(err))
      log(`Sync batch failed: ${errMsg}`)

      if (errorClass === 'auth' || errorClass === 'billing') {
        abortReason = errMsg
        break
      }
    }
  }

  // Finalize
  try { await updateIndex(config.wikiDir) } catch { /* non-fatal */ }
  try {
    await appendLog(config.wikiDir, `sync: updated ${allPagesWritten.length} pages`, 'sync')
  } catch { /* non-fatal */ }

  try {
    const updatedState: MapState = {
      ...existingMapState,
      lastSyncAt: new Date().toISOString(),
      gitCommitHash: getGitHeadHash(projectRoot),
    }
    saveMapState(config.wikiDir, updatedState)
  } catch { /* non-fatal */ }

  return {
    pagesWritten: allPagesWritten,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    batches: batchCount,
    abortReason,
  }
}
