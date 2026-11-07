import { Link } from 'react-router-dom'

import { api, idFromPath } from '../api'
import { useAsync, useTitle } from '../hooks'
import { formatBytes, formatDate, pluralize } from '../format'
import { PageHeading, ErrorPanel, LoadingPage, EmptyState, Stat, Stats, SectionLabel, Badge } from '../components/ui'
import { ArrowRightIcon, CheckIcon, AlertIcon, ClockIcon } from '../components/Icons'

export function Overview() {
  const { data, error, loading, reload } = useAsync((signal) => api.overview(signal), [])
  useTitle('Overview')

  if (loading) return <LoadingPage rows={6} />
  if (error) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null

  const { status, recent } = data
  const categories = Object.entries(status.pagesByCategory).sort((a, b) => b[1] - a[1])
  const maxCount = Math.max(1, ...categories.map(([, count]) => count))
  const health = status.semanticHealth

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Wiki overview"
        title="Knowledge at a glance"
        description="Every page, source, and link in this wiki — read fresh from disk on each request."
        actions={
          <Badge tone={health?.status === 'healthy' ? 'cyan' : health?.status === 'stale' ? 'amber' : 'default'}>
            {health ? `semantic ${health.status}` : 'semantic disabled'}
          </Badge>
        }
      />

      <Stats>
        <Stat label="Pages" value={status.totalPages} hint={pluralize(categories.length, 'category', 'categories')} />
        <Stat label="Raw sources" value={status.rawSourceCount} hint="in raw/" />
        <Stat label="Wiki size" value={formatBytes(status.wikiSizeBytes)} hint="markdown on disk" />
        <Stat
          label="Last ingest"
          value={<span className="font-mono text-sm">{formatDate(status.lastIngest)}</span>}
          hint={status.lastIngest ? 'most recent compilation' : 'nothing ingested yet'}
        />
      </Stats>

      {status.totalPages === 0 ? (
        <EmptyState title="This wiki is empty">
          Add documents to <code className="font-mono text-[0.78rem] text-cyan">raw/</code> and run{' '}
          <code className="font-mono text-[0.78rem] text-cyan">axiom-wiki ingest</code>, then refresh this page.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <section className="border border-line bg-surface/30 lg:col-span-7" aria-labelledby="categories-heading">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="categories-heading" className="font-display text-sm font-semibold text-ghost">
                Pages by category
              </h2>
              <Link
                to="/pages"
                className="inline-flex items-center gap-1 font-mono text-[0.64rem] uppercase tracking-[0.12em] text-graphite hover:text-cyan"
              >
                All pages <ArrowRightIcon size={11} />
              </Link>
            </div>
            <div className="divide-y divide-line-soft">
              {categories.map(([category, count]) => (
                <Link
                  key={category}
                  to={`/pages?cat=${encodeURIComponent(category)}`}
                  className="group grid grid-cols-[120px_minmax(0,1fr)_44px] items-center gap-3 px-4 py-2.5 hover:bg-surface/60"
                >
                  <span className="truncate font-mono text-[0.72rem] text-ghost group-hover:text-cyan">
                    {category || 'uncategorised'}
                  </span>
                  <span className="h-1.5 bg-line" aria-hidden="true">
                    <span
                      className="block h-full bg-cyan/70 transition-all group-hover:bg-cyan"
                      style={{ width: `${Math.max(4, (count / maxCount) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right font-mono text-[0.72rem] text-graphite">{count}</span>
                </Link>
              ))}
              {categories.length === 0 ? (
                <p className="px-4 py-6 font-mono text-[0.72rem] text-graphite">no categories yet</p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 divide-x divide-line-soft border-t border-line">
              <div className="flex items-center gap-2 px-4 py-2.5 font-mono text-[0.64rem] text-graphite">
                <ClockIcon size={12} />
                last query {formatDate(status.lastQuery)}
              </div>
              <div className="flex items-center gap-2 px-4 py-2.5 font-mono text-[0.64rem] text-graphite">
                {health?.status === 'healthy' ? (
                  <CheckIcon size={12} className="text-cyan" />
                ) : (
                  <AlertIcon size={12} className="text-amber" />
                )}
                {health?.model ? `${health.provider} / ${health.model}` : 'embeddings not configured'}
              </div>
            </div>
          </section>

          <section className="border border-line bg-surface/30 lg:col-span-5" aria-labelledby="recent-heading">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="recent-heading" className="font-display text-sm font-semibold text-ghost">
                Recently updated
              </h2>
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-graphite">top 10</span>
            </div>
            <ol className="divide-y divide-line-soft">
              {recent.map((page, index) => {
                const id = idFromPath(page.path)
                return (
                  <li key={page.path}>
                    <Link to={`/page/${id}`} className="group flex gap-3 px-4 py-2.5 hover:bg-surface/60">
                      <span className="mt-0.5 font-mono text-[0.62rem] text-graphite">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.82rem] text-ghost group-hover:text-cyan">
                          {page.title}
                        </span>
                        {page.summary ? (
                          <span className="mt-0.5 block truncate font-mono text-[0.64rem] text-graphite">
                            {page.summary}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 self-center font-mono text-[0.6rem] text-graphite">
                        {page.updatedAt}
                      </span>
                    </Link>
                  </li>
                )
              })}
              {recent.length === 0 ? (
                <li className="px-4 py-6 font-mono text-[0.72rem] text-graphite">no pages yet</li>
              ) : null}
            </ol>
            <div className="border-t border-line px-4 py-3">
              <SectionLabel>Tip</SectionLabel>
              <p className="text-[0.76rem] leading-relaxed text-graphite">
                Press <kbd className="border border-line px-1 font-mono text-[0.62rem] text-ghost">/</kbd> to
                search, or open a page to follow its wiki-links and backlinks.
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
