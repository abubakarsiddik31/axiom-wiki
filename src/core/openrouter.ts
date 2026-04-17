export interface OpenRouterModel {
  id: string
  name: string
  pricing: { prompt: string; completion: string }
  context_length: number
}

export interface OpenRouterFetchResult {
  status: 'ok' | 'no-models' | 'unreachable' | 'auth-error'
  models: OpenRouterModel[]
}

/** Fetch available models from OpenRouter API. */
export async function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterFetchResult> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })

    if (res.status === 401 || res.status === 403) {
      return { status: 'auth-error', models: [] }
    }
    if (!res.ok) return { status: 'unreachable', models: [] }

    const data = await res.json() as { data?: OpenRouterModel[] }
    const models = (data.data ?? []).filter((m) => m.id && m.name)

    if (models.length === 0) return { status: 'no-models', models: [] }
    return { status: 'ok', models }
  } catch {
    return { status: 'unreachable', models: [] }
  }
}

/** Pick popular models from the full list, sorted by relevance. */
export function pickPopularModels(models: OpenRouterModel[]): OpenRouterModel[] {
  const popular = [
    'openrouter/auto',
    'anthropic/claude-sonnet-4',
    'anthropic/claude-haiku-4',
    'openai/gpt-4.1-mini',
    'openai/gpt-4.1-nano',
    'google/gemini-2.5-flash-preview',
    'google/gemini-2.5-pro-preview',
    'deepseek/deepseek-r1',
    'deepseek/deepseek-chat-v3-0324',
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-r1:free',
    'qwen/qwen3-235b-a22b:free',
  ]

  const picked: OpenRouterModel[] = []
  for (const id of popular) {
    const m = models.find((mod) => mod.id === id)
    if (m) picked.push(m)
  }
  return picked
}

/** Format a model for display in a select list. */
export function formatModelLabel(m: OpenRouterModel): string {
  const price = parseFloat(m.pricing.prompt)
  const priceTag = price === 0 ? '(free)' : `($${(price * 1_000_000).toFixed(2)}/M in)`
  const ctx = m.context_length >= 1_000_000
    ? `${(m.context_length / 1_000_000).toFixed(0)}M ctx`
    : `${(m.context_length / 1_000).toFixed(0)}K ctx`
  return `${m.name}  ${priceTag}  ${ctx}`
}
