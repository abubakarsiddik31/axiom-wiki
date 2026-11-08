import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api, runAction } from '../api'
import { useAsync, useTitle } from '../hooks'
import { formatDate, pluralize } from '../format'
import {
  Badge,
  EmptyState,
  ErrorPanel,
  LoadingPage,
  PageHeading,
  SectionLabel,
  Stat,
  Stats,
} from '../components/ui'
import { ArrowRightIcon, CheckIcon, UploadIcon } from '../components/Icons'
import type { JobPayload, SourceRecord } from '../types'

type Notice = { tone: 'ok' | 'error'; text: string } | null

export function Sources() {
  const [url, setUrl] = useState('')
  const [file, setFile] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const [watchBusy, setWatchBusy] = useState(false)
  const { data, error, loading, reload } = useAsync((signal) => api.sources(signal), [])
  const config = useAsync((signal) => api.config(signal), [])
  const watch = useAsync((signal) => api.watch(signal), [])
  useTitle('Sources')

  const writeMode = config.data?.writeMode ?? false
  const watching = watch.data?.running ?? false

  async function toggleWatch() {
    setWatchBusy(true)
    setNotice(null)
    try {
      if (watching) await api.stopWatch()
      else await api.startWatch()
      watch.reload()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setWatchBusy(false)
    }
  }

  async function mutate(action: string, body: unknown, success: string) {
    setBusy(action)
    setNotice(null)
    try {
      const result = await runAction<JobPayload | { filename?: string }>(action, body)
      setNotice({
        tone: 'ok',
        text: 'job' in result ? `${success} — queued as a background job.` : success,
      })
      setPendingDelete(null)
      setUrl('')
      setFile('')
      reload()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  if (loading && !data) return <LoadingPage rows={7} />
  if (error && !data) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null

  const { sources, rawFiles, lock } = data
  const uningested = rawFiles.filter(
    (name) => !sources.some((source) => source.filename === name),
  )

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Sources"
        title="Raw material & compilation"
        description="Ingest from raw/, clip a URL, and manage what has already been compiled. Every action runs through the same core functions as the CLI and holds the compilation lock."
        actions={
          <Badge tone={writeMode ? 'cyan' : 'default'}>
            {writeMode ? 'write enabled' : 'read-only'}
          </Badge>
        }
      />

      {!writeMode ? (
        <div className="mb-5 border border-amber/30 bg-amber/5 px-4 py-3 text-[0.82rem] leading-relaxed text-graphite">
          Actions are disabled. Restart the server with{' '}
          <code className="font-mono text-cyan">axiom-wiki serve --allow-write</code> to ingest,
          clip, and manage sources from the browser.
        </div>
      ) : null}

      {lock.locked ? (
        <div className="mb-5 border border-amber/30 bg-amber/5 px-4 py-3 font-mono text-[0.72rem] text-amber">
          Compilation lock held{lock.info ? ` by pid ${lock.info.pid}` : ''}
          {lock.info ? ` since ${lock.info.acquiredAt}` : ''}.
        </div>
      ) : null}

      {notice ? (
        <div
          className={`mb-5 border px-4 py-3 font-mono text-[0.72rem] ${
            notice.tone === 'ok'
              ? 'border-cyan/30 bg-cyan/5 text-cyan'
              : 'border-danger/30 bg-danger/5 text-danger'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-line bg-surface/30 px-4 py-3">
        <div className="min-w-0">
          <div className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-graphite">
            watch raw/
          </div>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-graphite">
            {watching
              ? 'Watching for dropped files — each one is clipped into the wiki automatically.'
              : 'Start a watcher to auto-ingest files dropped into raw/ (Obsidian Web Clipper, downloads, screenshots).'}
          </p>
          {watch.data?.lastEvent ? (
            <p className="mt-1 font-mono text-[0.6rem] text-graphite">
              last: {watch.data.lastEvent.file} · {watch.data.lastEvent.at.slice(11, 19)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void toggleWatch()}
          disabled={!writeMode || watchBusy}
          className={`inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] disabled:cursor-not-allowed disabled:opacity-40 ${
            watching
              ? 'border-amber/40 bg-amber/10 text-amber'
              : 'border-line bg-surface text-graphite hover:border-cyan hover:text-cyan'
          }`}
        >
          {watchBusy ? '…' : watching ? 'Stop watching' : 'Watch raw/'}
        </button>
      </div>

      <Stats>
        <Stat label="Compiled sources" value={sources.length} hint="in wiki/log.md" />
        <Stat label="Files in raw/" value={rawFiles.length} hint={`${uningested.length} new`} />
        <Stat
          label="Lock"
          value={<span className="font-mono text-sm">{lock.locked ? 'busy' : 'free'}</span>}
          hint={lock.info ? `pid ${lock.info.pid}` : 'ready for work'}
        />
        <Stat
          label="Write mode"
          value={<span className="font-mono text-sm">{writeMode ? 'on' : 'off'}</span>}
          hint="loopback only"
        />
      </Stats>

      <div className="mb-7 grid gap-4 lg:grid-cols-2">
        <section className="border border-line bg-surface/30 p-4" aria-labelledby="clip-heading">
          <SectionLabel>Clip a URL</SectionLabel>
          <h2 id="clip-heading" className="font-display text-sm font-semibold text-ghost">
            Article, PDF, or YouTube
          </h2>
          <p className="mt-1 text-[0.78rem] leading-relaxed text-graphite">
            Saves to <code className="font-mono text-cyan">raw/</code> then compiles it into the wiki.
          </p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!url.trim() || !writeMode) return
              void mutate('clip', { url: url.trim(), ingest: true }, 'URL queued for clipping')
            }}
          >
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/article"
              className="field min-w-0 flex-1"
              disabled={!writeMode || busy !== null}
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 border border-cyan/40 bg-cyan/10 px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-cyan disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!writeMode || busy !== null || !url.trim()}
            >
              Clip <ArrowRightIcon size={12} />
            </button>
          </form>
        </section>

        <section className="border border-line bg-surface/30 p-4" aria-labelledby="file-heading">
          <SectionLabel>Compile from raw/</SectionLabel>
          <h2 id="file-heading" className="font-display text-sm font-semibold text-ghost">
            Pick a file or scan everything new
          </h2>
          <p className="mt-1 text-[0.78rem] leading-relaxed text-graphite">
            Web ingest only reads files inside <code className="font-mono text-cyan">raw/</code>.
          </p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!file || !writeMode) return
              void mutate('ingest', { file, reingest: true }, `Queued ${file}`)
            }}
          >
            <select
              value={file}
              onChange={(event) => setFile(event.target.value)}
              className="field min-w-0 flex-1"
              disabled={!writeMode || busy !== null}
            >
              <option value="">Select a file…</option>
              {rawFiles.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-ghost hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!writeMode || busy !== null || !file}
            >
              <UploadIcon size={12} /> Ingest
            </button>
          </form>
          <button
            type="button"
            onClick={() => void mutate('ingest', { all: true }, 'Incremental scan queued')}
            className="mt-2 inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-graphite hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!writeMode || busy !== null}
          >
            <CheckIcon size={12} /> Ingest all new
          </button>
          <Link
            to="/import"
            className="mt-2 inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-cyan hover:border-cyan"
          >
            <UploadIcon size={12} /> Bulk import a folder or URL list <ArrowRightIcon size={12} />
          </Link>
        </section>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <SectionLabel>{pluralize(sources.length, 'source')} compiled</SectionLabel>
        {busy ? (
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-cyan">
            {busy}…
          </span>
        ) : null}
      </div>

      {sources.length === 0 ? (
        <EmptyState title="Nothing ingested yet">
          Drop a file into <code className="font-mono text-cyan">raw/</code> or clip a URL above,
          then run an ingest.
        </EmptyState>
      ) : (
        <div className="border border-line">
          <div className="hidden grid-cols-[minmax(0,1fr)_110px_90px_210px] gap-4 border-b border-line bg-surface/50 px-4 py-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-graphite md:grid">
            <span>File</span>
            <span>Ingested</span>
            <span>Pages</span>
            <span className="text-right">Actions</span>
          </div>
          <ul className="divide-y divide-line-soft">
            {sources.map((source) => (
              <SourceRow
                key={source.filename}
                source={source}
                writeMode={writeMode}
                busy={busy}
                pendingDelete={pendingDelete}
                onDelete={() => setPendingDelete(source.filename)}
                onCancelDelete={() => setPendingDelete(null)}
                onConfirmDelete={() =>
                  void mutate('sources/delete', { filename: source.filename }, `Removed ${source.filename}`)
                }
                onReingest={() =>
                  void mutate(
                    'ingest',
                    { file: source.filename, reingest: true },
                    `Re-ingest queued for ${source.filename}`,
                  )
                }
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SourceRow({
  source,
  writeMode,
  busy,
  pendingDelete,
  onDelete,
  onCancelDelete,
  onConfirmDelete,
  onReingest,
}: {
  source: SourceRecord
  writeMode: boolean
  busy: string | null
  pendingDelete: string | null
  onDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onReingest: () => void
}) {
  const confirming = pendingDelete === source.filename
  return (
    <li className="grid gap-1 px-4 py-2.5 md:grid-cols-[minmax(0,1fr)_110px_90px_210px] md:items-center md:gap-4">
      <span className="min-w-0">
        <span className="block truncate font-mono text-[0.78rem] text-ghost" title={source.filename}>
          {source.filename}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[0.6rem] text-graphite">
          {source.summaryPage || 'no summary page'} · {source.sha256 ? source.sha256.slice(0, 12) : 'no hash'}
        </span>
      </span>
      <span className="font-mono text-[0.64rem] text-graphite">{formatDate(source.lastIngestedAt)}</span>
      <span className="font-mono text-[0.64rem] text-graphite">{source.pageCount}</span>
      <span className="flex flex-wrap justify-start gap-1.5 md:justify-end">
        {confirming ? (
          <>
            <button
              type="button"
              onClick={onConfirmDelete}
              className="border border-danger/40 bg-danger/10 px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-danger"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="border border-line px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-graphite hover:text-ghost"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onReingest}
              disabled={!writeMode || busy !== null}
              className="border border-line px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-graphite hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              Re-ingest
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={!writeMode || busy !== null}
              className="border border-line px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-graphite hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete
            </button>
          </>
        )}
      </span>
    </li>
  )
}
