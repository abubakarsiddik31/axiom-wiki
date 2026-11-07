import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api, idFromPath, runAction } from '../api'
import { useAsync, useJobStream, useTitle } from '../hooks'
import { formatDate, pluralize } from '../format'
import {
  Badge,
  ErrorPanel,
  LoadingPage,
  PageHeading,
  SectionLabel,
  Stat,
  Stats,
} from '../components/ui'
import { AlertIcon, CheckIcon } from '../components/Icons'
import type { CitationAuditReport, JobPayload } from '../types'

export function Integrity() {
  const { data, error, loading, reload } = useAsync((signal) => api.integrity(signal), [])
  const config = useAsync((signal) => api.config(signal), [])
  const [report, setReport] = useState<CitationAuditReport | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [auditing, setAuditing] = useState(false)
  const [agentJobId, setAgentJobId] = useState<string | null>(null)
  const agent = useJobStream(agentJobId)
  useTitle('Integrity')

  const writeMode = config.data?.writeMode ?? false
  const agentRunning = agent.job?.status === 'running' || agent.job?.status === 'queued'

  async function runCitations() {
    setAuditing(true)
    setAuditError(null)
    try {
      setReport(await api.citationAudit(false))
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : String(err))
    } finally {
      setAuditing(false)
    }
  }

  async function runAgentLint() {
    setAuditError(null)
    try {
      const { job } = await runAction<JobPayload>('lint', { mode: 'agent' })
      setAgentJobId(job.id)
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : String(err))
    }
  }

  async function resolveContradiction(pagePath: string) {
    setAuditError(null)
    try {
      await runAction('contradiction/resolve', { path: pagePath })
      reload()
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading && !data) return <LoadingPage rows={6} />
  if (error && !data) return <ErrorPanel message={error} onRetry={reload} />
  if (!data) return null

  const { counts, deadLinks, orphans, pagesWithoutSummary, pagesWithoutTags, contradictions } = data

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Integrity"
        title="Link health & citation proofs"
        description="Deterministic checks run against the current Markdown corpus. The citation audit verifies every source locator; the agent lint adds judgement on top."
        actions={
          <Badge tone={counts.deadLinks === 0 ? 'cyan' : 'amber'}>
            {counts.deadLinks === 0 ? 'links clean' : pluralize(counts.deadLinks, 'dead link')}
          </Badge>
        }
      />

      <Stats>
        <Stat label="Pages" value={counts.pages} hint="markdown files" />
        <Stat label="Dead links" value={counts.deadLinks} hint="targets missing on disk" />
        <Stat label="Orphans" value={counts.orphans} hint="no inbound wiki-links" />
        <Stat
          label="Metadata gaps"
          value={counts.pagesWithoutSummary + counts.pagesWithoutTags}
          hint="missing summary or tags"
        />
      </Stats>

      {auditError ? <div className="mb-5"><ErrorPanel message={auditError} /></div> : null}

      <div className="mb-7 grid gap-4 lg:grid-cols-2">
        <section className="border border-line bg-surface/30 p-4" aria-labelledby="links-heading">
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Dead links</SectionLabel>
            <span className="font-mono text-[0.62rem] text-graphite">{deadLinks.length}</span>
          </div>
          <h2 id="links-heading" className="sr-only">
            Dead links
          </h2>
          {deadLinks.length === 0 ? (
            <p className="font-mono text-[0.72rem] text-graphite">Every wiki-link resolves.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-line-soft overflow-auto">
              {deadLinks.map((link) => (
                <li key={`${link.from}-${link.to}`} className="py-2 font-mono text-[0.68rem]">
                  <Link to={`/page/${link.from}`} className="text-ghost hover:text-cyan">
                    {link.from}
                  </Link>
                  <span className="mx-2 text-graphite">→</span>
                  <span className="text-danger">{link.to}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border border-line bg-surface/30 p-4" aria-labelledby="orphans-heading">
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Orphan pages</SectionLabel>
            <span className="font-mono text-[0.62rem] text-graphite">{orphans.length}</span>
          </div>
          <h2 id="orphans-heading" className="sr-only">
            Orphan pages
          </h2>
          {orphans.length === 0 ? (
            <p className="font-mono text-[0.72rem] text-graphite">Every page has an inbound link.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-line-soft overflow-auto">
              {orphans.map((id) => (
                <li key={id} className="py-2 font-mono text-[0.68rem]">
                  <Link to={`/page/${id}`} className="text-ghost hover:text-cyan">
                    {id}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mb-7 grid gap-4 lg:grid-cols-2">
        <MetadataList title="Pages without a summary" paths={pagesWithoutSummary} />
        <MetadataList title="Pages without tags" paths={pagesWithoutTags} />
      </div>

      <section className="mb-7 border border-line bg-surface/30 p-4" aria-labelledby="contradictions-heading">
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>Unresolved contradictions</SectionLabel>
          <span className="font-mono text-[0.62rem] text-graphite">{contradictions.length}</span>
        </div>
        <h2 id="contradictions-heading" className="sr-only">
          Unresolved contradictions
        </h2>
        {contradictions.length === 0 ? (
          <p className="font-mono text-[0.72rem] text-graphite">No contradiction blocks found.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {contradictions.map((item) => (
              <li key={item.path} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link to={`/page/${idFromPath(item.path)}`} className="font-mono text-[0.7rem] text-ghost hover:text-cyan">
                  {item.title}
                </Link>
                <button
                  type="button"
                  disabled={!writeMode}
                  onClick={() => void resolveContradiction(item.path)}
                  className="border border-line px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-graphite hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Mark resolved
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border border-line bg-surface/30 p-4" aria-labelledby="audit-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionLabel>Citation audit</SectionLabel>
            <h2 id="audit-heading" className="font-display text-sm font-semibold text-ghost">
              Verify every footnote locator
            </h2>
            <p className="mt-1 max-w-[70ch] text-[0.8rem] leading-relaxed text-graphite">
              Deterministic check of <code className="font-mono text-cyan">^[source#locator]</code>{' '}
              citations against the raw source files.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void runCitations()}
              disabled={auditing}
              className="inline-flex items-center gap-1.5 border border-cyan/40 bg-cyan/10 px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckIcon size={12} /> {auditing ? 'Auditing…' : 'Run audit'}
            </button>
            <button
              type="button"
              onClick={() => void runAgentLint()}
              disabled={!writeMode || agentRunning}
              className="inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] text-graphite hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              <AlertIcon size={12} /> {agentRunning ? 'Linting…' : 'Agent lint'}
            </button>
          </div>
        </div>

        {report ? (
          <div className="mt-4 border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={report.passed ? 'cyan' : 'danger'}>
                {report.passed ? 'passed' : 'failed'}
              </Badge>
              <span className="font-mono text-[0.66rem] text-graphite">
                {report.totalCitations} citations · {report.verifiedCount} verified ·{' '}
                {report.missingSourceCount} missing sources · {report.unverifiedLocatorCount} bad locators
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[0.64rem] text-graphite">
              <span>uncited paragraphs: {report.uncitedParagraphCount}</span>
              <span>unlisted sources: {report.unlistedFrontmatterCount}</span>
              <span>pages: {report.totalPages}</span>
            </div>
            {report.results.filter((result) => result.status !== 'verified').length > 0 ? (
              <ul className="mt-4 max-h-72 divide-y divide-line-soft overflow-auto">
                {report.results
                  .filter((result) => result.status !== 'verified')
                  .slice(0, 100)
                  .map((result, index) => (
                    <li key={index} className="py-2 font-mono text-[0.66rem]">
                      <span className="text-danger">{result.status}</span>{' '}
                      <span className="text-ghost">{result.citation.pagePath}</span>
                      {result.message ? <span className="text-graphite"> — {result.message}</span> : null}
                    </li>
                  ))}
              </ul>
            ) : null}
            <p className="mt-3 font-mono text-[0.6rem] text-graphite">
              generated {formatDate(report.timestamp)}
            </p>
          </div>
        ) : null}

        {agent.lines.length > 0 ? (
          <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-line pt-4 font-mono text-[0.66rem] leading-relaxed text-graphite">
            {agent.lines.join('\n')}
          </pre>
        ) : null}
        {agent.text ? (
          <div className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-[0.84rem] leading-relaxed text-ghost">
            {agent.text}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function MetadataList({ title, paths }: { title: string; paths: string[] }) {
  return (
    <section className="border border-line bg-surface/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <SectionLabel>{title}</SectionLabel>
        <span className="font-mono text-[0.62rem] text-graphite">{paths.length}</span>
      </div>
      {paths.length === 0 ? (
        <p className="font-mono text-[0.72rem] text-graphite">None.</p>
      ) : (
        <ul className="max-h-52 divide-y divide-line-soft overflow-auto">
          {paths.slice(0, 100).map((path) => {
            const id = idFromPath(path)
            return (
              <li key={path} className="py-1.5 font-mono text-[0.66rem]">
                <Link to={`/page/${id}`} className="text-ghost hover:text-cyan">
                  {id}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
