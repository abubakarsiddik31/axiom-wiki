import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

export interface GraphNode {
  path: string      // relative to wikiDir, e.g. "wiki/pages/entities/alan-turing.md"
  id: string        // internal id, e.g. "entities/alan-turing"
  title: string
  category: string
  exists: boolean   // false if this is a dead link target
}

export interface GraphEdge {
  from: string      // source node id
  to: string        // target node id
}

export interface WikiGraph {
  nodes: Map<string, GraphNode>
  edges: GraphEdge[]
  orphans: string[]    // list of node ids with no inbound links
  deadLinks: Array<{ from: string, to: string }> // links to non-existent pages
}

/**
 * Extracts wiki-links from content and frontmatter.
 * Format: [[category/page-name]] or [[page-name]] (defaults to entities/)
 */
export function extractLinks(content: string): string[] {
  const links = new Set<string>()
  
  // 1. Extract from [[wiki-links]]
  const wikiLinkRegex = /\[\[([^\]]+)\]\]/g
  let match
  while ((match = wikiLinkRegex.exec(content)) !== null) {
    if (match[1]) {
      links.add(normalizeLinkId(match[1]))
    }
  }

  return Array.from(links)
}

function normalizeLinkId(link: string): string {
  let clean = link.trim().replace(/\\/g, '/')
  // If no category prefix, default to entities/ as per convention
  if (!clean.includes('/')) {
    clean = `entities/${clean}`
  }
  return clean
}

export function buildGraph(wikiDir: string): WikiGraph {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  
  const pagesDir = path.join(wikiDir, 'wiki/pages')
  if (!fs.existsSync(pagesDir)) {
    return { nodes, edges, orphans: [], deadLinks: [] }
  }

  // 1. Find all existing pages
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.name.endsWith('.md')) {
        const relPath = path.relative(wikiDir, fullPath)
        const id = relPath.replace(/^wiki\/pages\//, '').replace(/\.md$/, '')
        const raw = fs.readFileSync(fullPath, 'utf-8')
        const { data, content } = matter(raw)
        
        nodes.set(id, {
          path: relPath,
          id,
          title: String(data['title'] ?? path.basename(entry.name, '.md')),
          category: id.split('/')[0] ?? 'unknown',
          exists: true
        })

        // Extract links from content
        const foundLinks = extractLinks(content)
        for (const targetId of foundLinks) {
          edges.push({ from: id, to: targetId })
        }
      }
    }
  }

  walk(pagesDir)

  // 2. Identify dead links and create placeholder nodes for them
  const deadLinks: Array<{ from: string, to: string }> = []
  for (const edge of edges) {
    if (!nodes.has(edge.to)) {
      deadLinks.push(edge)
      nodes.set(edge.to, {
        path: `wiki/pages/${edge.to}.md`,
        id: edge.to,
        title: path.basename(edge.to),
        category: edge.to.split('/')[0] ?? 'unknown',
        exists: false
      })
    }
  }

  // 3. Identify orphans (existing nodes with no inbound edges)
  const inboundCount = new Map<string, number>()
  for (const edge of edges) {
    inboundCount.set(edge.to, (inboundCount.get(edge.to) ?? 0) + 1)
  }

  const orphans: string[] = []
  for (const [id, node] of nodes) {
    // A node is an orphan if it exists but has 0 inbound links
    // Exception: The index or main landing pages might be considered orphans but we'll include them for now
    if (node.exists && (inboundCount.get(id) ?? 0) === 0) {
      orphans.push(id)
    }
  }

  return { nodes, edges, orphans, deadLinks }
}
