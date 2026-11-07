import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api, idFromPath } from '../api'
import { useAsync, useTitle } from '../hooks'
import { pluralize } from '../format'
import { PageHeading, EmptyState, ErrorPanel, LoadingPage, Badge } from '../components/ui'
import { ArrowUpRightIcon, SearchIcon } from '../components/Icons'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Search excerpts come from raw page bodies, so they still contain wiki-link,
 * citation, and emphasis markers. Flatten them to readable prose before
 * highlighting.
 */
function cleanSnippet(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*\|/.test(line))
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replace(/^\s{0,3}>\s?/, ''),
    )
    .join(' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]{0,2}/g, (_match, id: string, alias?: string) =>
      (alias ?? id).trim(),
    )
    .replace(/\^\[[^\]]*\]?/g, '')
    .replace(/[*`]/g, '')
    .replace(/\s>\s+/g, ' ')
    .replace(/\s#{1,6}\s+/g, ' ')
    .replace(/\s#+\s*$/, '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/\s*·[^·]*$/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim()
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim()
  if (!needle) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeRegExp(needle)})`, 'ig'))
  const lower = needle.toLowerCase()
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === lower ? (
          <mark key={index} className="bg-cyan/20 px-0.5 text-ghost">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  )
}

export function Search() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const [text, setText] = useState(query)
  const committed = useRef(query)

  // Pick up navigation from the sidebar / back button.
  useEffect(() => {
    if (query !== committed.current) {
      committed.current = query
      setText(query)
    }
  }, [query])

  // Instant search: commit the box to the URL after a short pause.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = text.trim()
      if (trimmed === committed.current) return
      committed.current = trimmed
      const next = new URLSearchParams(params)
      if (trimmed) next.set('q', trimmed)
      else next.delete('q')
      setParams(next, { replace: true })
    }, 300)
    return () => window.clearTimeout(timer)
    // `params` is intentionally read from the latest render, not tracked: its
    // updates come from this effect and would restart the timer forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const { data, error, loading, reload } = useAsync(
    (signal) =>
      query
        ? api.search(query, signal)
        : Promise.resolve({ query: '', results: [] }),
    [query],
  )

  const results = data?.results ?? []
  useTitle(query ? `Search: ${query}` : 'Search')

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Hybrid search"
        title="Search the wiki"
        description="Lexical and semantic matches, section by section — the same index the CLI query command uses."
      />

      <div className="relative mb-6">
        <SearchIcon
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-graphite"
        />
        <input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search pages, sections, entities…"
          className="field h-11 pl-10 text-[0.9rem]"
          autoFocus
          autoComplete="off"
          aria-label="Search query"
        />
      </div>

      {error ? <ErrorPanel message={error} onRetry={reload} /> : null}

      {!query && !error ? (
        <EmptyState title="Start typing">
          Search runs across every page and section. Press{' '}
          <kbd className="border border-line px-1 font-mono text-[0.66rem] text-ghost">/</kbd> from any
          page to focus the search box.
        </EmptyState>
      ) : null}

      {query && loading ? <LoadingPage rows={4} /> : null}

      {query && !loading && !error ? (
        <>
          <div className="mb-2 flex items-center justify-between border-b border-line pb-2">
            <span className="font-mono text-[0.64rem] uppercase tracking-[0.14em] text-graphite">
              {pluralize(results.length, 'result')} for “{query}”
            </span>
            <span className="font-mono text-[0.6rem] text-graphite">limit 25</span>
          </div>

          {results.length === 0 ? (
            <EmptyState title="No matches">
              Nothing in the wiki matched <span className="font-mono text-ghost">“{query}”</span>. Try
              a broader term or a tag.
            </EmptyState>
          ) : (
            <ol className="divide-y divide-line border border-line">
              {results.map((result, index) => {
                const id = idFromPath(result.path)
                const anchor = result.sectionAnchor ? `#${result.sectionAnchor}` : ''
                return (
                  <li key={`${result.path}-${result.sectionAnchor ?? index}`}>
                    <Link
                      to={`/page/${id}${anchor}`}
                      className="group grid gap-2 px-4 py-3 hover:bg-surface/60 md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-[0.9rem] font-medium text-ghost group-hover:text-cyan">
                            {result.title}
                          </span>
                          {result.sectionTitle ? (
                            <Badge tone="cyan">{result.sectionTitle}</Badge>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-[0.8rem] leading-relaxed text-graphite">
                          <Highlight text={cleanSnippet(result.excerpt || result.summary)} query={query} />
                        </span>
                        <span className="mt-1 block font-mono text-[0.6rem] text-graphite">{id}</span>
                      </span>
                      <span className="flex items-center gap-3 self-start font-mono text-[0.62rem] text-graphite">
                        <span>{pluralize(result.matchCount, 'hit')}</span>
                        <span className="hidden text-ghost group-hover:text-cyan sm:inline">
                          <ArrowUpRightIcon size={13} />
                        </span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ol>
          )}
        </>
      ) : null}
    </div>
  )
}
