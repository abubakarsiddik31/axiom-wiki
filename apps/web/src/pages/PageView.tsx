import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import { useAsync, useTitle } from '../hooks'
import { Markdown } from '../components/Markdown'
import { Badge, EmptyState, ErrorPanel, LoadingPage, SectionLabel } from '../components/ui'
import {
  ArrowRightIcon,
  EditIcon,
  HistoryIcon,
  LinkIcon,
  MergeIcon,
  TrashIcon,
} from '../components/Icons'
import type { RelatedReason } from '../types'

const SEGMENT_RE = /^[\w][\w.-]*$/

function isValidId(id: string): boolean {
  const segments = id.split('/').filter(Boolean)
  return segments.length >= 2 && segments.every((s) => SEGMENT_RE.test(s) && !s.includes('..'))
}

function MissingPage({ id }: { id: string }) {
  return (
    <div className="fade-up">
      <EmptyState
        title="Page not found"
        action={
          <Link
            to="/pages"
            className="inline-flex items-center gap-1.5 border border-line bg-surface px-2.5 py-1 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-ghost hover:border-cyan hover:text-cyan"
          >
            Browse pages <ArrowRightIcon size={12} />
          </Link>
        }
      >
        <span className="font-mono text-[0.72rem] text-graphite">{id || 'unknown page'}</span> does not
        exist in this wiki. It may have been renamed, or the link is stale.
      </EmptyState>
    </div>
  )
}

const REASON_LABEL: Record<RelatedReason, string> = {
  tag: 'shared tag',
  link: 'linked',
  'co-citation': 'same sources',
  mention: 'mentions',
}

export function PageView() {
  const params = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const id = params['*'] ?? ''
  const valid = isValidId(id)

  const { data, error, loading, reload } = useAsync(
    (signal) =>
      valid ? api.page(id, signal) : Promise.reject(new Error('Unknown page address.')),
    [id, valid],
  )
  const links = useAsync(
    (signal) => (valid ? api.pageLinks(id, signal) : Promise.resolve(null)),
    [id, valid],
  )
  const config = useAsync((signal) => api.config(signal), [])

  const [linkBusy, setLinkBusy] = useState<string | null>(null)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const anchor = useMemo(() => location.hash.replace(/^#/, ''), [location.hash])
  useTitle(data?.frontmatter.title)

  useEffect(() => {
    if (!data || !anchor) return
    const target = document.getElementById(anchor)
    if (target) {
      requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }))
    }
  }, [data, anchor])

  if (!valid) return <MissingPage id={id} />
  if (loading) return <LoadingPage rows={7} />
  if (error) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null

  const { frontmatter, html, backlinks } = data
  const category = frontmatter.category || id.split('/')[0] || 'uncategorised'
  const slug = id.split('/').pop() ?? id
  const writeMode = config.data?.writeMode ?? false

  async function linkMention(sourceId: string) {
    setLinkBusy(sourceId)
    setAdminError(null)
    try {
      await api.linkMention(sourceId, id)
      links.reload()
      reload()
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : String(err))
    } finally {
      setLinkBusy(null)
    }
  }

  async function rename() {
    if (!renameTo.trim()) return
    setAdminError(null)
    try {
      await api.renamePage(id, renameTo.trim())
      navigate(`/page/${renameTo.trim()}`)
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : String(err))
    }
  }

  async function merge() {
    if (!mergeTarget.trim()) return
    setAdminError(null)
    try {
      await api.mergePages(id, mergeTarget.trim())
      navigate(`/page/${mergeTarget.trim()}`)
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove() {
    setAdminError(null)
    try {
      await api.deletePage(id)
      navigate('/pages')
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="fade-up">
      <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.66rem] text-graphite">
        <Link to="/pages" className="hover:text-cyan">
          pages
        </Link>
        <span aria-hidden="true">/</span>
        <Link to={`/pages?cat=${encodeURIComponent(category)}`} className="hover:text-cyan">
          {category}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-ghost">{slug}</span>
      </nav>

      <header className="mb-7 border-b border-line pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-display text-[1.7rem] font-semibold leading-tight tracking-[-0.025em] text-ghost">
            {frontmatter.title}
          </h1>
          <div className="flex flex-wrap gap-1.5">
            <Link
              to={`/edit/${id}`}
              className="inline-flex items-center gap-1.5 border border-line bg-surface px-2.5 py-1 font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ghost hover:border-cyan hover:text-cyan"
            >
              <EditIcon size={11} /> Edit
            </Link>
            <Link
              to={`/history/${id}`}
              className="inline-flex items-center gap-1.5 border border-line bg-surface px-2.5 py-1 font-mono text-[0.64rem] uppercase tracking-[0.1em] text-graphite hover:border-cyan hover:text-cyan"
            >
              <HistoryIcon size={11} /> History
            </Link>
          </div>
        </div>
        {frontmatter.summary ? (
          <p className="mt-2 max-w-[72ch] text-[0.92rem] leading-relaxed text-graphite">
            {frontmatter.summary}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[0.66rem] text-graphite">
          <span>
            updated <span className="text-ghost">{frontmatter.updatedAt || '—'}</span>
          </span>
          <span className="hidden h-3 w-px bg-line sm:block" aria-hidden="true" />
          <span className="lowercase">{id}</span>
          {frontmatter.tags.length ? (
            <>
              <span className="hidden h-3 w-px bg-line sm:block" aria-hidden="true" />
              <span className="flex flex-wrap gap-1">
                {frontmatter.tags.map((tag) => (
                  <Link
                    key={tag}
                    to={`/pages?tag=${encodeURIComponent(tag)}`}
                    className="border border-line px-1.5 py-0.5 lowercase text-graphite hover:border-cyan hover:text-cyan"
                  >
                    {tag}
                  </Link>
                ))}
              </span>
            </>
          ) : null}
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-12">
        <article className="min-w-0 lg:col-span-8">
          {html.trim() ? (
            <Markdown html={html} />
          ) : (
            <p className="font-mono text-[0.76rem] text-graphite">This page has no body yet.</p>
          )}
        </article>

        <aside className="space-y-4 lg:col-span-4">
          <section className="border border-line bg-surface/30" aria-labelledby="backlinks-heading">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 id="backlinks-heading" className="font-display text-[0.82rem] font-semibold text-ghost">
                Linked from
              </h2>
              <span className="font-mono text-[0.62rem] text-graphite">{backlinks.length}</span>
            </div>
            {backlinks.length ? (
              <ul className="divide-y divide-line-soft">
                {backlinks.map((link) => (
                  <li key={link.fromId}>
                    <Link
                      to={`/page/${link.fromId}`}
                      className="group flex items-center gap-2 px-4 py-2 text-[0.8rem] text-ghost hover:bg-surface/60"
                    >
                      <LinkIcon size={12} className="shrink-0 text-graphite group-hover:text-cyan" />
                      <span className="truncate group-hover:text-cyan">{link.fromTitle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 font-mono text-[0.68rem] leading-relaxed text-graphite">
                No pages link here yet.
              </p>
            )}
          </section>

          <section className="border border-line bg-surface/30" aria-labelledby="mentions-heading">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 id="mentions-heading" className="font-display text-[0.82rem] font-semibold text-ghost">
                Mentions, not links
              </h2>
              <span className="font-mono text-[0.62rem] text-graphite">
                {links.data?.unlinked.length ?? 0}
              </span>
            </div>
            {links.data && links.data.unlinked.length > 0 ? (
              <ul className="divide-y divide-line-soft">
                {links.data.unlinked.slice(0, 10).map((mention) => (
                  <li key={mention.id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        to={`/page/${mention.id}`}
                        className="truncate text-[0.78rem] text-ghost hover:text-cyan"
                        title={mention.id}
                      >
                        {mention.title}
                      </Link>
                      <button
                        type="button"
                        onClick={() => void linkMention(mention.id)}
                        disabled={!writeMode || linkBusy === mention.id}
                        className="shrink-0 border border-line px-1.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-graphite hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {linkBusy === mention.id ? '…' : 'Link'}
                      </button>
                    </div>
                    <p className="mt-1 line-clamp-2 font-mono text-[0.6rem] leading-relaxed text-graphite">
                      {mention.snippet}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 font-mono text-[0.68rem] leading-relaxed text-graphite">
                Every mention already links here. Nice.
              </p>
            )}
          </section>

          <section className="border border-line bg-surface/30" aria-labelledby="related-heading">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 id="related-heading" className="font-display text-[0.82rem] font-semibold text-ghost">
                Related
              </h2>
              <span className="font-mono text-[0.62rem] text-graphite">
                {links.data?.related.length ?? 0}
              </span>
            </div>
            {links.data && links.data.related.length > 0 ? (
              <ul className="divide-y divide-line-soft">
                {links.data.related.map((related) => (
                  <li key={related.id} className="px-4 py-2.5">
                    <Link
                      to={`/page/${related.id}`}
                      className="text-[0.8rem] text-ghost hover:text-cyan"
                    >
                      {related.title}
                    </Link>
                    {related.summary ? (
                      <p className="mt-0.5 line-clamp-1 font-mono text-[0.6rem] text-graphite">
                        {related.summary}
                      </p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {related.reasons.map((reason) => (
                        <Badge key={reason} tone={reason === 'tag' ? 'cyan' : 'default'}>
                          {REASON_LABEL[reason]}
                          {reason === 'tag' && related.sharedTags.length
                            ? `: ${related.sharedTags.slice(0, 2).join(', ')}`
                            : ''}
                        </Badge>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 font-mono text-[0.68rem] leading-relaxed text-graphite">
                Nothing shares tags, links, or sources yet.
              </p>
            )}
          </section>

          <section className="border border-line bg-surface/30" aria-labelledby="sources-heading">
            <div className="border-b border-line px-4 py-2.5">
              <h2 id="sources-heading" className="font-display text-[0.82rem] font-semibold text-ghost">
                Sources
              </h2>
            </div>
            <div className="px-4 py-3">
              <SectionLabel>{frontmatter.sources.length} cited</SectionLabel>
              {frontmatter.sources.length ? (
                <ul className="space-y-1.5">
                  {frontmatter.sources.map((source) => (
                    <li
                      key={source}
                      className="break-all border-l border-line pl-2 font-mono text-[0.68rem] leading-relaxed text-graphite"
                    >
                      {source}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="font-mono text-[0.68rem] text-graphite">No source files recorded.</p>
              )}
            </div>
          </section>

          <section className="border border-line bg-surface/30 px-4 py-3">
            <SectionLabel>Page record</SectionLabel>
            <dl className="space-y-1.5 font-mono text-[0.66rem]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-graphite">category</dt>
                <dd className="text-ghost">{category}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-graphite">id</dt>
                <dd className="truncate text-ghost" title={id}>
                  {id}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-graphite">backlinks</dt>
                <dd className="text-ghost">{backlinks.length}</dd>
              </div>
            </dl>
          </section>

          {writeMode ? (
            <section className="border border-line bg-surface/30 px-4 py-3" aria-labelledby="admin-heading">
              <h2 id="admin-heading" className="mb-2 font-display text-[0.82rem] font-semibold text-ghost">
                Page actions
              </h2>
              {adminError ? (
                <p className="mb-2 border border-danger/30 bg-danger/5 px-2 py-1 font-mono text-[0.62rem] text-danger">
                  {adminError}
                </p>
              ) : null}

              <label className="mb-1 block font-mono text-[0.6rem] uppercase tracking-[0.12em] text-graphite">
                rename to
              </label>
              <div className="mb-3 flex gap-1.5">
                <input
                  value={renameTo}
                  onChange={(event) => setRenameTo(event.target.value)}
                  placeholder="concepts/new-id"
                  className="field min-w-0 flex-1 font-mono text-[0.68rem]"
                />
                <button
                  type="button"
                  onClick={() => void rename()}
                  disabled={!renameTo.trim()}
                  className="border border-line px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-graphite hover:border-cyan hover:text-cyan disabled:opacity-40"
                >
                  Move
                </button>
              </div>

              <label className="mb-1 block font-mono text-[0.6rem] uppercase tracking-[0.12em] text-graphite">
                merge into
              </label>
              <div className="mb-3 flex gap-1.5">
                <input
                  value={mergeTarget}
                  onChange={(event) => setMergeTarget(event.target.value)}
                  placeholder="concepts/target-id"
                  className="field min-w-0 flex-1 font-mono text-[0.68rem]"
                />
                <button
                  type="button"
                  onClick={() => void merge()}
                  disabled={!mergeTarget.trim()}
                  className="inline-flex items-center gap-1 border border-line px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-graphite hover:border-cyan hover:text-cyan disabled:opacity-40"
                >
                  <MergeIcon size={10} /> Merge
                </button>
              </div>

              {confirmDelete ? (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void remove()}
                    className="flex-1 border border-danger/40 bg-danger/10 px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-danger"
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="border border-line px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-graphite"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1 border border-line px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-graphite hover:border-danger hover:text-danger"
                >
                  <TrashIcon size={10} /> Delete page
                </button>
              )}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
