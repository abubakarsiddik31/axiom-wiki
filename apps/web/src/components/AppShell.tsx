import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { api } from '../api'
import { useAsync } from '../hooks'
import { formatDate, pluralize } from '../format'
import {
  AskIcon,
  CloseIcon,
  DatabaseIcon,
  DiamondIcon,
  GraphIcon,
  MenuIcon,
  OverviewIcon,
  PagesIcon,
  SearchIcon,
  ShieldIcon,
  SlidersIcon,
} from './Icons'
import { JobTrayLive } from './JobTray'

const NAV = [
  { to: '/', label: 'Overview', icon: OverviewIcon, end: true },
  { to: '/pages', label: 'Pages', icon: PagesIcon, end: false },
  { to: '/ask', label: 'Ask', icon: AskIcon, end: false },
  { to: '/sources', label: 'Sources', icon: DatabaseIcon, end: false },
  { to: '/graph', label: 'Graph', icon: GraphIcon, end: false },
  { to: '/integrity', label: 'Integrity', icon: ShieldIcon, end: false },
  { to: '/settings', label: 'Settings', icon: SlidersIcon, end: false },
] as const

function navClass(isActive: boolean): string {
  return [
    'group flex items-center gap-3 border-l-2 px-4 py-2.5 text-[0.82rem] transition-colors',
    isActive
      ? 'border-cyan bg-cyan/5 text-ghost'
      : 'border-transparent text-graphite hover:border-line hover:bg-surface/60 hover:text-ghost',
  ].join(' ')
}

function SearchForm({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')

  // On the search page, keep the sidebar box in sync with the URL.
  useEffect(() => {
    if (location.pathname === '/search') {
      setValue(new URLSearchParams(location.search).get('q') ?? '')
    }
  }, [location.pathname, location.search])

  // Press "/" anywhere outside a field to jump to search.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        const q = value.trim()
        if (!q) return
        navigate(`/search?q=${encodeURIComponent(q)}`)
        onNavigate?.()
      }}
      className="px-4 py-3"
    >
      <label htmlFor="sidebar-search" className="sr-only">
        Search the wiki
      </label>
      <div className="relative">
        <SearchIcon
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-graphite"
        />
        <input
          ref={inputRef}
          id="sidebar-search"
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Search"
          className="field pl-8 pr-8"
          autoComplete="off"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 border border-line px-1 font-mono text-[0.6rem] text-graphite">
          /
        </kbd>
      </div>
    </form>
  )
}

function SidebarStatus({
  totalPages,
  totalSources,
  lastIngest,
  health,
}: {
  totalPages: number
  totalSources: number
  lastIngest: string | null
  health?: { status: string; provider: string; model: string | null }
}) {
  const dot =
    health?.status === 'healthy'
      ? 'bg-cyan'
      : health?.status === 'stale'
        ? 'bg-amber'
        : 'bg-graphite'
  return (
    <div className="border-t border-line px-4 py-4">
      <div className="flex items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-graphite">
        <span className={`h-1.5 w-1.5 ${dot} ${health?.status === 'healthy' ? 'pulse-dot' : ''}`} />
        {health ? `semantic ${health.status}` : 'semantic off'}
      </div>
      <dl className="mt-3 space-y-1.5 font-mono text-[0.68rem]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-graphite">pages</dt>
          <dd className="text-ghost">{pluralize(totalPages, 'page')}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-graphite">sources</dt>
          <dd className="text-ghost">{totalSources}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-graphite">last ingest</dt>
          <dd className="text-ghost">{formatDate(lastIngest)}</dd>
        </div>
      </dl>
      {health?.provider ? (
        <p className="mt-3 truncate font-mono text-[0.62rem] text-graphite" title={`${health.provider} ${health.model ?? ''}`}>
          {health.provider}
          {health.model ? ` · ${health.model}` : ''}
        </p>
      ) : null}
    </div>
  )
}

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const { data } = useAsync((signal) => api.overview(signal), [])

  useEffect(() => {
    setDrawerOpen(false)
    if (!location.hash) window.scrollTo({ top: 0 })
  }, [location.pathname, location.search, location.hash])

  const status = data?.status

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface/40 lg:flex">
        <LinkBrand />
        <SearchForm />
        <nav aria-label="Primary" className="flex-1 py-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => navClass(isActive)}>
              <Icon size={15} className="shrink-0 opacity-80" />
              {label}
            </NavLink>
          ))}
        </nav>
        <JobTrayLive />
        <SidebarStatus
          totalPages={status?.totalPages ?? 0}
          totalSources={status?.rawSourceCount ?? 0}
          lastIngest={status?.lastIngest ?? null}
          health={status?.semanticHealth}
        />
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-space/95 px-4 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="grid h-8 w-8 place-items-center border border-line text-graphite hover:text-ghost"
          aria-label="Open navigation"
        >
          <MenuIcon size={16} />
        </button>
        <LinkBrand compact />
      </div>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-space/80"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between pr-3">
              <LinkBrand />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="grid h-8 w-8 place-items-center border border-line text-graphite hover:text-ghost"
                aria-label="Close navigation"
              >
                <CloseIcon size={16} />
              </button>
            </div>
            <SearchForm onNavigate={() => setDrawerOpen(false)} />
            <nav aria-label="Primary mobile" className="flex-1 py-1">
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={({ isActive }) => navClass(isActive)}>
                  <Icon size={15} className="shrink-0 opacity-80" />
                  {label}
                </NavLink>
              ))}
            </nav>
            <JobTrayLive />
            <SidebarStatus
              totalPages={status?.totalPages ?? 0}
              totalSources={status?.rawSourceCount ?? 0}
              lastIngest={status?.lastIngest ?? null}
              health={status?.semanticHealth}
            />
          </div>
        </div>
      ) : null}

      <main className="min-w-0 px-5 py-7 lg:px-10 lg:py-9">
        <div className="mx-auto w-full max-w-[1180px]">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function LinkBrand({ compact = false }: { compact?: boolean }) {
  return (
    <NavLink
      to="/"
      end
      className={`flex items-center gap-3 ${compact ? 'gap-2' : 'px-4 py-5'}`}
      aria-label="Axiom Wiki home"
    >
      <DiamondIcon size={compact ? 18 : 22} className="shrink-0 text-cyan" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[0.8rem] font-bold tracking-[0.16em] text-ghost">AXIOM</span>
        <span className="mt-1 font-mono text-[0.55rem] tracking-[0.2em] text-graphite">
          WIKI / LOCAL
        </span>
      </span>
    </NavLink>
  )
}
