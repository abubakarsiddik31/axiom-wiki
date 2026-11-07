import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api, idFromPath } from '../api'
import { useAsync, useTitle } from '../hooks'
import { pluralize } from '../format'
import { PageHeading, ErrorPanel, LoadingPage, EmptyState, SectionLabel } from '../components/ui'

export function Pages() {
  const [params, setParams] = useSearchParams()
  const category = params.get('cat') ?? 'all'
  const query = params.get('q') ?? ''

  const { data: pages, error, loading, reload } = useAsync((signal) => api.pages(signal), [])
  useTitle('Pages')

  const categories = useMemo(() => {
    if (!pages) return []
    const counts = new Map<string, number>()
    for (const page of pages) counts.set(page.category, (counts.get(page.category) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [pages])

  const filtered = useMemo(() => {
    if (!pages) return []
    const needle = query.trim().toLowerCase()
    return pages
      .filter((page) => category === 'all' || page.category === category)
      .filter(
        (page) =>
          !needle ||
          page.title.toLowerCase().includes(needle) ||
          page.summary.toLowerCase().includes(needle) ||
          page.tags.some((tag) => tag.toLowerCase().includes(needle)),
      )
      .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
  }, [pages, category, query])

  function update(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (!value || value === 'all') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  if (loading) return <LoadingPage rows={8} />
  if (error) return <ErrorPanel message={error} onRetry={reload} />
  if (!pages) return null

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Library"
        title="All pages"
        description={`${pluralize(pages.length, 'page')} across ${pluralize(categories.length, 'category', 'categories')}. Filter by category or text.`}
      />

      <div className="mb-5 flex flex-col gap-3 border border-line bg-surface/30 p-3 md:flex-row md:items-center">
        <div className="flex flex-1 flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => update('cat', 'all')}
            className={`border px-2 py-1 font-mono text-[0.66rem] uppercase tracking-[0.08em] transition-colors ${
              category === 'all'
                ? 'border-cyan bg-cyan/10 text-cyan'
                : 'border-line bg-surface text-graphite hover:text-ghost'
            }`}
          >
            all {pages.length}
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
            value={query}
            onChange={(event) => update('q', event.target.value)}
            placeholder="Filter title, summary, tag…"
            className="field"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <SectionLabel>
          {filtered.length} of {pages.length} pages
        </SectionLabel>
        {query || category !== 'all' ? (
          <button
            type="button"
            onClick={() => setParams({}, { replace: true })}
            className="font-mono text-[0.64rem] uppercase tracking-[0.1em] text-graphite hover:text-cyan"
          >
            clear filters
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No pages match">
          Try a different category, or clear the filter to see all {pages.length} pages.
        </EmptyState>
      ) : (
        <div className="border border-line">
          <div className="hidden grid-cols-[minmax(0,1fr)_150px_96px] gap-4 border-b border-line bg-surface/50 px-4 py-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-graphite md:grid">
            <span>Page</span>
            <span>Category</span>
            <span className="text-right">Updated</span>
          </div>
          <ul className="divide-y divide-line-soft">
            {filtered.map((page) => {
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
