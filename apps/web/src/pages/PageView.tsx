import { useEffect, useMemo } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { api } from '../api'
import { useAsync, useTitle } from '../hooks'
import { Markdown } from '../components/Markdown'
import { EmptyState, ErrorPanel, LoadingPage, SectionLabel } from '../components/ui'
import { ArrowRightIcon, LinkIcon } from '../components/Icons'

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

export function PageView() {
  const params = useParams()
  const location = useLocation()
  const id = params['*'] ?? ''
  const valid = isValidId(id)

  const { data, error, loading, reload } = useAsync(
    (signal) =>
      valid
        ? api.page(id, signal)
        : Promise.reject(new Error('Unknown page address.')),
    [id, valid],
  )

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
        <h1 className="font-display text-[1.7rem] font-semibold leading-tight tracking-[-0.025em] text-ghost">
          {frontmatter.title}
        </h1>
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
                    to={`/pages?q=${encodeURIComponent(tag)}`}
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
        </aside>
      </div>
    </div>
  )
}
