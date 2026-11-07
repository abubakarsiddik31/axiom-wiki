import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

import type { PageMeta } from './wiki.js'
import { dirSize } from './wiki.js'
import { extractLinks, type GraphEdge, type GraphNode, type WikiGraph } from './graph.js'

/**
 * One pass over `wiki/pages` that produces both the page list and the link
 * graph. The old read path walked and parsed the corpus once per consumer
 * (`listPages`, `buildGraph`, `getBacklinks`), which made every request O(N).
 */
export interface WikiSnapshot {
  pages: PageMeta[]
  graph: WikiGraph
  /** Total size of `wiki/`, precomputed so status reads stay O(1). */
  wikiSizeBytes: number
  /** Existing page ids ordered by degree (desc), then by a stable hash. */
  rankedIds: string[]
}

function hashId(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function walkDir(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkDir(full))
    else files.push(full)
  }
  return files
}

export function buildWikiSnapshot(wikiDir: string): WikiSnapshot {
  const pages: PageMeta[] = []
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []

  const pagesDir = path.join(wikiDir, 'wiki/pages')
  const wikiSizeBytes = dirSize(path.join(wikiDir, 'wiki'))
  if (!fs.existsSync(pagesDir)) {
    return { pages, graph: { nodes, edges, orphans: [], deadLinks: [] }, wikiSizeBytes, rankedIds: [] }
  }

  for (const abs of walkDir(pagesDir)) {
    if (!abs.endsWith('.md')) continue

    const rel = path.relative(wikiDir, abs)
    const id = rel.replace(/^wiki\/pages\//, '').replace(/\.md$/, '')
    const raw = fs.readFileSync(abs, 'utf-8')

    let data: Record<string, unknown> = {}
    let content = raw
    try {
      const parsed = matter(raw)
      data = parsed.data as Record<string, unknown>
      content = parsed.content
    } catch {
      // Keep the page visible even if its YAML is malformed.
    }

    let updatedAt = ''
    try {
      updatedAt = fs.statSync(abs).mtime.toISOString().slice(0, 10)
    } catch {
      /* keep empty — the file may have vanished mid-scan */
    }

    const title = String(data['title'] ?? path.basename(abs, '.md'))
    const fallbackCategory = rel.split('/')[2] ?? ''

    pages.push({
      path: rel,
      title,
      summary: String(data['summary'] ?? ''),
      tags: Array.isArray(data['tags']) ? (data['tags'] as unknown[]).map(String) : [],
      category: String(data['category'] ?? fallbackCategory),
      updatedAt: String(data['updatedAt'] ?? updatedAt),
    })

    nodes.set(id, {
      path: rel,
      id,
      title,
      category: id.split('/')[0] ?? 'unknown',
      exists: true,
    })

    for (const targetId of extractLinks(content)) {
      edges.push({ from: id, to: targetId })
    }
  }

  for (const edge of edges) {
    if (nodes.has(edge.to)) continue
    nodes.set(edge.to, {
      path: `wiki/pages/${edge.to}.md`,
      id: edge.to,
      title: path.basename(edge.to),
      category: edge.to.split('/')[0] ?? 'unknown',
      exists: false,
    })
  }

  const inbound = new Map<string, number>()
  const degree = new Map<string, number>()
  for (const edge of edges) {
    inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1)
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }

  const orphans: string[] = []
  for (const [id, node] of nodes) {
    if (node.exists && (inbound.get(id) ?? 0) === 0) orphans.push(id)
  }

  const rankedIds = [...nodes.values()]
    .filter((node) => node.exists)
    .sort(
      (a, b) =>
        (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || hashId(a.id) - hashId(b.id),
    )
    .map((node) => node.id)

  return {
    pages,
    graph: { nodes, edges, orphans, deadLinks: edges.filter((edge) => !isExisting(nodes, edge)) },
    wikiSizeBytes,
    rankedIds,
  }
}

function isExisting(nodes: Map<string, GraphNode>, edge: GraphEdge): boolean {
  // A dead link is an edge whose target has no page on disk. The placeholder
  // node is added above, so `path` is the cheapest reliable discriminator.
  return nodes.get(edge.to)?.exists ?? false
}
