import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api, runAction } from '../api'
import { formatDate } from '../format'
import { useAsync, useJobStream, useTitle } from '../hooks'
import { ErrorPanel, LoadingPage, SectionLabel } from '../components/ui'
import { Markdown } from '../components/Markdown'
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  LinkIcon,
  PlusIcon,
  TrashIcon,
} from '../components/Icons'
import type {
  ChatMessage,
  ContextOrigin,
  ThreadRerank,
  ThreadSource,
  ThreadSummary,
} from '../types'

type Notice = { tone: 'ok' | 'error'; text: string } | null

const ORIGIN_LABEL: Record<ContextOrigin, string> = {
  search: 'matched',
  link: 'linked',
  backlink: 'links here',
}

const STARTERS = [
  'What have I saved most recently, and what are the common threads?',
  'Where does the wiki contradict itself right now?',
  'Summarize the pages that nothing links to yet.',
]

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : formatDate(value)
}

function rerankLabel(rerank: ThreadRerank | null | undefined): string | null {
  if (!rerank) return null
  if (rerank.used) return `reranked · ${rerank.provider}`
  if (rerank.provider === 'none') return 'reranker off'
  return 'hybrid order'
}

function Grounding({
  sources,
  rerank,
}: {
  sources: ThreadSource[]
  rerank?: ThreadRerank | null
}) {
  if (sources.length === 0) return null
  const label = rerankLabel(rerank)
  return (
    <details className="mt-1 max-w-full">
      <summary className="cursor-pointer font-mono text-[0.58rem] uppercase tracking-[0.12em] text-graphite hover:text-cyan">
        {sources.length} {sources.length === 1 ? 'source' : 'sources'}
        {label ? ` · ${label}` : ''}
      </summary>
      <ul className="mt-1.5 grid gap-1">
        {sources.map((source) => (
          <li key={source.id} className="flex items-baseline gap-2">
            <LinkIcon size={10} className="shrink-0 text-graphite" />
            <Link
              to={`/page/${source.id}`}
              className="truncate text-[0.72rem] text-ghost hover:text-cyan"
              title={source.summary || source.id}
            >
              {source.title}
            </Link>
            <span className="shrink-0 font-mono text-[0.54rem] uppercase tracking-[0.08em] text-graphite/70">
              {ORIGIN_LABEL[source.origin]}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Thinking">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-graphite [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-graphite [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-graphite" />
    </span>
  )
}

function Bubble({
  message,
  onFile,
  busy,
  onCopy,
}: {
  message: ChatMessage
  onFile?: () => void
  busy?: boolean
  onCopy: (text: string) => void
}) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex w-full max-w-[88%] flex-col gap-1 sm:max-w-[78%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-2 px-1 font-mono text-[0.54rem] uppercase tracking-[0.16em] text-graphite/80">
          <span className={isUser ? 'text-cyan/80' : ''}>{isUser ? 'You' : 'Axiom'}</span>
          <span className="opacity-50">{formatTime(message.at)}</span>
        </div>

        <div
          className={`w-full rounded-2xl border px-4 py-2.5 ${
            isUser
              ? 'rounded-br-md border-cyan/25 bg-cyan/10 text-ghost'
              : message.error
                ? 'rounded-bl-md border-amber/30 bg-amber/5 text-amber'
                : 'rounded-bl-md border-line bg-surface text-graphite'
          }`}
        >
          {message.error ? (
            <div className="flex items-start gap-2 font-mono text-[0.7rem] leading-relaxed">
              <AlertIcon size={12} className="mt-0.5 shrink-0" />
              <span>{message.error}</span>
            </div>
          ) : isUser ? (
            <p className="whitespace-pre-wrap text-[0.88rem] leading-relaxed">{message.content}</p>
          ) : message.html ? (
            <div className="chat-prose">
              <Markdown html={message.html} />
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-[0.88rem] leading-relaxed">{message.content}</p>
          )}
        </div>

        {message.searched ? (
          <p className="px-1 font-mono text-[0.56rem] leading-relaxed text-graphite/70">
            searched: “{message.searched}”
          </p>
        ) : null}

        {!isUser && !message.error ? (
          <div className="w-full px-1">
            <Grounding sources={message.sources ?? []} rerank={message.rerank} />
            {message.content ? (
              <div className="mt-1.5 flex items-center gap-3 font-mono text-[0.56rem] uppercase tracking-[0.08em] text-graphite/70">
                <button
                  type="button"
                  onClick={() => onCopy(message.content)}
                  className="hover:text-cyan"
                >
                  copy
                </button>
                {onFile ? (
                  <button
                    type="button"
                    onClick={onFile}
                    disabled={busy}
                    className="hover:text-cyan disabled:opacity-40"
                  >
                    file as analysis
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function Query() {
  const params = useParams<{ threadId?: string }>()
  const navigate = useNavigate()
  useTitle('Ask')

  const threadId = params.threadId ?? null

  const config = useAsync((signal) => api.config(signal), [])
  const threadsState = useAsync((signal) => api.threads(signal), [])
  const threadState = useAsync(
    (signal) => (threadId ? api.thread(threadId, signal) : Promise.resolve(null)),
    [threadId],
  )

  const [question, setQuestion] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [forensic, setForensic] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const settled = useRef<string | null>(null)

  const { job, lines, text } = useJobStream(jobId)
  const writeMode = config.data?.writeMode ?? false
  const running = job?.status === 'running' || job?.status === 'queued'

  const thread = threadState.data?.thread ?? null
  const messages = thread?.messages ?? []
  const threads: ThreadSummary[] = threadsState.data?.threads ?? []
  const lastLog = lines.length > 0 ? lines[lines.length - 1] : ''

  useEffect(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, text, jobId])

  useEffect(() => {
    if (!job) return
    if (job.status !== 'succeeded' && job.status !== 'failed' && job.status !== 'cancelled') return
    if (settled.current === job.id) return
    settled.current = job.id
    threadState.reload()
    threadsState.reload()
    if (job.status === 'failed' && job.error) setError(job.error)
    composerRef.current?.focus()
  }, [job, threadState.reload, threadsState.reload])

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus()
  }, [editingTitle])

  // Grow the composer with the draft, up to a few lines.
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [question])

  useEffect(() => {
    setConfirmDelete(false)
    setEditingTitle(false)
  }, [threadId])

  async function send(override?: string) {
    const value = (override ?? question).trim()
    if (!value || running || sending || !writeMode) return
    setError(null)
    setNotice(null)
    setSending(true)
    setQuestion('')
    try {
      const result = await api.askThread({
        threadId: threadId ?? undefined,
        question: value,
        forensic,
      })
      setJobId(result.job.id)
      threadState.reload()
      threadsState.reload()
      if (result.created || result.threadId !== threadId) {
        navigate(`/ask/${result.threadId}`, { replace: true })
      }
    } catch (err) {
      setQuestion(value)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  async function newThread() {
    setError(null)
    setNotice(null)
    try {
      const result = await api.newThread()
      threadsState.reload()
      navigate(`/ask/${result.thread.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function renameActive() {
    if (!thread) return
    const next = titleDraft.trim()
    setEditingTitle(false)
    if (!next || next === thread.title) return
    try {
      await api.renameThread(thread.id, next)
      threadState.reload()
      threadsState.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function deleteActive() {
    if (!thread) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy('delete')
    try {
      await api.deleteThread(thread.id)
      threadsState.reload()
      navigate('/ask', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      setConfirmDelete(false)
    }
  }

  async function saveThread() {
    if (!thread) return
    setBusy('save')
    setError(null)
    try {
      const result = await api.saveThread(thread.id)
      setNotice({ tone: 'ok', text: `Filed the conversation as ${result.path}` })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function fileAnswer(message: ChatMessage, ask: string) {
    setBusy(message.id)
    setError(null)
    try {
      const result = await runAction<{ path: string }>('analysis/save', {
        question: ask,
        answer: message.content,
        title: ask,
      })
      setNotice({ tone: 'ok', text: `Filed this answer as ${result.path}` })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice({ tone: 'ok', text: 'Answer copied.' })
    } catch {
      setNotice({ tone: 'error', text: 'Clipboard access was blocked.' })
    }
  }

  if (config.loading && !config.data) return <LoadingPage rows={4} />
  if (config.error && !config.data) return <ErrorPanel message={config.error} onRetry={config.reload} />

  return (
    <div className="fade-up">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>Ask</SectionLabel>
          <h1 className="font-display text-[1.25rem] font-semibold leading-tight tracking-[-0.02em] text-ghost">
            Conversation
          </h1>
          <p className="mt-1 hidden max-w-[68ch] text-[0.8rem] leading-relaxed text-graphite sm:block">
            Talk to the wiki. Each turn retrieves pages, keeps the thread’s context, and cites
            what it read.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center border px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] ${
              writeMode
                ? 'border-cyan/30 bg-cyan/5 text-cyan'
                : 'border-line bg-surface text-graphite'
            }`}
          >
            {writeMode ? 'write enabled' : 'read-only'}
          </span>
        </div>
      </header>

      {!writeMode ? (
        <div className="mb-4 border border-amber/30 bg-amber/5 px-4 py-2.5 text-[0.8rem] leading-relaxed text-graphite">
          Conversations are disabled in read-only mode. Restart with{' '}
          <code className="font-mono text-cyan">axiom-wiki serve --allow-write</code>.
        </div>
      ) : null}

      {error ? (
        <div className="mb-4">
          <ErrorPanel message={error} onRetry={() => setError(null)} />
        </div>
      ) : null}

      {notice ? (
        <div className="mb-4 border border-cyan/30 bg-cyan/5 px-4 py-2 font-mono text-[0.68rem] text-cyan">
          {notice.text}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[256px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="hidden md:flex md:flex-col" aria-label="Conversations">
          <button
            type="button"
            onClick={() => void newThread()}
            disabled={!writeMode}
            className="mb-2 flex items-center justify-center gap-1.5 rounded-xl border border-cyan/40 bg-cyan/10 px-3 py-2 font-mono text-[0.64rem] uppercase tracking-[0.08em] text-cyan hover:bg-cyan/15 disabled:opacity-40"
          >
            <PlusIcon size={11} /> New conversation
          </button>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-surface/20">
            {threads.length === 0 ? (
              <p className="px-3 py-4 font-mono text-[0.64rem] leading-relaxed text-graphite">
                No conversations yet. Ask something and it lands here.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {threads.map((entry) => {
                  const active = entry.id === threadId
                  return (
                    <li key={entry.id}>
                      <Link
                        to={`/ask/${entry.id}`}
                        className={`block border-l-2 px-3 py-2.5 transition-colors ${
                          active
                            ? 'border-cyan bg-cyan/5'
                            : 'border-transparent hover:border-line hover:bg-surface'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[0.76rem] text-ghost">{entry.title}</span>
                          <span className="shrink-0 font-mono text-[0.54rem] text-graphite/70">
                            {formatDate(entry.updatedAt)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[0.6rem] text-graphite/70">
                          {entry.preview || `${entry.messageCount} messages`}
                        </p>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Chat panel */}
        <section
          className="flex h-[calc(100dvh-12rem)] min-h-[440px] min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface/15 sm:h-[calc(100dvh-13rem)]"
          aria-label="Conversation"
        >
          {/* Chat header */}
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <div className="min-w-0 flex-1">
              {thread ? (
                editingTitle ? (
                  <input
                    ref={titleInputRef}
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={() => void renameActive()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void renameActive()
                      } else if (event.key === 'Escape') {
                        setEditingTitle(false)
                      }
                    }}
                    className="field w-full font-display text-[0.86rem]"
                    aria-label="Conversation title"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setTitleDraft(thread.title)
                      setEditingTitle(true)
                    }}
                    className="block w-full truncate text-left font-display text-[0.88rem] font-semibold text-ghost hover:text-cyan"
                    title="Rename this conversation"
                  >
                    {thread.title}
                  </button>
                )
              ) : (
                <div className="font-display text-[0.88rem] font-semibold text-ghost">
                  New conversation
                </div>
              )}
              <div className="mt-0.5 flex items-center gap-2 font-mono text-[0.54rem] uppercase tracking-[0.14em] text-graphite/70">
                <span className="inline-flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-cyan' : 'bg-graphite/50'}`} />
                  {running ? 'thinking' : 'ready'}
                </span>
                <span>·</span>
                <span>{messages.length} messages</span>
              </div>
            </div>

            {thread ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void saveThread()}
                  aria-label="Save conversation as a wiki page"
                  disabled={!writeMode || busy === 'save' || messages.length === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 font-mono text-[0.56rem] uppercase tracking-[0.08em] text-graphite hover:border-cyan hover:text-cyan disabled:opacity-40"
                  title="Save this conversation as a wiki page"
                >
                  <CheckIcon size={10} /> save
                </button>
                <button
                  type="button"
                  onClick={() => void deleteActive()}
                  disabled={!writeMode || busy === 'delete'}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-mono text-[0.56rem] uppercase tracking-[0.08em] disabled:opacity-40 ${
                    confirmDelete
                      ? 'border-amber/50 bg-amber/10 text-amber'
                      : 'border-line text-graphite hover:border-amber hover:text-amber'
                  }`}
                >
                  <TrashIcon size={10} /> {confirmDelete ? 'confirm' : 'delete'}
                </button>
              </div>
            ) : null}
          </div>

          {/* Mobile thread switcher */}
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 md:hidden">
            <select
              value={threadId ?? ''}
              onChange={(event) => {
                const next = event.target.value
                navigate(next ? `/ask/${next}` : '/ask')
              }}
              className="field flex-1 font-mono text-[0.68rem]"
              aria-label="Conversation"
            >
              <option value="">New conversation</option>
              {threads.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void newThread()}
              disabled={!writeMode}
              className="rounded-lg border border-line px-2 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-graphite hover:border-cyan hover:text-cyan disabled:opacity-40"
            >
              New
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollerRef}
            className="min-h-[320px] flex-1 space-y-4 overflow-y-auto px-4 py-5"
            aria-live="polite"
          >
            {threadState.loading && !thread ? (
              <p className="font-mono text-[0.66rem] text-graphite">Loading conversation…</p>
            ) : null}

            {messages.map((message, index) => {
              const ask =
                message.role === 'assistant'
                  ? [...messages.slice(0, index)].reverse().find((m) => m.role === 'user')
                      ?.content ?? thread?.title ?? ''
                  : ''
              return (
                <Bubble
                  key={message.id}
                  message={message}
                  onFile={
                    message.role === 'assistant' && writeMode && ask
                      ? () => void fileAnswer(message, ask)
                      : undefined
                  }
                  busy={busy === message.id}
                  onCopy={(text) => void copy(text)}
                />
              )
            })}

            {running ? (
              <div className="flex justify-start">
                <div className="flex max-w-[88%] flex-col gap-1 sm:max-w-[78%]">
                  <div className="flex items-center gap-2 px-1 font-mono text-[0.54rem] uppercase tracking-[0.16em] text-graphite/80">
                    <span>Axiom</span>
                    <span className="opacity-50">{sending ? 'sending' : lastLog || 'thinking'}</span>
                  </div>
                  <div className="rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-2.5">
                    {text ? (
                      <p className="whitespace-pre-wrap text-[0.88rem] leading-relaxed text-graphite">
                        {text}
                        <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-cyan align-middle" />
                      </p>
                    ) : (
                      <TypingDots />
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {messages.length === 0 && !running ? (
              <div className="flex h-full flex-col items-center justify-center py-8 text-center">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-cyan/30 bg-cyan/5">
                  <span className="font-display text-[0.9rem] text-cyan">A</span>
                </div>
                <h2 className="font-display text-[0.95rem] font-semibold text-ghost">
                  Ask the wiki anything
                </h2>
                <p className="mt-1 max-w-[46ch] text-[0.78rem] leading-relaxed text-graphite">
                  It answers from your pages, shows what it read, and remembers the conversation.
                </p>
                <div className="mt-4 grid w-full max-w-[560px] gap-2">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => void send(starter)}
                      disabled={!writeMode}
                      className="rounded-xl border border-line bg-surface/40 px-3 py-2 text-left text-[0.78rem] text-graphite transition-colors hover:border-cyan hover:text-ghost disabled:opacity-40"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* Composer */}
          <div className="border-t border-line p-3">
            <div className="rounded-2xl border border-line bg-surface focus-within:border-cyan/50">
              <label htmlFor="composer" className="sr-only">
                Message
              </label>
              <textarea
                ref={composerRef}
                id="composer"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={onComposerKeyDown}
                rows={1}
                placeholder={
                  messages.length === 0
                    ? 'Ask a question…'
                    : 'Reply — the thread keeps its context'
                }
                className="max-h-40 w-full resize-none bg-transparent px-3.5 pt-3 text-[0.86rem] leading-relaxed text-ghost placeholder:text-graphite/60 focus:outline-none"
                disabled={!writeMode}
              />
              <div className="flex items-center justify-between gap-2 px-2 pb-2">
                <div className="flex items-center gap-3 pl-1">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-[0.56rem] uppercase tracking-[0.08em] text-graphite">
                    <input
                      type="checkbox"
                      checked={forensic}
                      onChange={(event) => setForensic(event.target.checked)}
                      disabled={!writeMode || running}
                      className="accent-cyan"
                    />
                    grounded
                  </label>
                  <span className="hidden font-mono text-[0.54rem] text-graphite/60 sm:inline">
                    Enter to send
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!writeMode || running || sending || !question.trim()}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-cyan text-[#04141a] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Send message"
                >
                  <ArrowRightIcon size={15} />
                </button>
              </div>
            </div>
            <p className="mt-1.5 px-1 font-mono text-[0.54rem] leading-relaxed text-graphite/60">
              Saved in <code className="font-mono">chat/threads/</code> · “save” files the whole
              conversation into <code className="font-mono">analyses/</code>
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
