import { useState } from 'react'

import { api, runAction } from '../api'
import { useAsync, useTitle } from '../hooks'
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
import type { JobPayload } from '../types'

export function Settings() {
  const { data, error, loading, reload } = useAsync((signal) => api.config(signal), [])
  const [reindexing, setReindexing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useTitle('Settings')

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

  if (loading && !data) return <LoadingPage rows={4} />
  if (error && !data) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null

  const { embeddings } = data
  const semantic =
    embeddings.provider === 'none'
      ? 'disabled'
      : embeddings.consistency.consistent
        ? 'consistent'
        : 'needs attention'

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Settings"
        title="Runtime configuration"
        description="Read-only view of the configuration the server loaded. Provider credentials and absolute paths stay on disk and are never exposed over the API."
        actions={<Badge tone={data.writeMode ? 'cyan' : 'default'}>{data.writeMode ? 'write enabled' : 'read-only'}</Badge>}
      />

      {notice ? (
        <div className="mb-5 border border-cyan/30 bg-cyan/5 px-4 py-3 font-mono text-[0.72rem] text-cyan">
          {notice}
        </div>
      ) : null}

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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-graphite">{label}</dt>
      <dd className="text-right text-ghost">{value}</dd>
    </div>
  )
}
