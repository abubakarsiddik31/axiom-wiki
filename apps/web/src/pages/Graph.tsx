import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import { useAsync, useTitle } from '../hooks'
import { pluralize } from '../format'
import { PageHeading, EmptyState, ErrorPanel, LoadingPage, SectionLabel } from '../components/ui'
import { FitIcon, ZoomInIcon, ZoomOutIcon } from '../components/Icons'

const CATEGORY_COLOR: Record<string, string> = {
  entities: '#06b6d4',
  concepts: '#22d3ee',
  sources: '#f59e0b',
  analyses: '#a78bfa',
}

function colorOf(category: string): string {
  return CATEGORY_COLOR[category] ?? '#71717a'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function Graph() {
  const navigate = useNavigate()
  const { data: graph, error, loading, reload } = useAsync(
    (signal) => api.graph({ limit: 1200 }, signal),
    [],
  )
  useTitle('Graph')
  const [hovered, setHovered] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef({ active: false, x: 0, y: 0, panX: 0, panY: 0, moved: false })

  const layout = useMemo(() => {
    const nodes = (graph?.nodes ?? [])
      .filter((node) => node.exists)
      .sort((a, b) => (a.category + a.id).localeCompare(b.category + b.id))
    const width = 960
    const height = 680
    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) / 2 - 86
    const positions = new Map<string, { x: number; y: number }>()
    nodes.forEach((node, index) => {
      const angle = (index / Math.max(nodes.length, 1)) * 2 * Math.PI - Math.PI / 2
      positions.set(node.id, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      })
    })
    return { nodes, positions, width, height, cx, cy }
  }, [graph])

  if (loading) return <LoadingPage rows={6} />
  if (error) return <ErrorPanel message={error} onRetry={reload} />
  if (!graph) return null

  const orphans = new Set(graph.orphans)
  const edges = graph.edges.filter(
    (edge) => layout.positions.has(edge.from) && layout.positions.has(edge.to),
  )
  const categoryCounts = new Map<string, number>()
  for (const node of layout.nodes) {
    categoryCounts.set(node.category, (categoryCounts.get(node.category) ?? 0) + 1)
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    drag.current = {
      active: true,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drag.current.active) return
    const dx = event.clientX - drag.current.x
    const dy = event.clientY - drag.current.y
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true
    setPan({ x: drag.current.panX + dx, y: drag.current.panY + dy })
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    drag.current.active = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function activate(id: string) {
    if (drag.current.moved) return
    navigate(`/page/${id}`)
  }

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Link graph"
        title="Page graph"
        description={`${pluralize(graph.totalNodes, 'page')} · ${pluralize(graph.totalEdges, 'link')} · ${pluralize(graph.orphanCount, 'orphan')} · ${pluralize(graph.deadLinkCount, 'dead link')}`}
        actions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setZoom((value) => clamp(value * 1.2, 0.5, 3))}
              className="grid h-8 w-8 place-items-center border border-line bg-surface text-graphite hover:border-cyan hover:text-cyan"
              aria-label="Zoom in"
            >
              <ZoomInIcon size={15} />
            </button>
            <button
              type="button"
              onClick={() => setZoom((value) => clamp(value / 1.2, 0.5, 3))}
              className="grid h-8 w-8 place-items-center border border-line bg-surface text-graphite hover:border-cyan hover:text-cyan"
              aria-label="Zoom out"
            >
              <ZoomOutIcon size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1)
                setPan({ x: 0, y: 0 })
              }}
              className="grid h-8 w-8 place-items-center border border-line bg-surface text-graphite hover:border-cyan hover:text-cyan"
              aria-label="Reset view"
            >
              <FitIcon size={15} />
            </button>
          </div>
        }
      />

      {graph.truncated ? (
        <p className="mb-4 border border-amber/30 bg-amber/5 px-3 py-2 font-mono text-[0.68rem] leading-relaxed text-amber">
          Showing the {layout.nodes.length} most-connected pages of {graph.totalNodes}. Open a page to
          inspect its immediate neighbors, or use the API with a <code>focus</code> parameter for a
          full neighborhood.
        </p>
      ) : null}

      {layout.nodes.length === 0 ? (
        <EmptyState title="No pages to plot">Ingest a source to start building the graph.</EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="lg:col-span-9">
            <div className="relative overflow-hidden border border-line bg-surface/20">
              <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-3 font-mono text-[0.62rem] text-graphite">
                {[...categoryCounts.entries()].sort().map(([category, count]) => (
                  <span key={category} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2"
                      style={{ background: colorOf(category) }}
                      aria-hidden="true"
                    />
                    {category} <span className="text-ghost">{count}</span>
                  </span>
                ))}
              </div>

              <svg
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="h-auto w-full cursor-grab touch-none select-none active:cursor-grabbing"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: 'center',
                  transition: drag.current.active ? 'none' : 'transform 140ms ease-out',
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                role="group"
                aria-label="Wiki page link graph"
              >
                <g>
                  {edges.map((edge, index) => {
                    const from = layout.positions.get(edge.from)
                    const to = layout.positions.get(edge.to)
                    if (!from || !to) return null
                    const connected = hovered === edge.from || hovered === edge.to
                    return (
                      <line
                        key={`${edge.from}-${edge.to}-${index}`}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={connected ? '#06b6d4' : '#71717a'}
                        strokeOpacity={hovered ? (connected ? 0.7 : 0.08) : 0.2}
                        strokeWidth={connected ? 1.4 : 1}
                      />
                    )
                  })}
                </g>
                <g>
                  {layout.nodes.map((node) => {
                    const position = layout.positions.get(node.id)
                    if (!position) return null
                    const orphan = orphans.has(node.id)
                    const active = hovered === node.id
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${position.x} ${position.y})`}
                        className="cursor-pointer"
                        onPointerEnter={() => setHovered(node.id)}
                        onPointerLeave={() => setHovered(null)}
                        onClick={() => activate(node.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            navigate(`/page/${node.id}`)
                          }
                        }}
                        role="link"
                        tabIndex={0}
                        aria-label={`${node.title} (${node.category})`}
                      >
                        <title>{`${node.title} (${node.category})${orphan ? ' — orphan' : ''}`}</title>
                        <circle r={14} fill="#000" fillOpacity={0} pointerEvents="all" />
                        <circle
                          r={active ? 8 : orphan ? 5.5 : 4}
                          fill={colorOf(node.category)}
                          fillOpacity={hovered && !active ? 0.35 : 1}
                          stroke={orphan ? '#f59e0b' : 'none'}
                          strokeWidth={orphan ? 1 : 0}
                          strokeDasharray={orphan ? '2 2' : undefined}
                        />
                        {layout.nodes.length <= 300 || active || zoom > 1.4 ? (
                          <text
                            y={-10}
                            textAnchor="middle"
                            fontSize={9}
                            fill={active ? '#f4f4f5' : '#a1a1aa'}
                            opacity={hovered && !active ? 0.35 : 0.9}
                            className="pointer-events-none font-mono"
                          >
                            {node.title.length > 24 ? `${node.title.slice(0, 23)}…` : node.title}
                          </text>
                        ) : null}
                      </g>
                    )
                  })}
                </g>
              </svg>
              <p className="pointer-events-none absolute bottom-3 left-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-graphite">
                drag to pan · click a node to open · dashed = orphan
              </p>
            </div>
          </div>

          <aside className="space-y-4 lg:col-span-3">
            <section className="border border-line bg-surface/30 px-4 py-3">
              <SectionLabel>Structure</SectionLabel>
              <dl className="space-y-1.5 font-mono text-[0.68rem]">
                <div className="flex justify-between gap-3">
                  <dt className="text-graphite">nodes</dt>
                  <dd className="text-ghost">
                    {layout.nodes.length}
                    {graph.truncated ? ` / ${graph.totalNodes}` : ''}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-graphite">edges</dt>
                  <dd className="text-ghost">
                    {edges.length}
                    {graph.truncated ? ` / ${graph.totalEdges}` : ''}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-graphite">orphans</dt>
                  <dd className="text-ghost">{graph.orphanCount}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-graphite">dead links</dt>
                  <dd className="text-ghost">{graph.deadLinkCount}</dd>
                </div>
              </dl>
            </section>

            <section className="border border-line bg-surface/30" aria-labelledby="dead-links-heading">
              <div className="border-b border-line px-4 py-2.5">
                <h2
                  id="dead-links-heading"
                  className="font-display text-[0.82rem] font-semibold text-ghost"
                >
                  Dead links
                </h2>
              </div>
              {graph.deadLinks.length ? (
                <ul className="divide-y divide-line-soft">
                  {graph.deadLinks.slice(0, 12).map((link, index) => (
                    <li
                      key={`${link.from}-${link.to}-${index}`}
                      className="px-4 py-2 font-mono text-[0.64rem] leading-relaxed"
                    >
                      <span className="text-ghost">{link.from}</span>
                      <span className="mx-1 text-graphite">→</span>
                      <span className="text-amber">{link.to}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-4 font-mono text-[0.66rem] text-graphite">
                  {graph.deadLinkCount ? 'No dead links in this view.' : 'No dead links.'}
                </p>
              )}
              {graph.deadLinkCount > 12 ? (
                <p className="border-t border-line px-4 py-2 font-mono text-[0.62rem] text-graphite">
                  +{graph.deadLinkCount - 12} more
                </p>
              ) : null}
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}
