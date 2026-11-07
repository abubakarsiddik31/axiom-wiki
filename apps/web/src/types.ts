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

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface Job {
  id: string
  action: string
  status: JobStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  lines: string[]
  result: unknown
  error: string | null
}

export interface JobPayload {
  job: Job
}

export interface JobsPayload {
  jobs: Job[]
}

export interface SourceRecord {
  filename: string
  ingestedAt: string
  summaryPage: string
  pageCount: number
  sha256: string
  lastIngestedAt: string
  truncated: boolean
  concepts: number
}

export interface WatchPayload {
  running: boolean
  startedAt: string | null
  lastEvent: { at: string; file: string; jobId: string } | null
}

export interface SourcesPayload {
  sources: SourceRecord[]
  rawFiles: string[]
  lock: {
    locked: boolean
    stale: boolean
    info: { pid: number; acquiredAt: string } | null
  }
}

export interface IntegrityPayload {
  generatedAt: string
  counts: {
    pages: number
    deadLinks: number
    orphans: number
    pagesWithoutSummary: number
    pagesWithoutTags: number
    contradictions: number
  }
  deadLinks: Array<{ from: string; to: string }>
  orphans: string[]
  pagesWithoutSummary: string[]
  pagesWithoutTags: string[]
  contradictions: Array<{ path: string; title: string }>
}

export interface ConfigPayload {
  provider: string
  model: string
  wikiDir: string
  rawDir: string
  obsidianCompat: boolean
  forensicCitations: boolean
  writeMode: boolean
  embeddings: {
    provider: string
    model: string | null
    dimensions: number | null
    manifest: {
      provider: string
      model: string
      dimensions: number
      lastReindexAt: string
      pageCount?: number
      chunkCount?: number
    } | null
    consistency: { consistent: boolean; reason?: string; message?: string }
  }
}

export interface CitationAuditReport {
  timestamp: string
  totalPages: number
  totalCitations: number
  verifiedCount: number
  missingSourceCount: number
  unverifiedLocatorCount: number
  unlistedFrontmatterCount: number
  uncitedParagraphCount: number
  passed: boolean
  gradeSummary: Record<string, number>
  unreferencedSources: string[]
  results: Array<{
    citation: { pagePath: string; source: string; rawLocator?: string; paragraphIndex: number }
    status: string
    message?: string
    sourcePath?: string
  }>
}
