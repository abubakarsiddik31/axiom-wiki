import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import { useAsync, useTitle } from '../hooks'
import { formatDate } from '../format'
import { Badge, ErrorPanel, LoadingPage, PageHeading, SectionLabel } from '../components/ui'
import { ArrowRightIcon, ClockIcon, HistoryIcon } from '../components/Icons'

function diffLineClass(line: string): string {
  if (line.startsWith('@@')) return 'text-cyan'
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-graphite'
  if (line.startsWith('+')) return 'text-cyan'
  if (line.startsWith('-')) return 'text-danger'
  return 'text-graphite'
}

export function PageHistory() {
  const params = useParams()
  const navigate = useNavigate()
  const id = params['*'] ?? ''

  const history = useAsync((signal) => api.pageHistory(id, signal), [id])
  const config = useAsync((signal) => api.config(signal), [])
  const [selected, setSelected] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const diff = useAsync(
    (signal) => (selected ? api.pageDiff(id, selected, signal) : Promise.resolve(null)),
    [id, selected],
  )

  useTitle(`History — ${id}`)

  const writeMode = config.data?.writeMode ?? false

  async function restore(rev: string) {
    setRestoring(true)
    setError(null)
    try {
      await api.restorePage(id, rev)
      navigate(`/page/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRestoring(false)
    }
  }

  if (history.loading && !history.data) return <LoadingPage rows={6} />
  if (history.error && !history.data) {
    return <ErrorPanel message={history.error} onRetry={history.reload} />
  }
  if (!history.data) return null

  const { available, reason, commits } = history.data

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="History"
        title={id}
        description="Every page write is committed, so the wiki remembers what changed. Pick a commit to inspect its diff, or restore it verbatim."
        actions={
          <Link
            to={`/page/${id}`}
            className="inline-flex items-center gap-1.5 border border-line bg-surface px-2.5 py-1 font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ghost hover:border-cyan hover:text-cyan"
          >
            Back to page <ArrowRightIcon size={11} />
          </Link>
        }
      />

      {!available ? (
        <div className="border border-amber/30 bg-amber/5 px-4 py-3 font-mono text-[0.72rem] leading-relaxed text-amber">
          {reason ?? 'History is unavailable for this wiki.'}
        </div>
      ) : commits.length === 0 ? (
        <div className="border border-line bg-surface/30 px-4 py-6 font-mono text-[0.72rem] text-graphite">
          No commits touch this page yet. History fills in as the agent and the editor write.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <ol className="lg:col-span-5">
            {commits.map((commit) => {
              const active = selected === commit.hash
              return (
                <li key={commit.hash}>
                  <button
                    type="button"
                    onClick={() => setSelected(commit.hash)}
                    className={`mb-1 w-full border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-cyan/50 bg-cyan/5'
                        : 'border-line bg-surface/30 hover:border-line hover:bg-surface/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[0.78rem] text-ghost">{commit.subject}</span>
                      <span className="shrink-0 font-mono text-[0.6rem] text-graphite">
                        {commit.shortHash}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[0.6rem] text-graphite">
                      <ClockIcon size={10} />
                      <span>{formatDate(commit.date)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{commit.author}</span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ol>

          <section className="lg:col-span-7" aria-labelledby="diff-heading">
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>Diff</SectionLabel>
              {selected && writeMode ? (
                <button
                  type="button"
                  onClick={() => void restore(selected)}
                  disabled={restoring}
                  className="mb-3 inline-flex items-center gap-1.5 border border-amber/40 bg-amber/10 px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-amber disabled:opacity-40"
                >
                  <HistoryIcon size={11} /> {restoring ? 'Restoring…' : 'Restore this version'}
                </button>
              ) : null}
            </div>

            <h2 id="diff-heading" className="sr-only">
              Commit diff
            </h2>

            {error ? (
              <div className="mb-2 border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[0.66rem] text-danger">
                {error}
              </div>
            ) : null}

            {!selected ? (
              <div className="border border-line bg-surface/30 px-4 py-6 font-mono text-[0.72rem] text-graphite">
                Select a commit to see what changed.
              </div>
            ) : diff.loading && !diff.data ? (
              <div className="border border-line bg-surface/30 px-4 py-6 font-mono text-[0.72rem] text-graphite">
                Loading diff…
              </div>
            ) : diff.data && diff.data.patch.trim() ? (
              <div className="max-h-[70vh] overflow-auto border border-line bg-space">
                <pre className="p-3 font-mono text-[0.66rem] leading-relaxed">
                  {diff.data.patch.split('\n').map((line, index) => (
                    <div key={index} className={diffLineClass(line)}>
                      {line || ' '}
                    </div>
                  ))}
                </pre>
              </div>
            ) : (
              <div className="border border-line bg-surface/30 px-4 py-6 font-mono text-[0.72rem] text-graphite">
                No textual diff for this commit.
              </div>
            )}
          </section>
        </div>
      )}

      {!writeMode ? (
        <p className="mt-5 font-mono text-[0.64rem] text-graphite">
          <Badge tone="default">read-only</Badge>{' '}
          Restore requires <span className="text-cyan">--allow-write</span>.
        </p>
      ) : null}
    </div>
  )
}
