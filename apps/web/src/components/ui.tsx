import type { ReactNode } from 'react'

import { AlertIcon, ArrowRightIcon } from './Icons'

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-graphite">
      {children}
    </div>
  )
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        {eyebrow ? <SectionLabel>{eyebrow}</SectionLabel> : null}
        <h1 className="font-display text-[1.6rem] font-semibold leading-tight tracking-[-0.02em] text-ghost">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-[70ch] text-[0.86rem] leading-relaxed text-graphite">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function Stats({ children }: { children: ReactNode }) {
  return (
    <div className="mb-7 grid grid-cols-2 divide-x divide-line border border-line bg-surface/30 md:grid-cols-4">
      {children}
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="px-4 py-3">
      <div className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-graphite">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold leading-none tracking-tight text-ghost">
        {value}
      </div>
      {hint ? <div className="mt-1.5 truncate font-mono text-[0.62rem] text-graphite">{hint}</div> : null}
    </div>
  )
}

export function Badge({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'cyan' | 'amber' | 'danger'
}) {
  const tones = {
    default: 'border-line bg-surface text-graphite',
    cyan: 'border-cyan/30 bg-cyan/5 text-cyan',
    amber: 'border-amber/30 bg-amber/5 text-amber',
    danger: 'border-danger/30 bg-danger/5 text-danger',
  } as const
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.08em] ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

export function LoadingPage({ rows = 5 }: { rows?: number }) {
  return (
    <div className="fade-up" role="status" aria-label="Loading">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-8 w-2/3" />
      <Skeleton className="mt-3 h-3 w-1/2" />
      <div className="mt-8 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="fade-up border border-danger/30 bg-danger/5 p-5">
      <div className="flex items-start gap-3">
        <AlertIcon size={18} className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-ghost">Request failed</h2>
          <p className="mt-1 break-words font-mono text-[0.72rem] leading-relaxed text-graphite">
            {message}
          </p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 border border-line bg-surface px-2.5 py-1 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-ghost hover:border-cyan hover:text-cyan"
            >
              Retry <ArrowRightIcon size={12} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="border border-dashed border-line bg-surface/20 px-6 py-10 text-center">
      <pre className="mx-auto mb-4 w-fit text-left font-mono text-[0.68rem] leading-relaxed text-graphite" aria-hidden="true">
        {`+------------------+
|   no records     |
+------------------+`}
      </pre>
      <h2 className="font-display text-sm font-semibold text-ghost">{title}</h2>
      {children ? (
        <p className="mx-auto mt-1.5 max-w-[52ch] text-[0.82rem] leading-relaxed text-graphite">
          {children}
        </p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

