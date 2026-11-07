export interface PageMeta {
  path: string
  title: string
  summary: string
  tags: string[]
  category: string
  updatedAt: string
}

export interface SemanticHealth {
  status: 'healthy' | 'stale' | 'missing_index' | 'disabled'
  provider: string
  model: string | null
}

export interface WikiStatus {
  totalPages: number
  pagesByCategory: Record<string, number>
  rawSourceCount: number
  wikiSizeBytes: number
  lastIngest: string | null
  lastQuery: string | null
  lastLint: string | null
  semanticHealth?: SemanticHealth
}

export interface SearchResult {
  path: string
  title: string
  sectionTitle?: string
  sectionAnchor?: string
  summary: string
  excerpt: string
  score: number
  matchCount: number
}

export interface Backlink {
  fromId: string
  fromTitle: string
}

export interface PageFrontmatter {
  title: string
  summary: string
  tags: string[]
  category: string
  updatedAt: string
  sources: string[]
}

export interface PagePayload {
  id: string
  frontmatter: PageFrontmatter
  html: string
  backlinks: Backlink[]
}

export interface GraphNode {
  path: string
  id: string
  title: string
  category: string
  exists: boolean
}

export interface GraphEdge {
  from: string
  to: string
}

export interface GraphPayload {
  nodes: GraphNode[]
  edges: GraphEdge[]
  orphans: string[]
  deadLinks: Array<{ from: string; to: string }>
  totalNodes: number
  totalEdges: number
  orphanCount: number
  deadLinkCount: number
  truncated: boolean
}

export interface PagesPayload {
  pages: PageMeta[]
  total: number
  nextCursor: string | null
  facets: { categories: Record<string, number> }
}

export interface OverviewPayload {
  status: WikiStatus
  recent: PageMeta[]
}
