import type { WikiGraph } from './graph.js'
import { escapeHtml } from './markdown.js'

/**
 * Renders the wiki graph as a self-contained SVG.
 * Nodes are placed on a circle grouped by category; edges are chords.
 * Deterministic — same graph, same picture.
 */
export function renderGraphSvg(graph: WikiGraph): string {
  const W = 920
  const H = 720
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W, H) / 2 - 70

  const nodes = [...graph.nodes.values()].filter((n) => n.exists)
  const catColor: Record<string, string> = {
    entities: '#3b5bdb',
    concepts: '#0ca678',
    sources: '#f08c00',
    analyses: '#d6336c',
    inbox: '#a78bfa',
  }
  const colorOf = (cat: string) => catColor[cat] ?? '#868e96'

  nodes.sort((a, b) => (a.category + a.id).localeCompare(b.category + b.id))
  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * 2 * Math.PI - Math.PI / 2
    pos.set(n.id, { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) })
  })

  const edges = graph.edges
    .filter((e) => pos.has(e.from) && pos.has(e.to))
    .map((e) => {
      const a = pos.get(e.from)!
      const b = pos.get(e.to)!
      return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"/>`
    })
    .join('\n')

  const circles = nodes
    .map((n) => {
      const p = pos.get(n.id)!
      const orphan = graph.orphans.includes(n.id)
      return `<g>
<title>${escapeHtml(`${n.title} (${n.category})${orphan ? ' — orphan' : ''}`)}</title>
<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${orphan ? 7 : 5}" fill="${colorOf(n.category)}" ${orphan ? 'stroke="currentColor" stroke-width="1.5" stroke-dasharray="2,2"' : ''}/>
<text x="${p.x.toFixed(1)}" y="${(p.y - 11).toFixed(1)}" font-size="9" text-anchor="middle" fill="currentColor" opacity="0.8">${escapeHtml(n.title.slice(0, 24))}</text>
</g>`
    })
    .join('\n')

  const legend = Object.entries(catColor)
    .map(([cat, c], i) => `<g transform="translate(16, ${20 + i * 18})"><circle r="5" cx="6" cy="-3" fill="${c}"/><text x="18" font-size="12" fill="currentColor">${cat}</text></g>`)
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wiki page graph" style="max-width:100%;height:auto;color:inherit">
${edges}
${circles}
${legend}
</svg>`
}
