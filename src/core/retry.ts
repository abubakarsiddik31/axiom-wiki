export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void
}

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BASE_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 30_000

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()

  // HTTP status codes
  if (msg.includes('429') || msg.includes('rate limit')) return true
  if (msg.includes('503') || msg.includes('service unavailable')) return true
  if (msg.includes('502') || msg.includes('bad gateway')) return true
  if (msg.includes('500') && msg.includes('internal server error')) return true

  // Network errors
  if (msg.includes('econnreset') || msg.includes('econnrefused')) return true
  if (msg.includes('etimedout') || msg.includes('timeout')) return true
  if (msg.includes('socket hang up')) return true
  if (msg.includes('fetch failed')) return true

  // Provider-specific
  if (msg.includes('overloaded')) return true
  if (msg.includes('resource_exhausted')) return true
  if (msg.includes('capacity')) return true

  // Check for status property on the error object
  const status = (error as any).status ?? (error as any).statusCode
  if (status === 429 || status === 503 || status === 502) return true

  return false
}

function computeDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * Math.pow(2, attempt)
  const jitter = Math.random() * baseMs
  return Math.min(exponential + jitter, maxMs)
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES
  const baseDelay = opts?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelay = opts?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error
      }
      const delay = computeDelay(attempt, baseDelay, maxDelay)
      opts?.onRetry?.(error, attempt + 1, delay)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError // unreachable, but satisfies TypeScript
}
