import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  DEFAULT_RERANK_MODEL,
  describeRerankConfig,
  localModelStatus,
  rankCandidates,
  rerankCandidates,
  resolveRerankConfig,
  type RerankCandidate,
} from '../../src/core/rerank.js'
import type { AxiomConfig } from '../../src/config/index.js'

function baseConfig(): AxiomConfig {
  return {
    wikiDir: '/tmp/wiki',
    rawDir: '/tmp/raw',
    provider: 'openai',
    apiKey: 'test',
    model: 'gpt-4o-mini',
  } as unknown as AxiomConfig
}

function candidate(id: string, title: string): RerankCandidate {
  return { id, title, summary: `${title} summary`, text: `${title} body` }
}

describe('rerank config', () => {
  const previousKey = process.env.COHERE_API_KEY

  afterEach(() => {
    if (previousKey === undefined) delete process.env.COHERE_API_KEY
    else process.env.COHERE_API_KEY = previousKey
  })

  it('defaults to the balanced local model', () => {
    const resolved = resolveRerankConfig(baseConfig())
    expect(resolved.provider).toBe('local')
    expect(resolved.model).toBe(DEFAULT_RERANK_MODEL)
    expect(resolved.model).toBe('Xenova/bge-reranker-base')
    expect(resolved.topN).toBe(6)
    expect(resolved.candidates).toBe(24)
  })

  it('maps preset keys to model ids', () => {
    const config = { ...baseConfig(), rerank: { provider: 'local' as const, model: 'fast' } }
    expect(resolveRerankConfig(config).model).toBe('Xenova/ms-marco-MiniLM-L-6-v2')
  })

  it('clamps topN and candidates', () => {
    const config = {
      ...baseConfig(),
      rerank: { provider: 'local' as const, topN: 0, candidates: 999 },
    }
    const resolved = resolveRerankConfig(config)
    expect(resolved.topN).toBe(1)
    expect(resolved.candidates).toBe(100)

    const tooFew = { ...baseConfig(), rerank: { provider: 'local' as const, topN: 10, candidates: 2 } }
    expect(resolveRerankConfig(tooFew).candidates).toBe(10)
  })

  it('knows the Cohere defaults and env key', () => {
    process.env.COHERE_API_KEY = 'env-key'
    const resolved = resolveRerankConfig({
      ...baseConfig(),
      rerank: { provider: 'cohere' },
    })
    expect(resolved.model).toBe('rerank-v3.5')
    expect(resolved.apiKey).toBe('env-key')
  })

  it('can be disabled', () => {
    const resolved = resolveRerankConfig({ ...baseConfig(), rerank: { provider: 'none' } })
    expect(resolved.provider).toBe('none')
    expect(resolved.model).toBe('')
  })

  it('describes settings without leaking the key', () => {
    const described = describeRerankConfig({
      ...baseConfig(),
      rerank: { provider: 'cohere', apiKey: 'secret-key' },
    })
    expect(described.hasApiKey).toBe(true)
    expect(Object.keys(described)).not.toContain('apiKey')
    expect(JSON.stringify(described)).not.toContain('secret-key')
    expect(described.presets.map((preset) => preset.key)).toEqual([
      'fast',
      'balanced',
      'multilingual',
    ])
  })
})

describe('local model cache status', () => {
  let modelsDir: string
  const previous = process.env.AXIOM_MODELS_DIR

  beforeEach(() => {
    modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-models-'))
    process.env.AXIOM_MODELS_DIR = modelsDir
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.AXIOM_MODELS_DIR
    else process.env.AXIOM_MODELS_DIR = previous
    fs.rmSync(modelsDir, { recursive: true, force: true })
  })

  it('finds a cached quantized model', () => {
    const dir = path.join(modelsDir, 'org', 'model', 'onnx')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'model_quantized.onnx'), 'bytes')
    expect(localModelStatus('org/model')).toMatchObject({ ready: true })
  })

  it('reports a missing model', () => {
    expect(localModelStatus('org/missing')).toMatchObject({ ready: false })
  })
})

describe('ranking', () => {
  it('sorts by score and keeps the original order on ties', () => {
    const ranked = rankCandidates(
      [candidate('a', 'Alpha'), candidate('b', 'Beta'), candidate('c', 'Gamma')],
      [0.2, 0.9, 0.9],
    )
    expect(ranked.map((entry) => entry.id)).toEqual(['b', 'c', 'a'])
    expect(ranked[0]?.score).toBe(0.9)
  })

  it('defaults missing scores to zero', () => {
    const ranked = rankCandidates([candidate('a', 'Alpha'), candidate('b', 'Beta')], [0.5])
    expect(ranked.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(ranked[1]?.score).toBe(0)
  })
})

describe('rerank providers', () => {
  const previousModelsDir = process.env.AXIOM_MODELS_DIR
  let modelsDir: string

  beforeEach(() => {
    modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-rerank-models-'))
    process.env.AXIOM_MODELS_DIR = modelsDir
  })

  afterEach(() => {
    if (previousModelsDir === undefined) delete process.env.AXIOM_MODELS_DIR
    else process.env.AXIOM_MODELS_DIR = previousModelsDir
    fs.rmSync(modelsDir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('does nothing when the provider is none', async () => {
    const candidates = [candidate('a', 'Alpha'), candidate('b', 'Beta')]
    const outcome = await rerankCandidates(
      { ...baseConfig(), rerank: { provider: 'none' } },
      'alpha',
      candidates,
    )
    expect(outcome.used).toBe(false)
    expect(outcome.candidates.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('falls back with a reason when the local model is not downloaded', async () => {
    const outcome = await rerankCandidates(
      { ...baseConfig(), rerank: { provider: 'local', model: 'org/not-cached' } },
      'alpha',
      [candidate('a', 'Alpha'), candidate('b', 'Beta')],
      { allowDownload: false },
    )
    expect(outcome.used).toBe(false)
    expect(outcome.reason).toMatch(/not downloaded/)
    expect(outcome.candidates.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('maps Cohere results back to candidates', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.93 },
            { index: 0, relevance_score: 0.12 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const outcome = await rerankCandidates(
      {
        ...baseConfig(),
        rerank: { provider: 'cohere', apiKey: 'cohere-key', model: 'rerank-v3.5' },
      },
      'which idea matters',
      [candidate('a', 'Alpha'), candidate('b', 'Beta')],
    )

    expect(outcome.used).toBe(true)
    expect(outcome.candidates.map((entry) => entry.id)).toEqual(['b', 'a'])
    expect(outcome.candidates[0]?.score).toBe(0.93)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.cohere.com/v2/rerank')
    const body = JSON.parse(String(init.body)) as { model: string; top_n: number }
    expect(body.model).toBe('rerank-v3.5')
    expect(body.top_n).toBe(2)
  })

  it('surfaces a Cohere error without dropping the candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'invalid api key' }), { status: 401 }),
      ),
    )
    const outcome = await rerankCandidates(
      { ...baseConfig(), rerank: { provider: 'cohere', apiKey: 'bad' } },
      'alpha',
      [candidate('a', 'Alpha'), candidate('b', 'Beta')],
    )
    expect(outcome.used).toBe(false)
    expect(outcome.reason).toMatch(/invalid api key/)
  })
})
