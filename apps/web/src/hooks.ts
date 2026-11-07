import { useCallback, useEffect, useState } from 'react'

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
  }, [...deps, attempt])

  return { data, error, loading, reload }
}

/** Keeps the browser tab title in sync with the visible page. */
export function useTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · Axiom Wiki` : 'Axiom Wiki'
  }, [title])
}
