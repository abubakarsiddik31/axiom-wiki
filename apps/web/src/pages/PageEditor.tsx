import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api, runAction } from '../api'
import { useAsync, useTitle } from '../hooks'
import { Markdown } from '../components/Markdown'
import { Badge, ErrorPanel, LoadingPage, PageHeading, SectionLabel } from '../components/ui'
import { CheckIcon } from '../components/Icons'
import type { SavePageResult } from '../types'

const CATEGORIES = ['entities', 'concepts', 'sources', 'analyses'] as const

export function PageEditor() {
  const params = useParams()
  const navigate = useNavigate()
  const id = params['*'] ?? ''
  const editing = Boolean(id)

  const existing = useAsync(
    (signal) => (editing ? api.page(id, signal) : Promise.resolve(null)),
    [id, editing],
  )
  const config = useAsync((signal) => api.config(signal), [])

  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState('')
  const [category, setCategory] = useState<string>(CATEGORIES[0])
  const [body, setBody] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')

  useTitle(editing ? `Editing ${id}` : 'New page')

  // Seed the form exactly once; reloads after a save must not clobber edits.
  useEffect(() => {
    if (loaded) return
    if (!editing) {
      setLoaded(true)
      return
    }
    if (!existing.data) return
    setTitle(existing.data.frontmatter.title)
    setSummary(existing.data.frontmatter.summary)
    setTags(existing.data.frontmatter.tags.join(', '))
    setCategory(existing.data.frontmatter.category || id.split('/')[0] || CATEGORIES[0])
    setBody(existing.data.body)
    setLoaded(true)
  }, [editing, existing.data, id, loaded])

  // Debounced server-side preview so it renders exactly like the page view.
  useEffect(() => {
    if (!showPreview) return
    const timer = window.setTimeout(() => {
      void runAction<{ html: string }>('preview', { body })
        .then((result) => setPreviewHtml(result.html))
        .catch(() => setPreviewHtml(''))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [body, showPreview])

  const parsedTags = useMemo(
    () =>
      tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    [tags],
  )

  const writeMode = config.data?.writeMode ?? false

  if (editing && existing.loading) return <LoadingPage rows={6} />
  if (editing && existing.error) {
    return <ErrorPanel message={existing.error} onRetry={existing.reload} />
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const result = await api.savePage({
        id: editing ? id : undefined,
        category: editing ? undefined : category,
        title: title.trim(),
        summary: summary.trim(),
        tags: parsedTags,
        body,
      })
      navigate(`/page/${(result as SavePageResult).id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow={editing ? 'Edit page' : 'New page'}
        title={editing ? title || id : 'Compose a page'}
        description="Markdown is the source of truth. Saving rebuilds the index, updates the map of content, refreshes the semantic index, and commits the change."
        actions={<Badge tone={writeMode ? 'cyan' : 'danger'}>{writeMode ? 'write enabled' : 'read-only'}</Badge>}
      />

      {!writeMode ? (
        <div className="mb-5 border border-amber/30 bg-amber/5 px-4 py-3 text-[0.82rem] leading-relaxed text-graphite">
          Editing is disabled. Restart the server with{' '}
          <code className="font-mono text-cyan">axiom-wiki serve --allow-write</code>.
        </div>
      ) : null}

      {error ? (
        <div className="mb-5 border border-danger/30 bg-danger/5 px-4 py-3 font-mono text-[0.72rem] text-danger">
          {error}
        </div>
      ) : null}

      <form onSubmit={save} className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <div>
            <label htmlFor="title" className="mb-1 block">
              <SectionLabel>Title</SectionLabel>
            </label>
            <input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="field w-full"
              placeholder="Alan Turing"
              disabled={!writeMode}
            />
          </div>

          <div>
            <label htmlFor="summary" className="mb-1 block">
              <SectionLabel>Summary</SectionLabel>
            </label>
            <input
              id="summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              className="field w-full"
              placeholder="One sentence that explains why this page exists."
              disabled={!writeMode}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="body">
                <SectionLabel>Body</SectionLabel>
              </label>
              <button
                type="button"
                onClick={() => setShowPreview((value) => !value)}
                className="mb-3 border border-line px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-graphite hover:border-cyan hover:text-cyan"
              >
                {showPreview ? 'Hide preview' : 'Preview'}
              </button>
            </div>
            <textarea
              id="body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={22}
              className="field w-full resize-y font-mono text-[0.78rem] leading-relaxed"
              placeholder={'## Overview\n\nWrite in Markdown. Link with [[category/page]].'}
              disabled={!writeMode}
            />
          </div>

          {showPreview ? (
            <section className="border border-line bg-surface/20 p-4">
              <SectionLabel>Preview</SectionLabel>
              {previewHtml.trim() ? (
                <Markdown html={previewHtml} />
              ) : (
                <p className="font-mono text-[0.7rem] text-graphite">Nothing to preview yet.</p>
              )}
            </section>
          ) : null}
        </div>

        <aside className="space-y-4 lg:col-span-4">
          <section className="border border-line bg-surface/30 p-4">
            <SectionLabel>Placement</SectionLabel>
            {editing ? (
              <>
                <p className="font-mono text-[0.7rem] text-ghost">{id}</p>
                <p className="mt-1 text-[0.72rem] leading-relaxed text-graphite">
                  Use <span className="font-mono text-cyan">Rename</span> on the page to move it;
                  every inbound link is rewritten.
                </p>
              </>
            ) : (
              <>
                <label htmlFor="category" className="mb-1 block font-mono text-[0.6rem] uppercase tracking-[0.12em] text-graphite">
                  Category
                </label>
                <select
                  id="category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="field w-full"
                  disabled={!writeMode}
                >
                  {CATEGORIES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <p className="mt-2 font-mono text-[0.64rem] text-graphite">
                  id: {category}/{title ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '…'}
                </p>
              </>
            )}
          </section>

          <section className="border border-line bg-surface/30 p-4">
            <label htmlFor="tags" className="mb-1 block">
              <SectionLabel>Tags</SectionLabel>
            </label>
            <input
              id="tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              className="field w-full"
              placeholder="history, computing, biography"
              disabled={!writeMode}
            />
            <p className="mt-1 font-mono text-[0.62rem] text-graphite">Comma separated.</p>
            {parsedTags.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {parsedTags.map((tag) => (
                  <span key={tag} className="border border-line px-1.5 py-0.5 font-mono text-[0.6rem] text-graphite">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <div className="flex flex-col gap-2">
            <button
              type="submit"
              disabled={!writeMode || saving || !title.trim()}
              className="inline-flex items-center justify-center gap-1.5 border border-cyan/40 bg-cyan/10 px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckIcon size={12} /> {saving ? 'Saving…' : editing ? 'Save changes' : 'Create page'}
            </button>
            <Link
              to={editing ? `/page/${id}` : '/pages'}
              className="inline-flex items-center justify-center gap-1.5 border border-line bg-surface px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-graphite hover:text-ghost"
            >
              Cancel
            </Link>
          </div>
        </aside>
      </form>
    </div>
  )
}
