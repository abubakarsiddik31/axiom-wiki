import type {
  GraphPayload,
  OverviewPayload,
  PagePayload,
  PagesPayload,
  SearchResult,
} from './types'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    headers: { Accept: 'application/json' },
    signal,
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
      q?: string
      cursor?: string | null
      limit?: number
      sort?: 'category' | 'title' | 'updated'
    } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams()
    if (params.cat) query.set('cat', params.cat)
    if (params.q) query.set('q', params.q)
    if (params.cursor) query.set('cursor', params.cursor)
    if (params.limit) query.set('limit', String(params.limit))
    if (params.sort) query.set('sort', params.sort)
    const suffix = query.toString()
    return request<PagesPayload>(`/api/v1/pages${suffix ? `?${suffix}` : ''}`, signal)
  },

  page: (id: string, signal?: AbortSignal) =>
    request<PagePayload>(`/api/v1/pages/${pagePath(id)}`, signal),

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
}

/** "wiki/pages/entities/alan-turing.md" -> "entities/alan-turing" */
export function idFromPath(path: string): string {
  return path.replace(/^wiki\/pages\//, '').replace(/\.md$/, '')
}
