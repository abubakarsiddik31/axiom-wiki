import type {
  GraphPayload,
  OverviewPayload,
  PageMeta,
  PagePayload,
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

  pages: (signal?: AbortSignal) =>
    request<{ pages: PageMeta[] }>('/api/v1/pages', signal).then((r) => r.pages),

  page: (id: string, signal?: AbortSignal) =>
    request<PagePayload>(`/api/v1/pages/${pagePath(id)}`, signal),

  search: (query: string, signal?: AbortSignal) =>
    request<{ query: string; results: SearchResult[] }>(
      `/api/v1/search?q=${encodeURIComponent(query)}`,
      signal,
    ),

  graph: (signal?: AbortSignal) => request<GraphPayload>('/api/v1/graph', signal),
}

/** "wiki/pages/entities/alan-turing.md" -> "entities/alan-turing" */
export function idFromPath(path: string): string {
  return path.replace(/^wiki\/pages\//, '').replace(/\.md$/, '')
}
