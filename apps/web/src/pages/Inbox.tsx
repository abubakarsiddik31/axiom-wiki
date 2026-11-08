import { useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api'
import { useAsync, useTitle } from '../hooks'
import { formatDate, pluralize } from '../format'
import {
  Badge,
  EmptyState,
  ErrorPanel,
  LoadingPage,
  PageHeading,
  SectionLabel,
} from '../components/ui'
import { ArrowRightIcon, InboxIcon, MergeIcon, TrashIcon } from '../components/Icons'
import type { PageMeta } from '../types'

const PROMOTE_CATEGORIES = ['concepts', 'entities', 'analyses', 'sources'] as const

type Notice = { tone: 'ok' | 'error'; text: string } | null

function idFromPagePath(pagePath: string): string {
  return pagePath.replace(/^wiki\/pages\//, '').replace(/\.md$/, '')
}

export function Inbox() {
  const { data, error, loading, reload } = useAsync(
    (signal) => api.pages({ cat: 'inbox', sort: 'updated', limit: 200 }, signal),
    [],
  )
  const config = useAsync((signal) => api.config(signal), [])

  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  useTitle('Inbox')

  const writeMode = config.data?.writeMode ?? false

  async function submit() {
    const trimmed = text.trim()
    if (!trimmed || saving || !writeMode) return
    setSaving(true)
    setNotice(null)
    try {
      const result = await api.capture({
        text: trimmed,
        title: title.trim() || undefined,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      })
      setText('')
      setTitle('')
      setTags('')
      setNotice({ tone: 'ok', text: `Captured “${result.title}”.` })
      reload()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
  }

  async function promote(id: string, category: string) {
    setBusy(id)
    setNotice(null)
    try {
      const result = await api.promoteInbox(id, category)
      setNotice({ tone: 'ok', text: `Promoted to ${result.newId}.` })
      reload()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  async function merge(id: string, target: string) {
    setBusy(id)
    setNotice(null)
    try {
      await api.mergePages(id, target)
      setNotice({ tone: 'ok', text: `Merged ${id} into ${target}.` })
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
      await api.deletePage(id)
      setNotice({ tone: 'ok', text: `Discarded ${id}.` })
      reload()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  if (loading && !data) return <LoadingPage rows={5} />
  if (error && !data) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null

  const notes = data.pages

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Inbox"
        title="Capture now, file later"
        description="Jot a thought, a quote, or a URL with no ceremony. Notes land in the inbox category; promote them into a real category or merge them into an existing page when you know where they belong."
        actions={
          <Badge tone={notes.length > 0 ? 'amber' : 'cyan'}>
            {notes.length > 0 ? pluralize(notes.length, 'note') : 'inbox zero'}
          </Badge>
        }
      />

      {!writeMode ? (
        <div className="mb-5 border border-amber/30 bg-amber/5 px-4 py-3 text-[0.82rem] leading-relaxed text-graphite">
          Capturing is disabled. Restart the server with{' '}
          <code className="font-mono text-cyan">axiom-wiki serve --allow-write</code>.
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

      <section className="mb-7 border border-line bg-surface/30 p-4" aria-labelledby="capture-heading">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="capture-heading" className="font-display text-sm font-semibold text-ghost">
            New note
          </h2>
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-graphite">
            ⌘↵ to capture
          </span>
        </div>
        <label htmlFor="capture-text" className="sr-only">
          Note
        </label>
        <textarea
          id="capture-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder="The halting problem is diagonalisation wearing a hat."
          className="field w-full resize-y"
          disabled={!writeMode || saving}
        />
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div>
            <label htmlFor="capture-title" className="sr-only">
              Title (optional)
            </label>
            <input
              id="capture-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title (optional — derived from the first line)"
              className="field w-full font-mono text-[0.72rem]"
              disabled={!writeMode || saving}
            />
          </div>
          <div>
            <label htmlFor="capture-tags" className="sr-only">
              Tags (optional)
            </label>
            <input
              id="capture-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Tags, comma separated (optional)"
              className="field w-full font-mono text-[0.72rem]"
              disabled={!writeMode || saving}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!writeMode || saving || !text.trim()}
            className="inline-flex items-center gap-1.5 border border-cyan/40 bg-cyan/10 px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-cyan disabled:cursor-not-allowed disabled:opacity-40"
          >
            <InboxIcon size={12} /> {saving ? 'Capturing…' : 'Capture'}
          </button>
        </div>
      </section>

      <div className="mb-2 flex items-center justify-between">
        <SectionLabel>{notes.length > 0 ? `${notes.length} waiting` : 'nothing waiting'}</SectionLabel>
      </div>

      {notes.length === 0 ? (
        <EmptyState title="Inbox zero">
          Everything captured has been promoted or merged. Write something above and it will land
          here.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <InboxRow
              key={note.path}
              note={note}
              writeMode={writeMode}
              busy={busy === idFromPagePath(note.path)}
              onPromote={(category) => void promote(idFromPagePath(note.path), category)}
              onMerge={(target) => void merge(idFromPagePath(note.path), target)}
              onDelete={() => void remove(idFromPagePath(note.path))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function InboxRow({
  note,
  writeMode,
  busy,
  onPromote,
  onMerge,
  onDelete,
}: {
  note: PageMeta
  writeMode: boolean
  busy: boolean
  onPromote: (category: string) => void
  onMerge: (target: string) => void
  onDelete: () => void
}) {
  const id = idFromPagePath(note.path)
  const [category, setCategory] = useState<string>(PROMOTE_CATEGORIES[0])
  const [target, setTarget] = useState('')
  const [confirm, setConfirm] = useState(false)

  return (
    <li className="border border-line bg-surface/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/page/${id}`} className="text-[0.9rem] font-medium text-ghost hover:text-cyan">
            {note.title}
          </Link>
          <p className="mt-1 line-clamp-2 text-[0.78rem] leading-relaxed text-graphite">
            {note.summary}
          </p>
          <p className="mt-1 font-mono text-[0.6rem] text-graphite">
            captured {formatDate(note.updatedAt)} · {id}
          </p>
        </div>
        <Link
          to={`/page/${id}`}
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-graphite hover:text-cyan"
        >
          open <ArrowRightIcon size={10} />
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
        <div className="flex items-center gap-1.5">
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="field w-auto py-1 font-mono text-[0.66rem]"
            aria-label={`Promote ${note.title} to category`}
            disabled={!writeMode || busy}
          >
            {PROMOTE_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onPromote(category)}
            disabled={!writeMode || busy}
            className="inline-flex items-center gap-1 border border-cyan/40 bg-cyan/10 px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-cyan disabled:cursor-not-allowed disabled:opacity-40"
          >
            Promote
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="concepts/target-id"
            className="field w-44 py-1 font-mono text-[0.66rem]"
            aria-label={`Merge ${note.title} into page id`}
            disabled={!writeMode || busy}
          />
          <button
            type="button"
            onClick={() => target.trim() && onMerge(target.trim())}
            disabled={!writeMode || busy || !target.trim()}
            className="inline-flex items-center gap-1 border border-line px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-graphite hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MergeIcon size={10} /> Merge
          </button>
        </div>

        <div className="ml-auto">
          {confirm ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                className="border border-danger/40 bg-danger/10 px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-danger"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirm(false)}
                className="border border-line px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-graphite"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              disabled={!writeMode || busy}
              className="inline-flex items-center gap-1 border border-line px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-graphite hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
            >
              <TrashIcon size={10} /> Discard
            </button>
          )}
        </div>
      </div>
    </li>
  )
}
