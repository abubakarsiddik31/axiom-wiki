import { useCallback, useEffect, useState } from 'react'

import { api, jobEventsUrl } from './api'
import { useWikiVersion } from './context/WikiEvents'
import type { Job, JobsPayload } from './types'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/**
 * Minimal request state hook. `run` receives an AbortSignal so unmounted pages
 * never write state; `deps` controls when the request re-runs.
 */
export function useAsync<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const wikiVersion = useWikiVersion()
  const [attempt, setAttempt] = useState(0)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    run(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        setData(value)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => controller.abort()
    // The caller owns the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, wikiVersion])

  return { data, error, loading, reload }
}

/** Polls the server's process-local job registry. */
export function useJobs(intervalMs = 2500): AsyncState<JobsPayload> {
  const state = useAsync((signal) => api.jobs(signal), [])
  useEffect(() => {
    const timer = window.setInterval(state.reload, intervalMs)
    return () => window.clearInterval(timer)
  }, [state.reload, intervalMs])
  return state
}

export interface JobStreamState {
  job: Job | null
  lines: string[]
  text: string
}

/** Subscribes to a job's SSE channel and accumulates its log/delta stream. */
export function useJobStream(jobId: string | null): JobStreamState {
  const [job, setJob] = useState<Job | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [text, setText] = useState('')

  useEffect(() => {
    if (!jobId) {
      setJob(null)
      setLines([])
      setText('')
      return
    }

    if (typeof EventSource === 'undefined') return
    const source = new EventSource(jobEventsUrl(jobId))
    const onJob = (event: MessageEvent) => {
      const next = JSON.parse(event.data) as Job
      setJob(next)
      setLines(next.lines)
    }
    const onLog = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { line: string }
      setLines((prev) => [...prev, data.line].slice(-200))
    }
    const onDelta = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { text: string }
      setText((prev) => prev + data.text)
    }
    const onDone = (event: MessageEvent) => {
      setJob(JSON.parse(event.data) as Job)
      source.close()
    }

    source.addEventListener('job', onJob)
    source.addEventListener('log', onLog)
    source.addEventListener('delta', onDelta)
    source.addEventListener('done', onDone)

    return () => source.close()
  }, [jobId])

  return { job, lines, text }
}

/** Keeps the browser tab title in sync with the visible page. */
export function useTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · Axiom Wiki` : 'Axiom Wiki'
  }, [title])
}
