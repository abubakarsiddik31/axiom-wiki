import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api'
import { formatDate } from '../format'
import { useAsync, useJobStream, useTitle } from '../hooks'
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
import { AlertIcon, CheckIcon, ScoutIcon, TrashIcon } from '../components/Icons'
import type { ScoutItem, ScoutShareResult } from '../types'

type Notice = { tone: 'ok' | 'error'; text: string } | null

const STATUS_TONE: Record<ScoutItem['status'], 'cyan' | 'amber' | 'default'> = {
  queued: 'default',
  running: 'cyan',
  done: 'cyan',
  failed: 'amber',
  skipped: 'default',
}

const STATUS_LABEL: Record<ScoutItem['status'], string> = {
  queued: 'queued',
  running: 'working',
  done: 'compiled',
  failed: 'failed',
  skipped: 'skipped',
}

export function Scout() {
  const { data, error, loading, reload } = useAsync((signal) => api.scout(signal), [])
  const config = useAsync((signal) => api.config(signal), [])
  useTitle('Scout')

  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [lastShare, setLastShare] = useState<ScoutShareResult | null>(null)
  const [drainJobId, setDrainJobId] = useState<string | null>(null)
  const drain = useJobStream(drainJobId)

  const writeMode = config.data?.writeMode ?? false
  const items = data?.items ?? []
  const summary = data?.summary
  const worker = data?.worker
  const draining = drain.job?.status === 'running' || drain.job?.status === 'queued'

  useEffect(() => {
    if (drain.job?.status === 'succeeded') reload()
  }, [drain.job?.status, reload])

  async function share() {
    const value = text.trim()
    if (!value || sending || !writeMode) return
    setSending(true)
    setNotice(null)
    setLastShare(null)
    try {
      const result = await api.scoutShare({
        text: value,
        note: note.trim() || undefined,
      })
      setLastShare(result)
      setText('')
      setNote('')
      const parts: string[] = []
      if (result.added.length > 0) parts.push(`${result.added.length} queued`)
      if (result.duplicates.length > 0) parts.push(`${result.duplicates.length} already known`)
      setNotice({
        tone: 'ok',
        text: parts.length > 0 ? `Scout: ${parts.join(', ')}.` : 'Nothing new to queue.',
      })
      reload()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setSending(false)
    }
  }

  async function drainNow() {
    setNotice(null)
    try {
      const { job } = await api.drainScout({ ingest: true, limit: 5 })
      setDrainJobId(job.id)
      setNotice({ tone: 'ok', text: 'Drain started. Watch the job tray.' })
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  async function retry(id: string) {
    setBusy(id)
    setNotice(null)
    try {
      await api.retryScout(id)
      setNotice({ tone: 'ok', text: 'Requeued.' })
      reload()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string) {
    setBusy(id)
    setNotice(null)
    try {
      await api.removeScout(id)
      reload()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  async function clearFinished() {
    setBusy('clear')
    setNotice(null)
    try {
      const result = await api.clearScout()
      setNotice({ tone: 'ok', text: `Cleared ${result.removed} finished item(s).` })
      reload()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      setNotice({ tone: 'ok', text: `${label} copied.` })
    } catch {
      setNotice({ tone: 'error', text: 'Clipboard access was blocked; select the text manually.' })
    }
  }

  if (loading && !data) return <LoadingPage rows={4} />
  if (error && !data) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Scout"
        title="Hand it a link"
        description="Scout is the wiki’s always-on intake agent. Share a YouTube link from your phone, paste a thread, drop a file, or tag it from another agent — it queues the hand-off, clips it, and compiles it into the wiki."
        actions={
          <Badge tone={worker ? 'cyan' : 'default'}>
            {worker ? `listening :${worker.port}` : 'listener off'}
          </Badge>
        }
      />

      {notice ? (
        <div
          className={`mb-5 border px-4 py-3 font-mono text-[0.72rem] ${
            notice.tone === 'ok'
              ? 'border-cyan/30 bg-cyan/5 text-cyan'
              : 'border-amber/30 bg-amber/5 text-amber'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <Stats>
        <Stat label="Queued" value={<span className="font-mono text-sm">{summary?.pending ?? 0}</span>} hint="waiting for a drain" />
        <Stat label="Working" value={<span className="font-mono text-sm">{summary?.running ?? 0}</span>} hint="being clipped" />
        <Stat label="Compiled" value={<span className="font-mono text-sm">{summary?.done ?? 0}</span>} hint="landed in the wiki" />
        <Stat label="Failed" value={<span className="font-mono text-sm">{summary?.failed ?? 0}</span>} hint="retry from the queue" />
      </Stats>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className="border border-line bg-surface/30 p-4" aria-labelledby="scout-share">
          <SectionLabel>Share</SectionLabel>
          <h2 id="scout-share" className="font-display text-sm font-semibold text-ghost">
            Paste a link, a thread, or a note
          </h2>
          <p className="mt-1 max-w-[72ch] text-[0.8rem] leading-relaxed text-graphite">
            Every link in the text is queued. <code className="font-mono text-cyan">#tags</code>{' '}
            become page tags, and <code className="font-mono text-cyan">@scout</code> is just a
            reminder that this is for the agent. Text without a link becomes an inbox note.
          </p>

          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void share()
              }
            }}
            rows={7}
            placeholder={'https://youtu.be/…  #read-later\n\nor paste the whole thread, doc, or a note…'}
            className="field mt-3 resize-y font-mono text-[0.74rem] leading-relaxed"
            disabled={!writeMode || sending}
          />

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="why it matters (optional)"
              className="field font-mono text-[0.72rem]"
              disabled={!writeMode || sending}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void share()}
                disabled={!writeMode || sending || !text.trim()}
                className="inline-flex items-center gap-1.5 border border-cyan/40 bg-cyan/10 px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-cyan disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ScoutIcon size={12} /> {sending ? 'Sending…' : 'Send to Scout'}
              </button>
              <span className="font-mono text-[0.6rem] text-graphite">⌘/Ctrl + Enter</span>
            </div>
          </div>

          {lastShare ? (
            <div className="mt-3 border-t border-line pt-3 font-mono text-[0.64rem] leading-relaxed text-graphite">
              <div>
                {lastShare.parsed.urls.length} link(s) · {lastShare.parsed.tags.length} tag(s)
                {lastShare.duplicates.length > 0 ? ` · ${lastShare.duplicates.length} duplicate(s)` : ''}
              </div>
              {lastShare.parsed.tags.length > 0 ? (
                <div className="mt-1 text-cyan">#{lastShare.parsed.tags.join(' #')}</div>
              ) : null}
              {lastShare.added.length > 0 ? (
                <div className="mt-1">
                  {lastShare.added.map((item) => (
                    <div key={item.id} className="truncate">
                      + {item.preview || item.id}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {!writeMode ? (
            <p className="mt-3 border border-amber/30 bg-amber/5 px-3 py-2 font-mono text-[0.66rem] text-amber">
              Restart with <code>axiom-wiki serve --allow-write</code> to queue shares from the web UI.
            </p>
          ) : null}
        </section>

        <section className="border border-line bg-surface/30 p-4" aria-labelledby="scout-endpoint">
          <SectionLabel>Endpoint</SectionLabel>
          <h2 id="scout-endpoint" className="font-display text-sm font-semibold text-ghost">
            {worker ? 'Listening' : 'Start the listener'}
          </h2>

          {worker ? (
            <>
              <dl className="mt-2 divide-y divide-line-soft font-mono text-[0.68rem]">
                <Row label="Address" value={`http://${worker.host}:${worker.port}`} />
                <Row label="PID" value={String(worker.pid)} />
                <Row label="Heartbeat" value={new Date(worker.heartbeatAt).toLocaleTimeString()} />
                {data.dropDir ? <Row label="Drop folder" value={data.dropDir} /> : null}
              </dl>

              {data.shareUrl ? (
                <button
                  type="button"
                  onClick={() => void copy(data.shareUrl as string, 'Share URL')}
                  className="mt-3 w-full border border-line bg-surface px-3 py-1.5 text-left font-mono text-[0.66rem] text-graphite hover:border-cyan hover:text-cyan"
                >
                  {data.shareUrl}
                </button>
              ) : null}

              {worker.lanUrl ? (
                <button
                  type="button"
                  onClick={() => void copy(`${worker.lanUrl}/share`, 'LAN share URL')}
                  className="mt-1 w-full border border-line bg-surface px-3 py-1.5 text-left font-mono text-[0.66rem] text-cyan hover:border-cyan hover:bg-cyan/5"
                >
                  LAN: {worker.lanUrl}/share
                </button>
              ) : null}

              {data.token ? (
                <>
                  <p className="mt-3 text-[0.7rem] leading-relaxed text-graphite">
                    Every share needs the token. It lives in <code className="font-mono">scout/token</code>.
                  </p>
                  <button
                    type="button"
                    onClick={() => void copy(data.token as string, 'Token')}
                    className="mt-1 w-full border border-line bg-surface px-3 py-1.5 text-left font-mono text-[0.66rem] text-graphite hover:border-cyan hover:text-cyan"
                  >
                    {data.token}
                  </button>
                </>
              ) : null}

              <details className="mt-3 border-t border-line pt-3">
                <summary className="cursor-pointer font-mono text-[0.62rem] uppercase tracking-[0.12em] text-graphite hover:text-cyan">
                  Phone share sheet / curl
                </summary>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words font-mono text-[0.62rem] leading-relaxed text-graphite">
{`curl -X POST ${data.shareUrl ?? 'http://127.0.0.1:1719/share'} \\
  -H "X-Scout-Token: ${data.token ?? '<token>'}" \\
  -H 'Content-Type: application/json' \\
  -d '{"url":"https://youtu.be/…","tags":["read-later"]}'`}
                </pre>
                <p className="mt-2 text-[0.7rem] leading-relaxed text-graphite">
                  On iOS or Android, make a Shortcut that posts the shared URL to that address with
                  the token header, and add it to the share sheet. For phone→laptop, run{' '}
                  <code className="font-mono">axiom-wiki scout --host 0.0.0.0</code>.
                </p>
              </details>
            </>
          ) : (
            <>
              <p className="mt-2 text-[0.8rem] leading-relaxed text-graphite">
                The queue and this page still work. Start the listener to accept shares from a
                phone, a shortcut, or <code className="font-mono">curl</code>:
              </p>
              <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words border border-line-soft bg-surface-2 px-3 py-2 font-mono text-[0.64rem] leading-relaxed text-graphite">
{`axiom-wiki scout                     # loopback
axiom-wiki scout --host 0.0.0.0      # accept LAN shares
axiom-wiki serve --allow-write --scout  # run it with the web UI`}
              </pre>
              <p className="mt-2 text-[0.7rem] leading-relaxed text-graphite">
                Or skip networking entirely: drop a file into{' '}
                <code className="font-mono">{data.dropDir}/</code>.
              </p>
            </>
          )}
        </section>
      </div>

      <section className="mt-4 border border-line bg-surface/30" aria-labelledby="scout-queue">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <SectionLabel>Queue</SectionLabel>
            <h2 id="scout-queue" className="font-display text-sm font-semibold text-ghost">
              Hand-offs, in order
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void drainNow()}
              disabled={!writeMode || draining || (summary?.pending ?? 0) === 0}
              className="inline-flex items-center gap-1.5 border border-cyan/40 bg-cyan/10 px-3 py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.1em] text-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckIcon size={12} /> {draining ? 'Draining…' : 'Drain now'}
            </button>
            <button
              type="button"
              onClick={() => void clearFinished()}
              disabled={!writeMode || busy === 'clear'}
              className="border border-line bg-surface px-3 py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.1em] text-graphite hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear finished
            </button>
          </div>
        </div>

        {drain.lines.length > 0 ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words border-b border-line px-4 py-2 font-mono text-[0.62rem] leading-relaxed text-graphite">
            {drain.lines.join('\n')}
          </pre>
        ) : null}

        {items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing queued">
              Share a link above, drop a file into the drop folder, or call scout_share from an agent.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <Badge tone={STATUS_TONE[item.status]}>
                  {item.status === 'failed' ? <AlertIcon size={10} /> : null}
                  {STATUS_LABEL[item.status]}
                </Badge>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[0.72rem] text-ghost">
                      {item.kind === 'text' ? 'note' : item.kind}
                    </span>
                    <span className="truncate font-mono text-[0.7rem] text-graphite">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-cyan"
                        >
                          {item.preview}
                        </a>
                      ) : (
                        item.preview
                      )}
                    </span>
                  </div>

                  {item.note ? (
                    <p className="mt-1 line-clamp-2 text-[0.72rem] leading-relaxed text-graphite">
                      {item.note}
                    </p>
                  ) : null}

                  <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[0.6rem] text-graphite">
                    <span>{formatDate(item.addedAt)}</span>
                    {item.tags.length > 0 ? (
                      <span className="text-cyan">#{item.tags.join(' #')}</span>
                    ) : null}
                    {item.attempts > 1 ? <span>{item.attempts} attempts</span> : null}
                    {item.result?.pages?.length ? (
                      <span className="flex flex-wrap gap-2">
                        {item.result.pages.map((id) => (
                          <Link key={id} to={`/page/${id}`} className="text-cyan hover:underline">
                            {id}
                          </Link>
                        ))}
                      </span>
                    ) : null}
                    {item.result?.filename ? <span>{item.result.filename}</span> : null}
                  </div>

                  {item.lastError ? (
                    <p className="mt-1 font-mono text-[0.64rem] text-amber">{item.lastError}</p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {item.status === 'failed' || item.status === 'skipped' ? (
                    <button
                      type="button"
                      onClick={() => void retry(item.id)}
                      disabled={!writeMode || busy === item.id}
                      className="border border-line bg-surface px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-graphite hover:border-cyan hover:text-cyan disabled:opacity-40"
                    >
                      Retry
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void remove(item.id)}
                    disabled={!writeMode || busy === item.id}
                    className="border border-line bg-surface p-1 text-graphite hover:border-amber hover:text-amber disabled:opacity-40"
                    aria-label={`Remove ${item.preview || item.id}`}
                  >
                    <TrashIcon size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 border border-line bg-surface/30 p-4">
        <SectionLabel>How it fits</SectionLabel>
        <div className="grid gap-4 md:grid-cols-3">
          <Note
            title="Phone or desktop share sheet"
            body="A shortcut posts the URL to Scout's listener. The token is the only credential; it stays local."
          />
          <Note
            title="Threads and docs"
            body="Paste the text into the box above. Every link is queued, the prose becomes context, and #tags stick to the source page."
          />
          <Note
            title="Agents"
            body="The scout_share tool is available to the wiki agent and over MCP, so another agent can hand off what it found."
          />
        </div>
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-graphite">{label}</dt>
      <dd className="truncate text-right text-ghost">{value}</dd>
    </div>
  )
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-l-2 border-cyan/40 pl-3">
      <h3 className="font-display text-[0.8rem] font-semibold text-ghost">{title}</h3>
      <p className="mt-1 text-[0.74rem] leading-relaxed text-graphite">{body}</p>
    </div>
  )
}
