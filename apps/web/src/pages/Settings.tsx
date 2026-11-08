import { useEffect, useState, type ReactNode } from 'react'

import { api, runAction } from '../api'
import { useAsync, useJobStream, useTitle } from '../hooks'
import {
  Badge,
  ErrorPanel,
  LoadingPage,
  PageHeading,
  SectionLabel,
  Stat,
  Stats,
} from '../components/ui'
import { CheckIcon } from '../components/Icons'
import type { JobPayload, RerankTestResult } from '../types'

const PROVIDERS = [
  { value: 'local', label: 'Local cross-encoder', hint: 'On-device ONNX model. Private, no API key.' },
  { value: 'llm', label: 'Chat model (listwise)', hint: 'One extra call to the configured chat model. No download.' },
  { value: 'cohere', label: 'Cohere Rerank', hint: 'Hosted cross-encoder. Needs a Cohere API key.' },
  { value: 'none', label: 'Off', hint: 'Keep the hybrid search order.' },
] as const

export function Settings() {
  const { data, error, loading, reload } = useAsync((signal) => api.config(signal), [])
  const [reindexing, setReindexing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useTitle('Settings')

  const [provider, setProvider] = useState<'none' | 'local' | 'llm' | 'cohere'>('local')
  const [model, setModel] = useState('')
  const [topN, setTopN] = useState('6')
  const [candidates, setCandidates] = useState('24')
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testQuery, setTestQuery] = useState('what is this wiki about')
  const [testResult, setTestResult] = useState<RerankTestResult | null>(null)
  const [setupJobId, setSetupJobId] = useState<string | null>(null)
  const [rerankError, setRerankError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const setup = useJobStream(setupJobId)

  useEffect(() => {
    if (hydrated || !data?.rerank) return
    setProvider(data.rerank.provider)
    setModel(data.rerank.model)
    setTopN(String(data.rerank.topN))
    setCandidates(String(data.rerank.candidates))
    setHydrated(true)
  }, [data?.rerank, hydrated])

  useEffect(() => {
    if (setup.job?.status === 'succeeded') reload()
  }, [setup.job?.status, reload])

  async function reindex() {
    setReindexing(true)
    setNotice(null)
    try {
      await runAction<JobPayload>('embeddings/reindex', {})
      setNotice('Reindex queued. Watch the job tray for progress.')
      reload()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setReindexing(false)
    }
  }

  async function saveRerank() {
    if (!data) return
    setSaving(true)
    setNotice(null)
    setRerankError(null)
    try {
      const top = Number.parseInt(topN, 10)
      const count = Number.parseInt(candidates, 10)
      await api.saveSettings({
        provider,
        model: provider === 'local' || provider === 'cohere' ? model : undefined,
        topN: Number.isFinite(top) ? top : undefined,
        candidates: Number.isFinite(count) ? count : undefined,
        apiKey: provider === 'cohere' && apiKey ? apiKey : undefined,
        clearApiKey: provider === 'cohere' && clearApiKey,
      })
      setNotice('Reranker settings saved.')
      setApiKey('')
      setClearApiKey(false)
      setTestResult(null)
      reload()
    } catch (err) {
      setRerankError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function prepareModel() {
    setRerankError(null)
    setNotice(null)
    try {
      const { job } = await api.setupReranker(model || undefined)
      setSetupJobId(job.id)
      setNotice('Model download started. Watch the job tray.')
    } catch (err) {
      setRerankError(err instanceof Error ? err.message : String(err))
    }
  }

  async function testReranker() {
    setTesting(true)
    setRerankError(null)
    try {
      setTestResult(await api.testReranker(testQuery.trim() || 'wiki'))
    } catch (err) {
      setRerankError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  if (loading && !data) return <LoadingPage rows={4} />
  if (error && !data) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null

  const { embeddings, rerank } = data
  const semantic =
    embeddings.provider === 'none'
      ? 'disabled'
      : embeddings.consistency.consistent
        ? 'consistent'
        : 'needs attention'
  const presets = rerank.presets ?? []
  const preset = presets.find((entry) => entry.id === model)
  const selectedReady =
    provider === 'local' ? (rerank.localModels?.[model] ?? rerank.localReady) : rerank.localReady
  const setupRunning = setup.job?.status === 'running' || setup.job?.status === 'queued'

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Settings"
        title="Runtime configuration"
        description="Provider credentials and absolute paths stay on disk and are never exposed over the API. Reranker changes are written to the active config file."
        actions={<Badge tone={data.writeMode ? 'cyan' : 'default'}>{data.writeMode ? 'write enabled' : 'read-only'}</Badge>}
      />

      {notice ? (
        <div className="mb-5 border border-cyan/30 bg-cyan/5 px-4 py-3 font-mono text-[0.72rem] text-cyan">
          {notice}
        </div>
      ) : null}
      {rerankError ? <div className="mb-5"><ErrorPanel message={rerankError} /></div> : null}

      <Stats>
        <Stat label="Provider" value={<span className="font-mono text-sm">{data.provider}</span>} hint={data.model} />
        <Stat label="Wiki dir" value={<span className="font-mono text-sm">{data.wikiDir}</span>} hint="relative name only" />
        <Stat label="Raw dir" value={<span className="font-mono text-sm">{data.rawDir}</span>} hint="ingest inbox" />
        <Stat
          label="Semantic index"
          value={<span className="font-mono text-sm">{embeddings.provider}</span>}
          hint={semantic}
        />
      </Stats>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="border border-line bg-surface/30 p-4">
          <SectionLabel>Wiki conventions</SectionLabel>
          <dl className="mt-2 divide-y divide-line-soft font-mono text-[0.7rem]">
            <Row label="Obsidian compat" value={data.obsidianCompat ? 'bare [[links]]' : 'category/ links'} />
            <Row label="Forensic citations" value={data.forensicCitations ? 'enforced' : 'off'} />
            <Row label="Write mode" value={data.writeMode ? 'loopback actions enabled' : 'read-only'} />
          </dl>
        </section>

        <section className="border border-line bg-surface/30 p-4">
          <SectionLabel>Embeddings</SectionLabel>
          <dl className="mt-2 divide-y divide-line-soft font-mono text-[0.7rem]">
            <Row label="Provider" value={embeddings.provider} />
            <Row label="Model" value={embeddings.model ?? 'default'} />
            <Row label="Dimensions" value={embeddings.dimensions ? String(embeddings.dimensions) : 'auto'} />
            <Row
              label="Manifest"
              value={
                embeddings.manifest
                  ? `${embeddings.manifest.model} · ${embeddings.manifest.chunkCount ?? '?'} chunks`
                  : 'not built'
              }
            />
            <Row
              label="Consistency"
              value={
                embeddings.consistency.consistent
                  ? 'ok'
                  : `${embeddings.consistency.reason ?? 'unknown'}${embeddings.consistency.message ? ` — ${embeddings.consistency.message}` : ''}`
              }
            />
          </dl>
          <button
            type="button"
            onClick={() => void reindex()}
            disabled={!data.writeMode || embeddings.provider === 'none' || reindexing}
            className="mt-3 inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-ghost hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckIcon size={12} /> {reindexing ? 'Queueing…' : 'Rebuild semantic index'}
          </button>
        </section>
      </div>

      <section className="mt-4 border border-line bg-surface/30 p-4" aria-labelledby="reranker-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionLabel>Reranker</SectionLabel>
            <h2 id="reranker-heading" className="font-display text-sm font-semibold text-ghost">
              Precision pass before the evidence block
            </h2>
            <p className="mt-1 max-w-[72ch] text-[0.8rem] leading-relaxed text-graphite">
              Hybrid search finds candidates; the reranker rescores each query/page pair and keeps
              the best few before graph expansion. The default is a local ONNX cross-encoder, so
              nothing leaves the machine.
            </p>
          </div>
          <Badge tone={rerank.provider !== 'none' ? 'cyan' : 'default'}>
            {rerank.provider === 'none' ? 'off' : rerank.provider}
          </Badge>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <Field label="Provider">
              <select
                value={provider}
                onChange={(event) => {
                  const next = event.target.value as typeof provider
                  setProvider(next)
                  if (next === 'cohere' && !model.startsWith('rerank-')) {
                    setModel('rerank-v3.5')
                  } else if (
                    next === 'local' &&
                    !presets.some((entry) => entry.id === model)
                  ) {
                    setModel(presets.find((entry) => entry.key === 'balanced')?.id ?? '')
                  }
                }}
                className="field w-full font-mono text-[0.72rem]"
              >
                {PROVIDERS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[0.72rem] leading-relaxed text-graphite">
                {PROVIDERS.find((entry) => entry.value === provider)?.hint}
              </p>
            </Field>

            {provider === 'local' ? (
              <Field label="Local model">
                <select
                  value={preset?.id ?? '__custom'}
                  onChange={(event) => {
                    if (event.target.value === '__custom') setModel('')
                    else setModel(event.target.value)
                  }}
                  className="field w-full font-mono text-[0.72rem]"
                >
                  {presets.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label} · {entry.sizeMb} MB · {entry.languages} ·{' '}
                      {rerank.localModels?.[entry.id] ? 'cached' : 'not downloaded'}
                    </option>
                  ))}
                  <option value="__custom">Custom model…</option>
                </select>
                {!preset ? (
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="org/model (Transformers.js ONNX)"
                    className="field mt-2 w-full font-mono text-[0.72rem]"
                  />
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void prepareModel()}
                    disabled={!data.writeMode || setupRunning || !model}
                    className="border border-line bg-surface px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-graphite hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {setupRunning ? 'Preparing…' : 'Download / prepare model'}
                  </button>
                  <span className="font-mono text-[0.62rem] text-graphite">
                    {selectedReady ? 'cached' : 'not downloaded'}
                  </span>
                </div>
              </Field>
            ) : null}

            {provider === 'cohere' ? (
              <>
                <Field label="Cohere model">
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="rerank-v3.5"
                    className="field w-full font-mono text-[0.72rem]"
                  />
                </Field>
                <Field label="Cohere API key">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={rerank.hasApiKey ? '•••••• saved — enter to replace' : 'COHERE_API_KEY'}
                    className="field w-full font-mono text-[0.72rem]"
                  />
                  <label className="mt-2 inline-flex items-center gap-2 font-mono text-[0.62rem] text-graphite">
                    <input
                      type="checkbox"
                      checked={clearApiKey}
                      onChange={(event) => setClearApiKey(event.target.checked)}
                    />
                    clear the saved key
                  </label>
                </Field>
              </>
            ) : null}

            {provider === 'llm' ? (
              <p className="border border-line-soft bg-surface-2 px-3 py-2 font-mono text-[0.66rem] leading-relaxed text-graphite">
                Uses {data.provider}/{data.model}. One listwise call per query; no model download.
              </p>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Keep (top N)">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={topN}
                  onChange={(event) => setTopN(event.target.value)}
                  className="field w-full font-mono text-[0.72rem]"
                />
              </Field>
              <Field label="Candidates">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={candidates}
                  onChange={(event) => setCandidates(event.target.value)}
                  className="field w-full font-mono text-[0.72rem]"
                />
              </Field>
            </div>
            <p className="text-[0.72rem] leading-relaxed text-graphite">
              Pull {candidates || '…'} candidates from hybrid search, rerank them, and keep{' '}
              {topN || '…'} for the evidence block. More candidates cost a little more time; the
              cross-encoder is batched.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveRerank()}
                disabled={!data.writeMode || saving}
                className="inline-flex items-center gap-1.5 border border-cyan/40 bg-cyan/10 px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-cyan disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckIcon size={12} /> {saving ? 'Saving…' : 'Save reranker'}
              </button>
              <button
                type="button"
                onClick={() => void testReranker()}
                disabled={testing}
                className="border border-line bg-surface px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-graphite hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
              >
                {testing ? 'Testing…' : 'Test reranker'}
              </button>
            </div>
            <Field label="Test query">
              <input
                value={testQuery}
                onChange={(event) => setTestQuery(event.target.value)}
                className="field w-full font-mono text-[0.72rem]"
              />
            </Field>
          </div>
        </div>

        {!data.writeMode ? (
          <p className="mt-3 border border-amber/30 bg-amber/5 px-3 py-2 font-mono text-[0.66rem] text-amber">
            Restart with <code>axiom-wiki serve --allow-write</code> to save settings or download a
            model.
          </p>
        ) : null}

        {setup.lines.length > 0 ? (
          <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-line pt-3 font-mono text-[0.64rem] leading-relaxed text-graphite">
            {setup.lines.join('\n')}
          </pre>
        ) : null}

        {testResult ? (
          <div className="mt-4 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={testResult.used ? 'cyan' : 'amber'}>
                {testResult.used ? 'reranked' : 'fallback'}
              </Badge>
              <span className="font-mono text-[0.64rem] text-graphite">
                {testResult.provider}
                {testResult.model ? ` · ${testResult.model}` : ''} · {testResult.latencyMs} ms
              </span>
            </div>
            {!testResult.used && testResult.reason ? (
              <p className="mt-2 font-mono text-[0.66rem] text-amber">{testResult.reason}</p>
            ) : null}
            <ol className="mt-2 divide-y divide-line-soft">
              {testResult.results.map((result, index) => (
                <li key={result.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="font-mono text-[0.66rem] text-graphite">
                    {index + 1}. <span className="text-ghost">{result.title}</span>{' '}
                    <span className="opacity-60">{result.id}</span>
                  </span>
                  <span className="font-mono text-[0.66rem] text-cyan">
                    {(result.score ?? 0).toFixed(3)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>

      <section className="mt-4 border border-line bg-surface/30 p-4">
        <SectionLabel>API</SectionLabel>
        <p className="text-[0.8rem] leading-relaxed text-graphite">
          The web app is a client of the same endpoints available to scripts:{' '}
          <code className="font-mono text-cyan">/api/v1/overview</code>,{' '}
          <code className="font-mono text-cyan">/pages</code>,{' '}
          <code className="font-mono text-cyan">/graph</code>,{' '}
          <code className="font-mono text-cyan">/sources</code>,{' '}
          <code className="font-mono text-cyan">/integrity</code>, and{' '}
          <code className="font-mono text-cyan">/actions/*</code>. Mutations require{' '}
          <code className="font-mono text-cyan">--allow-write</code> and the{' '}
          <code className="font-mono text-cyan">X-Axiom-Write: 1</code> header.
        </p>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block font-mono text-[0.6rem] uppercase tracking-[0.12em] text-graphite">
        {label}
      </label>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-graphite">{label}</dt>
      <dd className="text-right text-ghost">{value}</dd>
    </div>
  )
}
