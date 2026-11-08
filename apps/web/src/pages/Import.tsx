import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api'
import { useAsync, useJobStream, useTitle } from '../hooks'
import { formatBytes } from '../format'
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
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  DatabaseIcon,
  UploadIcon,
} from '../components/Icons'
import type {
  ImportItem,
  ImportItemStatus,
  ImportPlan,
  ImportRequest,
  ImportRunResult,
} from '../types'

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

const STATUS_TONE: Record<ImportItemStatus, string> = {
  ready: 'border-cyan/40 bg-cyan/10 text-cyan',
  duplicate: 'border-line bg-surface text-graphite',
  unsupported: 'border-amber/40 bg-amber/10 text-amber',
  invalid: 'border-danger/40 bg-danger/10 text-danger',
}

function StatusPill({ status }: { status: ImportItemStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center border px-1.5 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.08em] ${STATUS_TONE[status]}`}
    >
      {status}
    </span>
  )
}

function itemLabel(item: ImportItem): string {
  if (item.kind === 'file') return item.relative ?? item.label
  return item.source
}

function ItemRow({ item }: { item: ImportItem }) {
  const target = item.kind === 'file' ? `raw/${item.target}` : ''
  return (
    <li className="grid gap-1.5 px-4 py-2.5 md:grid-cols-[24px_minmax(0,1fr)_100px_minmax(0,200px)] md:items-center md:gap-4">
      <span className="hidden font-mono text-[0.7rem] text-graphite md:block">
        {item.kind === 'file' ? 'F' : 'U'}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[0.8rem] text-ghost" title={item.source}>
          {itemLabel(item)}
        </p>
        {item.reason ? (
          <p className="mt-0.5 truncate font-mono text-[0.6rem] text-graphite/80">{item.reason}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 md:justify-start">
        <StatusPill status={item.status} />
        {item.kind === 'file' ? (
          <span className="font-mono text-[0.58rem] text-graphite/70">
            {formatBytes(item.bytes)}
          </span>
        ) : null}
      </div>
      <span className="hidden truncate font-mono text-[0.6rem] text-graphite/70 md:block" title={target}>
        {target}
      </span>
    </li>
  )
}

export function Import() {
  useTitle('Import')
  const config = useAsync((signal) => api.config(signal), [])

  const [pathsText, setPathsText] = useState('')
  const [urlsText, setUrlsText] = useState('')
  const [fromText, setFromText] = useState('')
  const [includeMedia, setIncludeMedia] = useState(false)
  const [ingestAfter, setIngestAfter] = useState(true)
  const [urlLimit, setUrlLimit] = useState(200)

  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const settled = useRef<string | null>(null)
  const { job, lines } = useJobStream(jobId)
  const writeMode = config.data?.writeMode ?? false
  const running = job?.status === 'running' || job?.status === 'queued'
  const result =
    job?.status === 'succeeded' && job.result ? (job.result as ImportRunResult) : null

  useEffect(() => {
    if (!job) return
    if (job.status !== 'succeeded' && job.status !== 'failed' && job.status !== 'cancelled') return
    if (settled.current === job.id) return
    settled.current = job.id
    if (job.status === 'failed' && job.error) setError(job.error)
    if (job.status === 'succeeded') {
      const summary = (job.result as ImportRunResult | null)?.summary
      if (summary) setNotice(summary)
    }
  }, [job])

  function request(): ImportRequest {
    return {
      paths: splitLines(pathsText),
      urls: splitLines(urlsText),
      from: splitLines(fromText),
      includeMedia,
      urlLimit,
    }
  }

  function hasInput(): boolean {
    const value = request()
    return (value.paths?.length ?? 0) + (value.urls?.length ?? 0) + (value.from?.length ?? 0) > 0
  }

  async function preview() {
    if (!hasInput()) return
    setPlanning(true)
    setError(null)
    setNotice(null)
    try {
      const response = await api.importPlan(request())
      setPlan(response.plan)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPlanning(false)
    }
  }

  async function start() {
    if (!hasInput() || running) return
    setError(null)
    setNotice(null)
    try {
      const response = await api.runImport({ ...request(), ingest: ingestAfter })
      setJobId(response.job.id)
      settled.current = null
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (config.loading && !config.data) return <LoadingPage rows={5} />
  if (config.error && !config.data) return <ErrorPanel message={config.error} onRetry={config.reload} />

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Import"
        title="Bring a library in"
        description="Point Axiom at a folder, a pile of files, or a bookmarks export. It plans first, tells you what it will skip, then copies everything into raw/ and compiles it through the same pipeline as a single ingest."
        actions={
          <Badge tone={writeMode ? 'cyan' : 'default'}>
            {writeMode ? 'write enabled' : 'read-only'}
          </Badge>
        }
      />

      {!writeMode ? (
        <div className="mb-5 border border-amber/30 bg-amber/5 px-4 py-3 text-[0.82rem] leading-relaxed text-graphite">
          Import is disabled. Restart with{' '}
          <code className="font-mono text-cyan">axiom-wiki serve --allow-write</code> to stage sources
          from the browser, or use{' '}
          <code className="font-mono text-cyan">axiom-wiki import</code> in a terminal.
        </div>
      ) : null}

      {error ? (
        <div className="mb-5">
          <ErrorPanel message={error} onRetry={() => setError(null)} />
        </div>
      ) : null}

      {notice ? (
        <div className="mb-5 border border-cyan/30 bg-cyan/5 px-4 py-2.5 font-mono text-[0.7rem] text-cyan">
          {notice}
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 md:grid-cols-2">
        <section className="border border-line bg-surface/30 p-4" aria-labelledby="import-files">
          <SectionLabel>Files & folders</SectionLabel>
          <h2 id="import-files" className="font-display text-sm font-semibold text-ghost">
            One path per line
          </h2>
          <p className="mt-1 text-[0.78rem] leading-relaxed text-graphite">
            Folders are walked recursively. Paths are resolved on the machine running{' '}
            <code className="font-mono text-cyan">serve</code>, not in the browser.
          </p>
          <textarea
            value={pathsText}
            onChange={(event) => setPathsText(event.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={'~/Documents/notes\n~/Downloads/papers\n/some/where/note.md'}
            className="field mt-3 resize-y font-mono text-[0.74rem] leading-relaxed"
            disabled={!writeMode || running}
          />
        </section>

        <section className="border border-line bg-surface/30 p-4" aria-labelledby="import-urls">
          <SectionLabel>URLs & lists</SectionLabel>
          <h2 id="import-urls" className="font-display text-sm font-semibold text-ghost">
            Clip articles, PDFs, and videos
          </h2>
          <p className="mt-1 text-[0.78rem] leading-relaxed text-graphite">
            Paste links one per line, or name a bookmarks <code className="font-mono">.html</code>,
            Readwise <code className="font-mono">.csv</code>, JSON export, or a plain URL list.
          </p>
          <textarea
            value={urlsText}
            onChange={(event) => setUrlsText(event.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={'https://example.com/article\nhttps://example.com/paper.pdf'}
            className="field mt-3 resize-y font-mono text-[0.74rem] leading-relaxed"
            disabled={!writeMode || running}
          />
          <label className="mt-2 block">
            <span className="font-mono text-[0.58rem] uppercase tracking-[0.1em] text-graphite">
              URL list file
            </span>
            <input
              value={fromText}
              onChange={(event) => setFromText(event.target.value)}
              placeholder="/path/to/bookmarks.html"
              spellCheck={false}
              className="field mt-1 font-mono text-[0.74rem]"
              disabled={!writeMode || running}
            />
          </label>
        </section>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-line bg-surface/20 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.66rem] uppercase tracking-[0.08em] text-graphite">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={includeMedia}
              onChange={(event) => setIncludeMedia(event.target.checked)}
              disabled={!writeMode || running}
              className="accent-cyan"
            />
            PDFs & images in folders
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={ingestAfter}
              onChange={(event) => setIngestAfter(event.target.checked)}
              disabled={!writeMode || running}
              className="accent-cyan"
            />
            compile after import
          </label>
          <label className="inline-flex items-center gap-2">
            url limit
            <input
              type="number"
              min={1}
              max={5000}
              value={urlLimit}
              onChange={(event) => setUrlLimit(Number.parseInt(event.target.value, 10) || 200)}
              disabled={!writeMode || running}
              className="field w-20 py-0.5 font-mono text-[0.68rem]"
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void preview()}
            disabled={!writeMode || running || planning || !hasInput()}
            className="inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ghost hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
          >
            <DatabaseIcon size={12} /> {planning ? 'planning…' : 'Preview plan'}
          </button>
          <button
            type="button"
            onClick={() => void start()}
            disabled={!writeMode || running || !hasInput()}
            className="inline-flex items-center gap-1.5 border border-cyan/40 bg-cyan/10 px-3 py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.1em] text-cyan hover:bg-cyan/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? 'importing…' : 'Import'} <UploadIcon size={12} />
          </button>
        </div>
      </div>

      {plan ? (
        <div className="mb-5">
          <Stats>
            <Stat label="Ready" value={plan.ready} hint={formatBytes(plan.totalBytes)} />
            <Stat label="Duplicates" value={plan.duplicates} hint="already in raw/" />
            <Stat label="Skipped" value={plan.unsupported + plan.invalid} hint="unsupported or invalid" />
            <Stat
              label="Found"
              value={plan.fileCount + plan.urlCount}
              hint={`${plan.fileCount} files · ${plan.urlCount} urls`}
            />
          </Stats>

          {plan.truncatedUrls > 0 ? (
            <p className="mb-3 font-mono text-[0.66rem] text-amber">
              {plan.truncatedUrls} more URL{plan.truncatedUrls === 1 ? '' : 's'} beyond the limit —
              raise the URL limit to include them.
            </p>
          ) : null}

          {plan.items.length === 0 ? (
            <EmptyState title="Nothing found">
              The paths and links produced no supported sources.
            </EmptyState>
          ) : (
            <div className="border border-line">
              <div className="hidden grid-cols-[24px_minmax(0,1fr)_100px_minmax(0,200px)] gap-4 border-b border-line bg-surface/50 px-4 py-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-graphite md:grid">
                <span />
                <span>Source</span>
                <span>Status</span>
                <span>Goes to</span>
              </div>
              <ul className="max-h-[520px] divide-y divide-line-soft overflow-y-auto">
                {plan.items.map((item, index) => (
                  <ItemRow key={`${item.kind}:${item.source}:${index}`} item={item} />
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {jobId ? (
        <div className="mb-5 border border-line bg-surface/20">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-graphite">
              {running ? 'import running' : job?.status ?? 'queued'}
            </span>
            {running ? (
              <span className="inline-flex items-center gap-1 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-cyan">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
                live
              </span>
            ) : null}
          </div>
          <pre className="max-h-[260px] overflow-auto px-4 py-3 font-mono text-[0.68rem] leading-relaxed text-graphite">
            {lines.length > 0 ? lines.join('\n') : 'Waiting for the first line…'}
          </pre>
          {result ? (
            <div className="border-t border-line px-4 py-3">
              <div className="flex flex-wrap items-center gap-4 font-mono text-[0.66rem] text-graphite">
                <span className="inline-flex items-center gap-1.5 text-cyan">
                  <CheckIcon size={12} />
                  {result.staged.filter((entry) => entry.ok).length} staged
                </span>
                {result.ingest ? <span>{result.ingest.summary}</span> : <span>not compiled</span>}
                <Link to="/sources" className="ml-auto inline-flex items-center gap-1 hover:text-cyan">
                  Sources <ArrowRightIcon size={11} />
                </Link>
              </div>
              {result.staged.filter((entry) => !entry.ok).length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {result.staged
                    .filter((entry) => !entry.ok)
                    .slice(0, 10)
                    .map((entry, index) => (
                      <li
                        key={`${entry.filename}:${index}`}
                        className="flex items-start gap-1.5 font-mono text-[0.64rem] text-amber"
                      >
                        <AlertIcon size={11} className="mt-0.5 shrink-0" />
                        <span className="break-all">
                          {itemLabel(entry.item)} — {entry.error}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!plan && !jobId ? (
        <EmptyState title="Preview before you commit">
          Nothing is copied or fetched until you press <strong>Import</strong>. The plan shows
          duplicates, unsupported files, and the exact filenames that will land in{' '}
          <code className="font-mono text-cyan">raw/</code>.
        </EmptyState>
      ) : null}

      <p className="mt-6 font-mono text-[0.62rem] leading-relaxed text-graphite/70">
        Same feature in the terminal:{' '}
        <code className="text-graphite">axiom-wiki import ~/vault ~/Downloads --from bookmarks.html</code>
        {' · '}
        <code className="text-graphite">--dry-run</code> plans, <code className="text-graphite">--move</code>{' '}
        moves instead of copies.
      </p>
    </div>
  )
}
