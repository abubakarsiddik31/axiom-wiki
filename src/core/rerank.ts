import fs from 'fs'
import path from 'path'
import os from 'os'

import { z } from 'zod'
import { generateObject } from 'ai'

import type { AxiomConfig } from '../config/index.js'

/**
 * Candidate reranking.
 *
 * Hybrid search is good at recall; a reranker is good at precision. This module
 * sits between `searchWiki` and `assembleContext`: take a wider candidate set,
 * rescore the (query, passage) pairs, and keep the best few before the link
 * graph expands them.
 *
 * Four backends:
 *   - local  : an ONNX cross-encoder via Transformers.js (default; balanced BGE)
 *   - llm    : a listwise pass over the configured chat model (no extra install)
 *   - cohere : Cohere Rerank (hosted cross-encoder, needs a key)
 *   - none   : keep hybrid order
 */

export type RerankProvider = 'none' | 'local' | 'llm' | 'cohere'

export interface RerankCandidate {
  id: string
  title: string
  summary: string
  text: string
  /** Search section heading, preserved for the evidence excerpt. */
  sectionTitle?: string
  /** Reranker score, when returned. */
  score?: number
}

export interface ResolvedRerank {
  provider: RerankProvider
  model: string
  topN: number
  candidates: number
  apiKey: string
}

export interface RerankRunOptions extends Partial<ResolvedRerank> {
  /** Allow the local backend to download a missing model. Default false. */
  allowDownload?: boolean
  onStatus?: (message: string) => void
}

export interface RerankOutcome {
  provider: RerankProvider
  model: string
  used: boolean
  reason?: string
  candidates: RerankCandidate[]
  latencyMs: number
}

export interface RerankPreset {
  key: 'fast' | 'balanced' | 'multilingual'
  id: string
  label: string
  sizeMb: number
  languages: string
}

export const RERANK_PRESETS: RerankPreset[] = [
  {
    key: 'fast',
    id: 'Xenova/ms-marco-MiniLM-L-6-v2',
    label: 'Fast (MiniLM L6)',
    sizeMb: 23,
    languages: 'English',
  },
  {
    key: 'balanced',
    id: 'Xenova/bge-reranker-base',
    label: 'Balanced (BGE base)',
    sizeMb: 266,
    languages: 'English',
  },
  {
    key: 'multilingual',
    id: 'onnx-community/bge-reranker-v2-m3-ONNX',
    label: 'Multilingual (BGE M3)',
    sizeMb: 571,
    languages: 'Multilingual',
  },
]

export const DEFAULT_RERANK_PROVIDER: RerankProvider = 'local'
export const DEFAULT_RERANK_MODEL = 'Xenova/bge-reranker-base'
export const DEFAULT_RERANK_TOPN = 6
export const DEFAULT_RERANK_CANDIDATES = 24
export const COHERE_DEFAULT_MODEL = 'rerank-v3.5'

const MAX_CANDIDATES = 100
const MAX_TOPN = 20
const MAX_PAIR_CHARS = 1200
const LOCAL_DTYPE = 'q8'
const LOCAL_MAX_LENGTH = 512

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function resolveRerankConfig(config: AxiomConfig): ResolvedRerank {
  const raw = config.rerank
  const provider = normalizeProvider(raw?.provider)
  const model = normalizeModel(raw?.model, provider)
  const topN = clamp(positiveNumber(raw?.topN, DEFAULT_RERANK_TOPN), 1, MAX_TOPN)
  const candidates = clamp(
    positiveNumber(raw?.candidates, Math.max(DEFAULT_RERANK_CANDIDATES, topN)),
    topN,
    MAX_CANDIDATES,
  )
  return {
    provider,
    model,
    topN,
    candidates,
    apiKey: raw?.apiKey || process.env['COHERE_API_KEY'] || '',
  }
}

function normalizeProvider(value: unknown): RerankProvider {
  return value === 'local' || value === 'llm' || value === 'cohere' || value === 'none'
    ? value
    : DEFAULT_RERANK_PROVIDER
}

function normalizeModel(value: string | undefined, provider: RerankProvider): string {
  if (provider === 'none') return ''
  if (provider === 'llm') return ''
  if (provider === 'cohere') return (value || COHERE_DEFAULT_MODEL).trim()

  const requested = (value || DEFAULT_RERANK_MODEL).trim()
  const preset = RERANK_PRESETS.find((entry) => entry.key === requested || entry.id === requested)
  return preset?.id ?? requested
}

export function presetForKey(key: string): RerankPreset | undefined {
  return RERANK_PRESETS.find((preset) => preset.key === key || preset.id === key)
}

/** Public shape for the API and the Settings page — never includes the key. */
export function describeRerankConfig(config: AxiomConfig): {
  provider: RerankProvider
  model: string
  topN: number
  candidates: number
  hasApiKey: boolean
  localReady: boolean
  localModels: Record<string, boolean>
  presets: RerankPreset[]
} {
  const resolved = resolveRerankConfig(config)
  const localModels = Object.fromEntries(
    RERANK_PRESETS.map((preset) => [preset.id, localModelStatus(preset.id).ready]),
  )
  const localModel =
    resolved.provider === 'local' ? resolved.model : DEFAULT_RERANK_MODEL
  return {
    provider: resolved.provider,
    model: resolved.model,
    topN: resolved.topN,
    candidates: resolved.candidates,
    hasApiKey: Boolean(resolved.apiKey),
    localReady: localModels[localModel] ?? localModelStatus(localModel).ready,
    localModels,
    presets: RERANK_PRESETS,
  }
}

// ── Local cross-encoder ───────────────────────────────────────────────────

export function modelsDir(): string {
  return process.env['AXIOM_MODELS_DIR'] || path.join(os.homedir(), '.axiom', 'models')
}

export function localModelStatus(model: string): { ready: boolean; path: string } {
  const resolved = presetForKey(model)?.id ?? model
  const dir = path.join(modelsDir(), ...resolved.split('/'), 'onnx')
  const candidates = [
    path.join(dir, 'model_quantized.onnx'),
    path.join(dir, 'model_q8.onnx'),
    path.join(dir, 'model_int8.onnx'),
    path.join(dir, 'model.onnx'),
  ]
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  return found ? { ready: true, path: found } : { ready: false, path: candidates[0]! }
}

interface LoadedLocal {
  model: string
  tokenizer: unknown
  classifier: unknown
}

let loadedLocal: LoadedLocal | null = null
let loadingLocal: { model: string; promise: Promise<LoadedLocal> } | null = null

async function loadLocalModel(
  model: string,
  options: { allowDownload: boolean; onStatus?: (message: string) => void },
): Promise<LoadedLocal> {
  if (loadedLocal?.model === model) return loadedLocal
  if (loadingLocal?.model === model) return loadingLocal.promise

  const cacheDir = modelsDir()
  fs.mkdirSync(cacheDir, { recursive: true })
  const status = localModelStatus(model)
  if (!status.ready && !options.allowDownload) {
    throw new Error(
      `Reranker model “${model}” is not downloaded. Run “axiom-wiki rerank --setup” or use the Settings page.`,
    )
  }

  const promise = (async () => {
    options.onStatus?.(`Loading reranker model ${model} (${status.ready ? 'cached' : 'first download'})…`)
    const { env, AutoTokenizer, AutoModelForSequenceClassification } = await import(
      '@huggingface/transformers'
    )
    env.cacheDir = cacheDir
    env.allowRemoteModels = true
    env.allowLocalModels = true

    let lastFile = ''
    let lastPercent = -10
    const progress = (event: { status?: string; file?: string; progress?: number }) => {
      if (event.status !== 'progress' || typeof event.progress !== 'number') return
      const file = event.file ?? ''
      const percent = Math.round(event.progress)
      if (file === lastFile && percent - lastPercent < 10) return
      lastFile = file
      lastPercent = percent
      options.onStatus?.(`Downloading ${path.basename(file)} — ${percent}%`)
    }

    const tokenizer = await AutoTokenizer.from_pretrained(model, { progress_callback: progress })
    const classifier = await AutoModelForSequenceClassification.from_pretrained(model, {
      dtype: LOCAL_DTYPE,
      progress_callback: progress,
    })

    loadedLocal = { model, tokenizer, classifier }
    writeLocalMarker(model)
    options.onStatus?.(`Reranker ready: ${model}`)
    return loadedLocal
  })()

  loadingLocal = { model, promise }
  try {
    return await promise
  } finally {
    loadingLocal = null
  }
}

function writeLocalMarker(model: string): void {
  try {
    const file = path.join(modelsDir(), '.axiom-rerank-cache.json')
    let current: Record<string, { loadedAt: string }> = {}
    try {
      current = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, { loadedAt: string }>
    } catch {
      /* first run */
    }
    current[model] = { loadedAt: new Date().toISOString() }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf-8')
  } catch {
    /* the marker is a convenience, not a requirement */
  }
}

/** Downloads and caches a local model, used by `rerank --setup`. */
export async function setupLocalReranker(
  model: string,
  onStatus?: (message: string) => void,
): Promise<{ model: string; ready: boolean; path: string }> {
  const resolved = presetForKey(model)?.id ?? model
  await loadLocalModel(resolved, { allowDownload: true, onStatus })
  const status = localModelStatus(resolved)
  return { model: resolved, ready: status.ready, path: status.path }
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value))
}

function softmaxPositive(logits: number[]): number {
  if (logits.length === 0) return 0
  const max = Math.max(...logits)
  const exps = logits.map((value) => Math.exp(value - max))
  const sum = exps.reduce((total, value) => total + value, 0)
  return sum === 0 ? 0 : (exps[1] ?? exps[0] ?? 0) / sum
}

function scoresFromLogits(logits: ArrayLike<number>, labels: number, count: number): number[] {
  const scores: number[] = []
  for (let index = 0; index < count; index += 1) {
    if (labels <= 1) {
      scores.push(sigmoid(Number(logits[index] ?? 0)))
    } else {
      const row = Array.from({ length: labels }, (_, label) =>
        Number(logits[index * labels + label] ?? 0),
      )
      scores.push(softmaxPositive(row))
    }
  }
  return scores
}

async function localScores(
  query: string,
  candidates: RerankCandidate[],
  model: string,
  options: { allowDownload: boolean; onStatus?: (message: string) => void },
): Promise<number[]> {
  const { tokenizer, classifier } = await loadLocalModel(model, options)
  const tok = tokenizer as {
    (text: string[], args: Record<string, unknown>): unknown
  }
  const modelObj = classifier as {
    (inputs: unknown): Promise<{ logits: { dims: number[]; data: ArrayLike<number> } }>
  }

  const queries = candidates.map(() => query)
  const documents = candidates.map((candidate) =>
    `${candidate.title}\n${candidate.summary}\n${candidate.text}`.slice(0, MAX_PAIR_CHARS),
  )
  const inputs = tok(queries, {
    text_pair: documents,
    padding: true,
    truncation: true,
    max_length: LOCAL_MAX_LENGTH,
  })
  const output = await modelObj(inputs)
  const labels = output.logits.dims[1] ?? 1
  return scoresFromLogits(output.logits.data, labels, candidates.length)
}

// ── LLM listwise ──────────────────────────────────────────────────────────

const LlmRerankSchema = z.object({
  scores: z
    .array(
      z.object({
        index: z.number().int().min(0),
        score: z.number().min(0).max(10),
      }),
    )
    .min(1),
})

async function llmScores(
  config: AxiomConfig,
  query: string,
  candidates: RerankCandidate[],
): Promise<number[]> {
  const { resolveModel } = await import('../agent/index.js')
  const prompt = [
    'You are reranking candidate wiki pages for a search query.',
    'Score each candidate from 0 (irrelevant) to 10 (directly answers the query).',
    'Use only the candidate text. Return one score for every index.',
    '',
    `Query: ${query}`,
    '',
    'Candidates:',
    ...candidates.map(
      (candidate, index) =>
        `[${index}] ${candidate.title}\nSummary: ${candidate.summary}\n${candidate.text.slice(0, 800)}`,
    ),
  ].join('\n')

  const { object } = await generateObject({
    model: resolveModel(config) as never,
    schema: LlmRerankSchema,
    temperature: 0,
    prompt,
  })

  const scores = candidates.map(() => 0)
  for (const entry of object.scores) {
    if (entry.index >= 0 && entry.index < scores.length) {
      scores[entry.index] = Math.max(scores[entry.index] ?? 0, entry.score)
    }
  }
  return scores
}

// ── Cohere ────────────────────────────────────────────────────────────────

interface CohereRerankResponse {
  results?: Array<{ index?: number; relevance_score?: number }>
  message?: string
}

async function cohereScores(
  query: string,
  candidates: RerankCandidate[],
  settings: { model: string; apiKey: string; topN: number },
): Promise<number[]> {
  if (!settings.apiKey) {
    throw new Error('Cohere reranking needs an API key. Add one in Settings or set COHERE_API_KEY.')
  }

  const response = await fetch('https://api.cohere.com/v2/rerank', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.model || COHERE_DEFAULT_MODEL,
      query,
      documents: candidates.map((candidate) =>
        `${candidate.title}\n${candidate.summary}\n${candidate.text}`.slice(0, 2000),
      ),
      top_n: Math.min(settings.topN, candidates.length),
    }),
  })

  const body = (await response.json().catch(() => ({}))) as CohereRerankResponse
  if (!response.ok) {
    throw new Error(
      `Cohere rerank failed (${response.status}): ${body.message ?? response.statusText}`,
    )
  }

  const scores = candidates.map(() => 0)
  for (const result of body.results ?? []) {
    const index = result.index ?? -1
    if (index >= 0 && index < scores.length) {
      scores[index] = Number(result.relevance_score ?? 0)
    }
  }
  return scores
}

// ── Public entry point ────────────────────────────────────────────────────

/** Stable sort by score, preserving the original order on ties. */
export function rankCandidates(
  candidates: RerankCandidate[],
  scores: number[],
): RerankCandidate[] {
  return candidates
    .map((candidate, index) => ({
      candidate,
      score: Number.isFinite(scores[index]) ? (scores[index] as number) : 0,
      index,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => ({ ...entry.candidate, score: entry.score }))
}

export async function rerankCandidates(
  config: AxiomConfig,
  query: string,
  candidates: RerankCandidate[],
  options: RerankRunOptions = {},
): Promise<RerankOutcome> {
  const settings: ResolvedRerank = { ...resolveRerankConfig(config), ...options }
  const started = Date.now()

  if (settings.provider === 'none' || candidates.length <= 1) {
    return {
      provider: settings.provider,
      model: settings.model,
      used: false,
      candidates,
      latencyMs: Date.now() - started,
    }
  }

  try {
    let scores: number[]
    if (settings.provider === 'local') {
      scores = await localScores(query, candidates, settings.model, {
        allowDownload: Boolean(options.allowDownload),
        onStatus: options.onStatus,
      })
    } else if (settings.provider === 'llm') {
      scores = await llmScores(config, query, candidates)
    } else {
      scores = await cohereScores(query, candidates, {
        model: settings.model,
        apiKey: settings.apiKey,
        topN: settings.topN,
      })
    }

    return {
      provider: settings.provider,
      model: settings.model,
      used: true,
      candidates: rankCandidates(candidates, scores),
      latencyMs: Date.now() - started,
    }
  } catch (err) {
    return {
      provider: settings.provider,
      model: settings.model,
      used: false,
      reason: err instanceof Error ? err.message : String(err),
      candidates,
      latencyMs: Date.now() - started,
    }
  }
}
