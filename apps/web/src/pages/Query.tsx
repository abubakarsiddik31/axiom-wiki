import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { api, idFromPath, runAction } from '../api'
import { useAsync, useJobStream, useTitle } from '../hooks'
import { Badge, ErrorPanel, LoadingPage, PageHeading, SectionLabel } from '../components/ui'
import { ArrowRightIcon, CheckIcon } from '../components/Icons'
import type { JobPayload } from '../types'

interface Pair {
  question: string
  answer: string
}

export function Query() {
  const config = useAsync((signal) => api.config(signal), [])
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState('')
  const [forensic, setForensic] = useState(false)
  const [pairs, setPairs] = useState<Pair[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filed, setFiled] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const committed = useRef<Set<string>>(new Set())

  const { job, lines, text } = useJobStream(jobId)
  const writeMode = config.data?.writeMode ?? false
  const running = job?.status === 'running' || job?.status === 'queued'
  useTitle('Ask')

  useEffect(() => {
    if (!job || job.status !== 'succeeded' || committed.current.has(job.id)) return
    committed.current.add(job.id)
    const result = job.result as { answer?: string } | null
    const answer = result?.answer || text
    if (answer) {
      setPairs((prev) => [
        ...prev,
        { question: asked || question, answer },
      ].slice(-10))
    }
  }, [job, text, asked, question])

  async function ask(event: FormEvent) {
    event.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || running || !writeMode) return
    setError(null)
    setFiled(null)
    setAsked(trimmed)
    try {
      const { job: created } = await runAction<JobPayload>('query', {
        question: trimmed,
        forensic,
        history: pairs,
      })
      setJobId(created.id)
      setQuestion('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function saveAnswer() {
    if (!job || pairs.length === 0 || saving) return
    const answered = pairs[pairs.length - 1]
    if (!answered) return
    setSaving(true)
    setError(null)
    try {
      const result = await runAction<{ path: string }>('analysis/save', {
        question: answered.question,
        answer: answered.answer,
        title: answered.question,
      })
      setFiled(result.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (config.loading && !config.data) return <LoadingPage rows={4} />

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Ask"
        title="Query the wiki"
        description="Streams an answer from the same agent the CLI uses. Answers cite wiki pages; file one as an analysis page when it is worth keeping."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={forensic ? 'cyan' : 'default'}>{forensic ? 'forensic' : 'standard'}</Badge>
            <Badge tone={writeMode ? 'cyan' : 'default'}>{writeMode ? 'write enabled' : 'read-only'}</Badge>
          </div>
        }
      />

      {!writeMode ? (
        <div className="mb-5 border border-amber/30 bg-amber/5 px-4 py-3 text-[0.82rem] leading-relaxed text-graphite">
          Querying is disabled in read-only mode. Restart with{' '}
          <code className="font-mono text-cyan">axiom-wiki serve --allow-write</code>.
        </div>
      ) : null}

      {error ? <div className="mb-5"><ErrorPanel message={error} /></div> : null}

      <div className="mb-6 border border-line bg-surface/30 p-4">
        <form onSubmit={ask} className="flex flex-col gap-3">
          <label htmlFor="question" className="sr-only">
            Question
          </label>
          <textarea
            id="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What does the wiki say about…"
            rows={3}
            className="field resize-y"
            disabled={!writeMode || running}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-graphite">
              <input
                type="checkbox"
                checked={forensic}
                onChange={(event) => setForensic(event.target.checked)}
                disabled={!writeMode || running}
                className="accent-cyan"
              />
              strict grounded mode
            </label>
            <button
              type="submit"
              disabled={!writeMode || running || !question.trim()}
              className="inline-flex items-center gap-1.5 border border-cyan/40 bg-cyan/10 px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              Ask <ArrowRightIcon size={12} />
            </button>
          </div>
        </form>
      </div>

      {running ? (
        <section className="mb-6 border border-line bg-surface/20 p-4" aria-live="polite">
          <SectionLabel>Working</SectionLabel>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[0.68rem] leading-relaxed text-graphite">
            {lines.length ? lines.slice(-12).join('\n') : 'Thinking…'}
          </pre>
          {text ? (
            <div className="mt-4 border-t border-line pt-4">
              <div className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-graphite">
                streaming answer
              </div>
              <div className="whitespace-pre-wrap text-[0.88rem] leading-relaxed text-ghost">{text}</div>
            </div>
          ) : null}
        </section>
      ) : null}

      {pairs
        .slice()
        .reverse()
        .map((pair, index) => (
          <article key={`${pair.question}-${index}`} className="mb-5 border border-line bg-surface/20 p-4">
            <h2 className="font-display text-sm font-semibold text-ghost">{pair.question}</h2>
            <div className="mt-2 whitespace-pre-wrap text-[0.88rem] leading-relaxed text-graphite">
              {pair.answer}
            </div>
          </article>
        ))}

      {job?.status === 'succeeded' && pairs.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border border-line bg-surface/30 px-4 py-3">
          <button
            type="button"
            onClick={() => void saveAnswer()}
            disabled={!writeMode || saving}
            className="inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-ghost hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckIcon size={12} /> {saving ? 'Filing…' : 'File as analysis'}
          </button>
          {filed ? (
            <Link
              to={`/page/${idFromPath(filed)}`}
              className="font-mono text-[0.68rem] text-cyan hover:underline"
            >
              Open {filed}
            </Link>
          ) : null}
        </div>
      ) : null}

      {job?.status === 'failed' ? (
        <div className="border border-danger/30 bg-danger/5 px-4 py-3 font-mono text-[0.72rem] text-danger">
          {job.error ?? 'Query failed.'}
        </div>
      ) : null}
    </div>
  )
}
