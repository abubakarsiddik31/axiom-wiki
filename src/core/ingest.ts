import fs from 'fs'
import path from 'path'
import ignore from 'ignore'

import type { AxiomConfig } from '../config/index.js'
import { createAxiomAgent } from '../agent/index.js'
import {
  SUPPORTED_EXTS,
  buildIngestMessage,
  checkFileSize,
  ConversionError,
} from './files.js'
import { clipUrl } from './clip.js'
import { parseYouTubeUrl } from './youtube.js'
import { updateIndex, updateMOC, appendLog, snapshotWiki, diffWiki } from './wiki.js'
import { indexWikiPage, persistOrama } from './indexing.js'
import { calcCost, appendUsageLog } from './usage.js'
import { loadIgnorePatterns } from './watcher.js'
import {
  loadState,
  saveState,
  detectChanges,
  recordIngest,
  migrateFromLog,
  statePath,
} from './state.js'
import { buildRecompilationPlan } from './compiler.js'
import { acquireLock, releaseLock, getLockInfo } from './lock.js'
import { withRetry, classifyError, friendlyErrorMessage } from './retry.js'
import { getIngestedFromLog } from './sources.js'
import { getContextWindow } from '../config/models.js'

export interface IngestFileResult {
  filename: string
  status: 'done' | 'error'
  pages: string[]
  changes: Array<{ path: string; type: 'created' | 'modified' }>
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null } | null
  error?: string
}

export interface IngestRunResult {
  files: IngestFileResult[]
  pages: string[]
  summary: string
}

export interface IngestRequest {
  /** A URL, an absolute/relative path, or a filename inside `raw/`. */
  file?: string
  /** Scan `raw/` for new or changed sources. */
  all?: boolean
  /** Treat an already-ingested source as a re-ingest. */
  reingest?: boolean
  /** Preferred YouTube subtitle language. */
  lang?: string
  /** Extra framing passed to the ingest prompt. */
  context?: string
}

export interface IngestHooks {
  onStatus?: (line: string) => void
  signal?: AbortSignal
}

export class LockBusyError extends Error {
  constructor(public readonly pid: number | null, public readonly acquiredAt: string | null) {
    super(
      pid
        ? `Another operation is running (pid ${pid}${acquiredAt ? ` since ${acquiredAt}` : ''}).`
        : 'Another operation is running.',
    )
    this.name = 'LockBusyError'
  }
}

export class AbortIngestError extends Error {
  constructor() {
    super('Ingest cancelled.')
    this.name = 'AbortError'
  }
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '').replace(/\\(.)/g, '$1')
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortIngestError()
}

/** Pull `wiki/pages/**.md` paths out of the agent's final text. */
export function extractPages(text: string): string[] {
  const pages: string[] = []
  const re = /wiki\/pages\/[\w/-]+\.md/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (!pages.includes(match[0])) pages.push(match[0])
  }
  return pages
}

interface Target {
  filepath: string
  filename: string
}

function resolveSingleTarget(config: AxiomConfig, raw: string): Target {
  const cleaned = stripQuotes(raw)
  const candidate = cleaned.includes('/') || cleaned.includes('\\')
    ? path.resolve(cleaned)
    : path.join(config.rawDir, cleaned)

  if (!fs.existsSync(candidate)) {
    throw new Error(`File not found: ${candidate}`)
  }
  if (!fs.statSync(candidate).isFile()) {
    throw new Error(`Not a file: ${candidate}`)
  }

  const ext = path.extname(candidate).toLowerCase()
  if (!SUPPORTED_EXTS.includes(ext)) {
    throw new Error(`Unsupported file type: ${ext}`)
  }

  return { filepath: candidate, filename: path.basename(candidate) }
}

function resolveIncrementalTargets(config: AxiomConfig): Target[] {
  const { rawDir, wikiDir } = config
  const ignorePatterns = loadIgnorePatterns(rawDir)
  const ig = ignore().add(ignorePatterns)

  const allRaw = fs.existsSync(rawDir)
    ? fs.readdirSync(rawDir).filter((name) => {
        const ext = path.extname(name).toLowerCase()
        if (!SUPPORTED_EXTS.includes(ext)) return false
        const full = path.join(rawDir, name)
        if (!fs.statSync(full).isFile()) return false
        return !ig.ignores(name)
      })
    : []

  const stateFile = statePath(wikiDir)
  const state = fs.existsSync(stateFile)
    ? loadState(wikiDir)
    : migrateFromLog(wikiDir, rawDir)

  const changes = detectChanges(rawDir, allRaw, state)
  const plan = buildRecompilationPlan(state, changes)
  return [
    ...plan.directSources.map((change) => ({
      filepath: change.filepath,
      filename: change.filename,
    })),
    ...plan.additionalSources.map((filename) => ({
      filepath: path.join(rawDir, filename),
      filename,
    })),
  ]
}

function checkContext(filepath: string, config: AxiomConfig): void {
  const ext = path.extname(filepath).slice(1).toLowerCase()
  if (!['md', 'txt', 'html', 'docx'].includes(ext)) return

  const sizeBytes = fs.statSync(filepath).size
  const estimatedTokens = Math.ceil(sizeBytes / 3.5)
  const contextWindow = getContextWindow(config.provider, config.model)
  const overhead = 8_000
  if (estimatedTokens + overhead > contextWindow * 0.95) {
    throw new Error(
      `File is ~${(estimatedTokens / 1000).toFixed(0)}K tokens, model context is ${(contextWindow / 1000).toFixed(0)}K. Try a model with a larger context window.`,
    )
  }
}

/**
 * Non-interactive ingest used by the web action API. Mirrors the CLI ingest
 * screen's write sequence (agent → index/MOC → log → state → usage) but has no
 * prompts, so a long-running caller can stream progress through `onStatus`.
 *
 * The compilation lock is acquired here and released on every exit path. The
 * caller must not hold the lock already.
 */
export async function ingest(
  config: AxiomConfig,
  request: IngestRequest = {},
  hooks: IngestHooks = {},
): Promise<IngestRunResult> {
  const { onStatus, signal } = hooks
  const status = (line: string) => onStatus?.(line)

  if (!acquireLock(config.wikiDir)) {
    const { info } = getLockInfo(config.wikiDir)
    throw new LockBusyError(info?.pid ?? null, info?.acquiredAt ?? null)
  }

  try {
    abortIfNeeded(signal)
    const logPath = path.join(config.wikiDir, 'wiki/log.md')
    const files: IngestFileResult[] = []

    let targets: Target[] = []
    if (request.file && isUrl(request.file)) {
      const url = stripQuotes(request.file)
      status(parseYouTubeUrl(url) ? 'Fetching YouTube transcript…' : 'Clipping URL…')
      const clipped = await clipUrl(url, config.rawDir, {
        lang: request.lang,
        onStatus: (line) => status(line),
      })
      abortIfNeeded(signal)
      status(`${clipped.reused ? 'Already saved' : 'Saved'}: ${clipped.filename}`)
      targets = [{ filepath: clipped.filepath, filename: clipped.filename }]
    } else if (request.file) {
      const target = resolveSingleTarget(config, request.file)
      const ingested = getIngestedFromLog(logPath)
      const reingest = request.reingest || ingested.has(target.filename)
      if (reingest) status(`Re-ingesting ${target.filename}`)
      targets = [target]
    } else {
      targets = resolveIncrementalTargets(config)
    }

    if (targets.length === 0) {
      status('No new or changed sources.')
      return { files: [], pages: [], summary: 'No new or changed sources.' }
    }

    const agent = createAxiomAgent(config)
    const allPages: string[] = []

    for (const target of targets) {
      abortIfNeeded(signal)
      status(`Ingesting ${target.filename}…`)
      const result = await ingestOne(config, agent, target, Boolean(request.reingest), request.context, status, signal)
      abortIfNeeded(signal)
      files.push(result)
      allPages.push(...result.pages)
      if (result.status === 'error' && result.error) status(`✗ ${target.filename}: ${result.error}`)
    }

    const failed = files.filter((file) => file.status === 'error').length
    const succeeded = files.length - failed
    const summary = `Ingest complete — ${succeeded} succeeded, ${failed} failed.`
    status(summary)
    return { files, pages: [...new Set(allPages)], summary }
  } finally {
    releaseLock(config.wikiDir)
  }
}

async function ingestOne(
  config: AxiomConfig,
  agent: ReturnType<typeof createAxiomAgent>,
  target: Target,
  forceReingest: boolean,
  userContext: string | undefined,
  status: (line: string) => void,
  signal?: AbortSignal,
): Promise<IngestFileResult> {
  const { filepath, filename } = target
  const before = snapshotWiki(config.wikiDir)
  const reingest = forceReingest || getIngestedFromLog(path.join(config.wikiDir, 'wiki/log.md')).has(filename)

  try {
    abortIfNeeded(signal)
    const sizeCheck = checkFileSize(filepath)
    if (!sizeCheck.ok) {
      return {
        filename,
        status: 'error',
        pages: [],
        changes: [],
        usage: null,
        error: sizeCheck.warning ?? 'File is too large.',
      }
    }
    if (sizeCheck.warning) status(`⚠ ${sizeCheck.warning}`)

    checkContext(filepath, config)
    abortIfNeeded(signal)

    const message = await buildIngestMessage(filepath, reingest, userContext ?? '', config)
    const result = await withRetry(() =>
      agent.generate([message], {
        onStepFinish: (step: any) => {
          for (const call of step.toolCalls ?? []) {
            const name = call.toolName ?? call.payload?.toolName ?? 'tool'
            const args = JSON.stringify(call.args ?? call.payload?.args ?? {})
            status(`⚙ ${name}(${args.slice(0, 80)}${args.length > 80 ? '…' : ''})`)
          }
          for (const res of step.toolResults ?? []) {
            const value = res.result ?? res.payload?.result
            if (typeof value === 'string' && value.length < 120) status(`  → ${value}`)
          }
        },
      }),
    )

    abortIfNeeded(signal)
    const pages = extractPages(result.text ?? '')

    status('Updating index and map of content…')
    await updateIndex(config.wikiDir)
    await updateMOC(config.wikiDir)

    if (config.embeddings && config.embeddings.provider !== 'none') {
      status('Updating semantic index…')
      for (const page of pages) {
        try {
          await indexWikiPage(config, page)
        } catch {
          // Indexing is best effort — a page is still readable without a vector.
        }
      }
      await persistOrama(config)
    }

    await appendLog(config.wikiDir, filename, 'ingest')

    const state = loadState(config.wikiDir)
    recordIngest(state, filename, filepath, pages)
    saveState(config.wikiDir, state)

    const usage = (result as any).usage ?? null
    const inputTokens: number = usage?.inputTokens ?? usage?.promptTokens ?? 0
    const outputTokens: number = usage?.outputTokens ?? usage?.completionTokens ?? 0
    const costUsd = calcCost(config.provider, config.model, inputTokens, outputTokens)
    appendUsageLog(config.wikiDir, {
      timestamp: new Date().toISOString(),
      operation: reingest ? 'reingest' : 'ingest',
      source: filename,
      provider: config.provider,
      model: config.model,
      inputTokens,
      outputTokens,
      costUsd,
    })

    return {
      filename,
      status: 'done',
      pages,
      changes: diffWiki(before, config.wikiDir),
      usage: { inputTokens, outputTokens, costUsd },
    }
  } catch (err: unknown) {
    const message = err instanceof ConversionError
      ? err.message
      : classifyError(err) !== 'unknown'
        ? friendlyErrorMessage(classifyError(err))
        : err instanceof Error ? err.message : String(err)
    return {
      filename,
      status: 'error',
      pages: [],
      changes: diffWiki(before, config.wikiDir),
      usage: null,
      error: message,
    }
  }
}
