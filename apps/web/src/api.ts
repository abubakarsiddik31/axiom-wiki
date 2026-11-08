import type {
  CaptureResult,
  CitationAuditReport,
  ConfigPayload,
  ContextPayload,
  GraphPayload,
  IntegrityPayload,
  Job,
  JobPayload,
  JobsPayload,
  MaintenancePlan,
  MaintenanceRun,
  OverviewPayload,
  PageDiffPayload,
  PageHistoryPayload,
  PageLinksPayload,
  PagePayload,
  PagesPayload,
  RerankSettings,
  RerankTestResult,
  SavePageResult,
  ScoutItem,
  ScoutPayload,
  ScoutShareResult,
  SearchResult,
  SourcesPayload,
  ThreadAskResult,
  ThreadListPayload,
  ThreadPayload,
  WatchPayload,
} from './types'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* keep the status line */
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(path, { signal })
}

/** Mutation transport. The custom header is required by write mode. */
export async function runAction<T = unknown>(action: string, body: unknown): Promise<T> {
  return requestJson<T>(`/api/v1/actions/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Axiom-Write': '1',
    },
    body: JSON.stringify(body),
  })
}

function pagePath(id: string): string {
  return id
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
}

export const api = {
  overview: (signal?: AbortSignal) => request<OverviewPayload>('/api/v1/overview', signal),

  pages: (
    params: {
      cat?: string
      tag?: string
      q?: string
      cursor?: string | null
      limit?: number
      sort?: 'category' | 'title' | 'updated'
    } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams()
    if (params.cat) query.set('cat', params.cat)
    if (params.tag) query.set('tag', params.tag)
    if (params.q) query.set('q', params.q)
    if (params.cursor) query.set('cursor', params.cursor)
    if (params.limit) query.set('limit', String(params.limit))
    if (params.sort) query.set('sort', params.sort)
    const suffix = query.toString()
    return request<PagesPayload>(`/api/v1/pages${suffix ? `?${suffix}` : ''}`, signal)
  },

  page: (id: string, signal?: AbortSignal) =>
    request<PagePayload>(`/api/v1/pages/${pagePath(id)}`, signal),

  pageLinks: (id: string, signal?: AbortSignal) =>
    request<PageLinksPayload>(`/api/v1/pages/${pagePath(id)}/links`, signal),

  pageHistory: (id: string, signal?: AbortSignal) =>
    request<PageHistoryPayload>(`/api/v1/pages/${pagePath(id)}/history`, signal),

  pageDiff: (id: string, rev: string, signal?: AbortSignal) =>
    request<PageDiffPayload>(
      `/api/v1/pages/${pagePath(id)}/diff?rev=${encodeURIComponent(rev)}`,
      signal,
    ),

  savePage: (draft: {
    id?: string
    category?: string
    title: string
    summary?: string
    tags?: string[]
    aliases?: string[]
    body: string
  }) => runAction<SavePageResult>('page/save', draft),

  renamePage: (id: string, newId: string) =>
    runAction<{ oldId: string; newId: string; touched: string[] }>('page/rename', { id, newId }),

  mergePages: (source: string, target: string) =>
    runAction<{ targetId: string; removedId: string; touched: string[] }>('page/merge', {
      source,
      target,
    }),

  deletePage: (id: string) => runAction<{ id: string; deleted: boolean }>('page/delete', { id }),

  restorePage: (id: string, rev: string) =>
    runAction<{ id: string; rev: string; restored: boolean }>('page/restore', { id, rev }),

  linkMention: (sourceId: string, targetId: string) =>
    runAction<{ linked: boolean }>('link/insert', { sourceId, targetId }),

  capture: (input: { text: string; title?: string; tags?: string[]; source?: string }) =>
    runAction<CaptureResult>('capture', input),

  promoteInbox: (id: string, category: string) =>
    runAction<{ oldId: string; newId: string; touched: string[] }>('inbox/promote', {
      id,
      category,
    }),

  context: (q: string) => runAction<ContextPayload>('context', { q }),

  threads: (signal?: AbortSignal) => request<ThreadListPayload>('/api/v1/threads', signal),

  thread: (id: string, signal?: AbortSignal) =>
    request<ThreadPayload>(`/api/v1/threads/${encodeURIComponent(id)}`, signal),

  newThread: (title?: string) => runAction<{ thread: ThreadPayload['thread'] }>('thread/new', { title }),

  askThread: (input: { threadId?: string; question: string; forensic?: boolean }) =>
    runAction<ThreadAskResult & { job: JobPayload['job'] }>('thread/ask', input),

  renameThread: (id: string, title: string) =>
    runAction<{ thread: ThreadPayload['thread'] }>('thread/rename', { id, title }),

  deleteThread: (id: string) => runAction<{ removed: string }>('thread/delete', { id }),

  saveThread: (id: string, title?: string) =>
    runAction<{ path: string; slug: string }>('thread/save', { id, title }),

  search: (query: string, signal?: AbortSignal) =>
    request<{ query: string; results: SearchResult[] }>(
      `/api/v1/search?q=${encodeURIComponent(query)}`,
      signal,
    ),

  graph: (
    params: { limit?: number; focus?: string; depth?: number } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams()
    if (params.limit) query.set('limit', String(params.limit))
    if (params.focus) query.set('focus', params.focus)
    if (params.depth) query.set('depth', String(params.depth))
    const suffix = query.toString()
    return request<GraphPayload>(`/api/v1/graph${suffix ? `?${suffix}` : ''}`, signal)
  },

  sources: (signal?: AbortSignal) => request<SourcesPayload>('/api/v1/sources', signal),

  watch: (signal?: AbortSignal) => request<WatchPayload>('/api/v1/watch', signal),

  startWatch: () => runAction<WatchPayload>('watch/start', {}),

  stopWatch: () => runAction<WatchPayload>('watch/stop', {}),

  config: (signal?: AbortSignal) => request<ConfigPayload>('/api/v1/config', signal),

  scout: (signal?: AbortSignal) => request<ScoutPayload>('/api/v1/scout', signal),

  scoutShare: (input: {
    url?: string
    text?: string
    tags?: string[]
    note?: string
  }) => runAction<ScoutShareResult>('scout/share', input),

  drainScout: (options: { ingest?: boolean; limit?: number } = {}) =>
    runAction<JobPayload>('scout/drain', options),

  retryScout: (id: string) => runAction<{ item: ScoutItem }>('scout/retry', { id }),

  removeScout: (id: string) =>
    runAction<{ removed: string; summary: ScoutPayload['summary'] }>('scout/remove', { id }),

  clearScout: () =>
    runAction<{ removed: number; summary: ScoutPayload['summary'] }>('scout/clear', {}),

  scanScoutDrop: () =>
    runAction<{ found: number; added: ScoutItem[]; summary: ScoutPayload['summary'] }>('scout/scan', {}),

  integrity: (signal?: AbortSignal) => request<IntegrityPayload>('/api/v1/integrity', signal),

  jobs: (signal?: AbortSignal) => request<JobsPayload>('/api/v1/jobs', signal),

  job: (id: string, signal?: AbortSignal) =>
    request<JobPayload>(`/api/v1/jobs/${encodeURIComponent(id)}`, signal),

  cancelJob: (id: string) =>
    requestJson<JobPayload>(`/api/v1/jobs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'X-Axiom-Write': '1' },
    }),

  citationAudit: (strict: boolean) =>
    runAction<CitationAuditReport>('lint', { mode: 'citations', strict }),

  integrityAction: () => runAction<IntegrityPayload>('lint', { mode: 'integrity' }),

  maintain: (options: Record<string, unknown> = {}) =>
    runAction<MaintenancePlan>('maintain', options),

  maintainApply: (options: Record<string, unknown> = {}) =>
    runAction<MaintenanceRun>('maintain/apply', options),

  saveSettings: (rerank: {
    provider?: string
    model?: string
    topN?: number
    candidates?: number
    apiKey?: string
    clearApiKey?: boolean
  }) => runAction<{ rerank: RerankSettings }>('settings/save', { rerank }),

  setupReranker: (model?: string) =>
    runAction<JobPayload>('rerank/setup', model ? { model } : {}),

  testReranker: (query: string) =>
    runAction<RerankTestResult>('rerank/test', { query }),
}

export function jobEventsUrl(id: string): string {
  return `/api/v1/jobs/${encodeURIComponent(id)}/events`
}

export const WIKI_EVENTS_URL = '/api/v1/events'

export type { Job }

/** "wiki/pages/entities/alan-turing.md" -> "entities/alan-turing" */
export function idFromPath(path: string): string {
  return path.replace(/^wiki\/pages\//, '').replace(/\.md$/, '')
}
