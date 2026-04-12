export type ErrorClass = 'context_limit' | 'auth' | 'billing' | 'not_found' | 'transient' | 'unknown'

export function classifyError(error: unknown): ErrorClass {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (!msg) return 'unknown'
  const status = error instanceof Error ? ((error as any).status ?? (error as any).statusCode) : undefined

  // Context limit — not retryable, content too large
  if (status === 413) return 'context_limit'
  if (msg.includes('token count exceeds')) return 'context_limit'
  if (msg.includes('context length')) return 'context_limit'
  if (msg.includes('tokens allowed')) return 'context_limit'
  if (msg.includes('request too large')) return 'context_limit'
  if (msg.includes('maximum context length')) return 'context_limit'
  if (msg.includes('content_too_large')) return 'context_limit'
  if (msg.includes('context_length_exceeded')) return 'context_limit'
  if (msg.includes('payload too large')) return 'context_limit'
  if (msg.includes('request entity too large')) return 'context_limit'
  if (msg.includes('invalid_argument') && (msg.includes('token') || msg.includes('size'))) return 'context_limit'

  // Auth — not retryable, wrong credentials
  if (status === 401 || status === 403) return 'auth'
  if (msg.includes('invalid_api_key') || msg.includes('invalid api key')) return 'auth'
  if (msg.includes('unauthorized') || msg.includes('forbidden')) return 'auth'
  if (msg.includes('permission denied')) return 'auth'

  // Billing — not retryable, account issue
  if (status === 402) return 'billing'
  if (msg.includes('insufficient_quota') || msg.includes('insufficient quota')) return 'billing'
  if (msg.includes('billing') && msg.includes('not active')) return 'billing'
  if (msg.includes('exceeded your current quota')) return 'billing'

  // Not found — not retryable, wrong model/endpoint
  if (status === 404) return 'not_found'
  if (msg.includes('model not found') || msg.includes('does not exist')) return 'not_found'

  // Transient — retryable
  if (status === 429 || status === 503 || status === 502) return 'transient'
  if (msg.includes('429') || msg.includes('rate limit')) return 'transient'
  if (msg.includes('503') || msg.includes('service unavailable')) return 'transient'
  if (msg.includes('502') || msg.includes('bad gateway')) return 'transient'
  if (msg.includes('500') && msg.includes('internal server error')) return 'transient'
  if (msg.includes('econnreset') || msg.includes('econnrefused')) return 'transient'
  if (msg.includes('etimedout') || msg.includes('timeout')) return 'transient'
  if (msg.includes('socket hang up')) return 'transient'
  if (msg.includes('fetch failed')) return 'transient'
  if (msg.includes('overloaded')) return 'transient'
  if (msg.includes('resource_exhausted')) return 'transient'
  if (msg.includes('capacity')) return 'transient'

  return 'unknown'
}

export function friendlyErrorMessage(errorClass: ErrorClass): string {
  switch (errorClass) {
    case 'context_limit':
      return 'File too large for model context window. Try a smaller file or switch to a model with a larger context.'
    case 'auth':
      return 'Authentication failed. Check your API key with `axiom-wiki model`.'
    case 'billing':
      return 'Billing issue with your API provider. Check your account quota and payment details.'
    case 'not_found':
      return 'Model not found. Run `axiom-wiki model` to select a valid model.'
    case 'transient':
      return 'Temporary API error. The operation will be retried automatically.'
    case 'unknown':
      return 'An unexpected error occurred.'
  }
}

export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void
}

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BASE_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 30_000

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
      const errorClass = classifyError(error)
      // Only retry transient errors — everything else fails immediately
      if (attempt === maxRetries || errorClass !== 'transient') {
        throw error
      }
      const delay = computeDelay(attempt, baseDelay, maxDelay)
      opts?.onRetry?.(error, attempt + 1, delay)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError // unreachable, but satisfies TypeScript
}
