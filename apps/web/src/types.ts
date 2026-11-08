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
  /** Markdown body without frontmatter, used by the editor. */
  body: string
  html: string
  backlinks: Backlink[]
}

export type RelatedReason = 'tag' | 'link' | 'co-citation' | 'mention'

export interface UnlinkedMention {
  id: string
  title: string
  snippet: string
  mentions: number
}

export interface RelatedPage {
  id: string
  title: string
  summary: string
  score: number
  reasons: RelatedReason[]
  sharedTags: string[]
}

export interface PageLinksPayload {
  id: string
  title: string
  unlinked: UnlinkedMention[]
  related: RelatedPage[]
}

export interface PageCommit {
  hash: string
  shortHash: string
  date: string
  author: string
  subject: string
}

export interface PageHistoryPayload {
  available: boolean
  reason?: string
  commits: PageCommit[]
}

export interface PageDiffPayload {
  rev: string
  patch: string
}

export interface SavePageResult {
  id: string
  path: string
  created: boolean
}

export type ContextOrigin = 'search' | 'link' | 'backlink'

export interface ContextSource {
  id: string
  title: string
  category: string
  summary: string
  excerpt: string
  sources: string[]
  score: number
  origin: ContextOrigin
}

export interface ContextPayload {
  query: string
  sources: ContextSource[]
  estimatedTokens: number
  truncated: boolean
  text: string
  rerank?: {
    provider: 'none' | 'local' | 'llm' | 'cohere'
    model: string
    used: boolean
    reason?: string
  } | null
}

export interface ThreadSource {
  id: string
  title: string
  category: string
  summary: string
  score: number
  origin: ContextOrigin
}

export interface ThreadRerank {
  provider: 'none' | 'local' | 'llm' | 'cohere'
  model: string
  used: boolean
  reason?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  at: string
  /** Server-rendered Markdown for assistant turns. */
  html?: string
  sources?: ThreadSource[]
  rerank?: ThreadRerank | null
  /** Retrieval query, when a follow-up was rewritten to stand alone. */
  searched?: string
  error?: string
  jobId?: string
}

export interface ChatThread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}

export interface ThreadSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string
  lastRole: 'user' | 'assistant' | null
}

export interface ThreadListPayload {
  threads: ThreadSummary[]
}

export interface ThreadPayload {
  thread: ChatThread
}

export interface ThreadAskResult {
  threadId: string
  created: boolean
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
  facets: { categories: Record<string, number>; tags: Record<string, number> }
}

export type ScoutKind = 'url' | 'text' | 'file'
export type ScoutStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped'

export interface ScoutItem {
  id: string
  key: string
  kind: ScoutKind
  url?: string
  text?: string
  file?: string
  tags: string[]
  note?: string
  source: string
  addedAt: string
  status: ScoutStatus
  attempts: number
  startedAt?: string
  finishedAt?: string
  lastError?: string
  result?: {
    pages?: string[]
    inbox?: string
    filename?: string
    reused?: boolean
    tags?: string[]
    message?: string
  }
  preview: string
}

export interface ScoutSummary {
  name: string
  mention: string
  pending: number
  running: number
  done: number
  failed: number
  total: number
  lastAddedAt: string | null
}

export interface ScoutWorker {
  pid: number
  host: string
  port: number
  startedAt: string
  heartbeatAt: string
  /** LAN-reachable base URL when the listener is bound to 0.0.0.0/::. */
  lanUrl?: string
}

export interface ScoutPayload {
  name: string
  mention: string
  summary: ScoutSummary
  worker: ScoutWorker | null
  dropDir: string
  shareUrl: string | null
  queueUrl: string | null
  /** Only present when the server is in write mode. */
  token?: string
  items: ScoutItem[]
}

export interface ScoutShareResult {
  added: ScoutItem[]
  duplicates: ScoutItem[]
  parsed: { urls: string[]; tags: string[]; text: string; mentioned: boolean }
  summary: ScoutSummary
}

export interface OverviewPayload {
  status: WikiStatus
  recent: PageMeta[]
  /** Notes waiting in the inbox category. */
  inboxCount: number
  /** Shares waiting for Scout. */
  scoutPending?: number
}

export interface CaptureResult {
  id: string
  path: string
  title: string
  created: boolean
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

export interface MaintenancePlan {
  generatedAt: string
  counts: {
    pages: number
    summaries: number
    staleSummaries: number
    orphans: number
    orphanLinks: number
    duplicates: number
    deadLinks: number
    pagesWithoutTags: number
  }
  summaries: Array<{ id: string; title: string; summary: string }>
  staleSummaries: Array<{ id: string; title: string; current: string; proposed: string }>
  orphans: string[]
  orphanLinks: Array<{
    id: string
    title: string
    from: string
    fromTitle: string
    mode: 'mention' | 'related'
    snippet: string
  }>
  duplicates: Array<{
    a: string
    b: string
    aTitle: string
    bTitle: string
    similarity: number
    reason: 'same-title' | 'similar-title'
  }>
  deadLinks: Array<{ to: string; from: string[]; creatable: boolean }>
  pagesWithoutTags: Array<{ id: string; title: string }>
}

export interface MaintenanceApplyResult {
  touched: string[]
  created: string[]
  summaries: number
  staleSummaries: number
  links: number
  stubs: number
  skipped: Array<{ id: string; reason: string }>
}

export type MaintenanceRun =
  | { status: 'busy'; pid: number | null }
  | {
      status: 'ok'
      plan: MaintenancePlan
      applied: MaintenanceApplyResult | null
      committed: boolean
    }

export interface RerankPreset {
  key: 'fast' | 'balanced' | 'multilingual'
  id: string
  label: string
  sizeMb: number
  languages: string
}

export interface RerankSettings {
  provider: 'none' | 'local' | 'llm' | 'cohere'
  model: string
  topN: number
  candidates: number
  hasApiKey: boolean
  localReady: boolean
  localModels: Record<string, boolean>
  presets: RerankPreset[]
}

export interface RerankTestResult {
  provider: 'none' | 'local' | 'llm' | 'cohere'
  model: string
  used: boolean
  reason?: string
  latencyMs: number
  settings: {
    provider: 'none' | 'local' | 'llm' | 'cohere'
    model: string
    topN: number
    candidates: number
    hasApiKey: boolean
  }
  results: Array<{ id: string; title: string; score?: number }>
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
  rerank: RerankSettings
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

// ── Bulk import ─────────────────────────────────────────────────────────────

export type ImportItemStatus = 'ready' | 'duplicate' | 'unsupported' | 'invalid'

export interface ImportFileItem {
  kind: 'file'
  source: string
  label: string
  relative: string | null
  bytes: number
  target: string
  status: ImportItemStatus
  reason?: string
}

export interface ImportUrlItem {
  kind: 'url'
  source: string
  label: string
  status: ImportItemStatus
  reason?: string
}

export type ImportItem = ImportFileItem | ImportUrlItem

export interface ImportPlan {
  items: ImportItem[]
  ready: number
  duplicates: number
  unsupported: number
  invalid: number
  fileCount: number
  urlCount: number
  totalBytes: number
  truncatedUrls: number
  truncatedFiles: number
}

export interface ImportRequest {
  paths?: string[]
  urls?: string[]
  from?: string[]
  includeMedia?: boolean
  urlLimit?: number
  fileLimit?: number
}

export interface ImportedSource {
  item: ImportItem
  filename: string
  ok: boolean
  moved?: boolean
  error?: string
}

export interface ImportRunResult {
  plan: ImportPlan
  staged: ImportedSource[]
  ingest: {
    files: Array<{ filename: string; status: 'done' | 'error'; pages: string[]; error?: string }>
    pages: string[]
    summary: string
  } | null
  summary: string
}
