import type {
  CitationAuditReport,
  ConfigPayload,
  GraphPayload,
  IntegrityPayload,
  Job,
  JobPayload,
  JobsPayload,
  OverviewPayload,
  PageDiffPayload,
  PageHistoryPayload,
  PageLinksPayload,
  PagePayload,
  PagesPayload,
  SavePageResult,
  SearchResult,
  SourcesPayload,
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
