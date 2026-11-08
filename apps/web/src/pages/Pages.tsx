import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api, idFromPath } from '../api'
import { useAsync, useTitle } from '../hooks'
import { pluralize } from '../format'
import { PageHeading, ErrorPanel, LoadingPage, EmptyState, SectionLabel } from '../components/ui'
import { ArrowRightIcon, PlusIcon } from '../components/Icons'

const LIMIT = 100

export function Pages() {
  const [params, setParams] = useSearchParams()
  const category = params.get('cat') ?? ''
  const tag = params.get('tag') ?? ''
  const query = params.get('q') ?? ''
  const cursor = params.get('cursor') ?? ''
  const sort = (params.get('sort') as 'category' | 'title' | 'updated' | null) ?? 'category'

  const [text, setText] = useState(query)
  const committed = useRef(query)
  useTitle('Pages')

  // Pick up navigation from links / back button.
  useEffect(() => {
    if (query !== committed.current) {
      committed.current = query
      setText(query)
    }
  }, [query])

  // Debounce the text filter into the URL so each keystroke is not a request.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = text.trim()
      if (trimmed === committed.current) return
      committed.current = trimmed
      const next = new URLSearchParams(params)
      if (trimmed) next.set('q', trimmed)
      else next.delete('q')
      next.delete('cursor')
      setParams(next, { replace: true })
    }, 250)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const { data, error, loading, reload } = useAsync(
    (signal) => api.pages({ cat: category, tag, q: query, cursor, limit: LIMIT, sort }, signal),
    [category, tag, query, cursor, sort],
  )

  function update(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (!value || value === 'all') next.delete(key)
    else next.set(key, value)
    next.delete('cursor')
    setParams(next, { replace: true })
  }

  function goToOffset(offset: number) {
    const next = new URLSearchParams(params)
    if (offset <= 0) next.delete('cursor')
    else next.set('cursor', String(offset))
    setParams(next, { replace: true })
  }

  if (loading && !data) return <LoadingPage rows={8} />
  if (error && !data) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null

  const facets = data.facets.categories
  const categories = Object.entries(facets).sort((a, b) => a[0].localeCompare(b[0]))
  const tagFacets = Object.entries(data.facets.tags ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
  const allCount = Object.values(facets).reduce((sum, count) => sum + count, 0)
  const offset = Number(cursor) || 0
  const from = data.pages.length ? offset + 1 : 0
  const to = offset + data.pages.length

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Library"
        title="All pages"
        description={`${pluralize(allCount, 'page')} across ${pluralize(categories.length, 'category', 'categories')}. Filter by category, tag, or text; results are paged.`}
        actions={
          <Link
            to="/new"
            className="inline-flex items-center gap-1.5 border border-cyan/40 bg-cyan/10 px-2.5 py-1 font-mono text-[0.64rem] uppercase tracking-[0.1em] text-cyan hover:bg-cyan/15"
          >
            <PlusIcon size={11} /> New page
          </Link>
        }
      />

      {error && data ? <ErrorPanel message={error} onRetry={reload} /> : null}

      <div className="mb-5 flex flex-col gap-3 border border-line bg-surface/30 p-3 md:flex-row md:items-center">
        <div className="flex flex-1 flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => update('cat', 'all')}
            className={`border px-2 py-1 font-mono text-[0.66rem] uppercase tracking-[0.08em] transition-colors ${
              !category
                ? 'border-cyan bg-cyan/10 text-cyan'
                : 'border-line bg-surface text-graphite hover:text-ghost'
            }`}
          >
            all {allCount}
          </button>
          {categories.map(([name, count]) => (
            <button
              key={name}
              type="button"
              onClick={() => update('cat', name)}
              className={`border px-2 py-1 font-mono text-[0.66rem] uppercase tracking-[0.08em] transition-colors ${
                category === name
                  ? 'border-cyan bg-cyan/10 text-cyan'
                  : 'border-line bg-surface text-graphite hover:text-ghost'
              }`}
            >
              {name || 'uncategorised'} {count}
            </button>
          ))}
        </div>
        <div className="md:w-64">
          <label htmlFor="page-filter" className="sr-only">
            Filter pages
          </label>
          <input
            id="page-filter"
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Filter title, summary, tag…"
            className="field"
            autoComplete="off"
          />
        </div>
      </div>

      {tagFacets.length > 0 ? (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-graphite">
            tags
          </span>
          {tag && (
            <button
              type="button"
              onClick={() => update('tag', '')}
              className="border border-cyan bg-cyan/10 px-2 py-0.5 font-mono text-[0.62rem] text-cyan"
            >
              {tag} ×
            </button>
          )}
          {tagFacets
            .filter(([name]) => name !== tag)
            .map(([name, count]) => (
              <button
                key={name}
                type="button"
                onClick={() => update('tag', name)}
                className="border border-line bg-surface px-2 py-0.5 font-mono text-[0.62rem] text-graphite transition-colors hover:border-cyan hover:text-cyan"
              >
                {name} <span className="text-graphite/70">{count}</span>
              </button>
            ))}
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>
          {data.pages.length ? `${from}–${to} of ${data.total}` : `0 of ${data.total}`} matching pages
        </SectionLabel>
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(event) => update('sort', event.target.value)}
            className="field w-auto py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em]"
            aria-label="Sort pages"
          >
            <option value="category">by category</option>
            <option value="title">by title</option>
            <option value="updated">recently updated</option>
          </select>
          {loading ? (
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-graphite">
              loading…
            </span>
          ) : null}
          <button
            type="button"
            disabled={offset <= 0 || loading}
            onClick={() => goToOffset(Math.max(0, offset - LIMIT))}
            className="border border-line bg-surface px-2 py-1 font-mono text-[0.64rem] uppercase tracking-[0.08em] text-graphite hover:text-ghost disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={!data.nextCursor || loading}
            onClick={() => data.nextCursor && goToOffset(Number(data.nextCursor))}
            className="inline-flex items-center gap-1 border border-line bg-surface px-2 py-1 font-mono text-[0.64rem] uppercase tracking-[0.08em] text-graphite hover:text-ghost disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next <ArrowRightIcon size={11} />
          </button>
          {query || category || tag || offset > 0 ? (
            <button
              type="button"
              onClick={() => setParams({}, { replace: true })}
              className="font-mono text-[0.64rem] uppercase tracking-[0.1em] text-graphite hover:text-cyan"
            >
              clear
            </button>
          ) : null}
        </div>
      </div>

      {data.pages.length === 0 ? (
        <EmptyState title="No pages match">
          Try a different category, or clear the filter to see all pages.
        </EmptyState>
      ) : (
        <div className="border border-line">
          <div className="hidden grid-cols-[minmax(0,1fr)_150px_96px] gap-4 border-b border-line bg-surface/50 px-4 py-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-graphite md:grid">
            <span>Page</span>
            <span>Category</span>
            <span className="text-right">Updated</span>
          </div>
          <ul className="divide-y divide-line-soft">
            {data.pages.map((page) => {
              const id = idFromPath(page.path)
              return (
                <li key={page.path}>
                  <Link
                    to={`/page/${id}`}
                    className="group grid gap-1 px-4 py-2.5 hover:bg-surface/60 md:grid-cols-[minmax(0,1fr)_150px_96px] md:items-center md:gap-4"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[0.85rem] text-ghost group-hover:text-cyan">
                        {page.title}
                      </span>
                      {page.summary ? (
                        <span className="mt-0.5 block truncate font-mono text-[0.66rem] leading-relaxed text-graphite">
                          {page.summary}
                        </span>
                      ) : null}
                      {page.tags.length ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {page.tags.slice(0, 4).map((tag) => (
                            <span
                              key={tag}
                              className="border border-line px-1 font-mono text-[0.58rem] text-graphite"
                            >
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-mono text-[0.66rem] text-graphite">{page.category}</span>
                    <span className="font-mono text-[0.62rem] text-graphite md:text-right">
                      {page.updatedAt}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
