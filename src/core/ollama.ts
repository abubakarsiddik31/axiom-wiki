export interface OllamaModel {
  name: string
  size: number
  parameterSize?: string
}

export interface OllamaFetchResult {
  status: 'ok' | 'no-models' | 'unreachable'
  models: OllamaModel[]
}

export async function fetchOllamaModels(baseUrl: string): Promise<OllamaFetchResult> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return { status: 'unreachable', models: [] }

    const data = await res.json() as {
      models?: Array<{
        name?: string
        size?: number
        details?: { parameter_size?: string }
      }>
    }

    const models: OllamaModel[] = (data.models ?? [])
      .filter((m) => m.name)
      .map((m) => ({
        name: m.name!,
        size: m.size ?? 0,
        parameterSize: m.details?.parameter_size,
      }))

    if (models.length === 0) return { status: 'no-models', models: [] }
    return { status: 'ok', models }
  } catch {
    return { status: 'unreachable', models: [] }
  }
}

export function ollamaModelsToSelectItems(models: OllamaModel[]): Array<{ label: string; value: string }> {
  return models.map((m) => {
    const sizeInfo = m.parameterSize ? ` (${m.parameterSize})` : ''
    return { label: `${m.name}${sizeInfo}`, value: m.name }
  })
}

export const OLLAMA_SUGGESTED_MODELS = [
  { name: 'llama3.2', pullCmd: 'ollama pull llama3.2', desc: 'Fast and lightweight (3B)' },
  { name: 'llama3.1', pullCmd: 'ollama pull llama3.1', desc: 'Strong general-purpose (8B)' },
  { name: 'mistral', pullCmd: 'ollama pull mistral', desc: 'Great instruction following (7B)' },
  { name: 'qwen2.5', pullCmd: 'ollama pull qwen2.5', desc: 'Multilingual, strong reasoning (7B)' },
]

export interface PullProgress {
  status: string
  total?: number
  completed?: number
  digest?: string
}

/**
 * Pull an Ollama model, streaming progress updates via callback.
 * Returns true if successful, false on failure.
 */
export async function pullOllamaModel(
  baseUrl: string,
  modelName: string,
  onProgress: (progress: PullProgress) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: body || `HTTP ${res.status}` }
    }

    const reader = res.body?.getReader()
    if (!reader) return { ok: false, error: 'No response stream' }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Ollama streams newline-delimited JSON
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const progress = JSON.parse(line) as PullProgress
          onProgress(progress)
          if (progress.status === 'error') {
            return { ok: false, error: progress.status }
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Format pull progress as a human-readable string */
export function formatPullProgress(p: PullProgress): string {
  if (p.total && p.completed) {
    const pct = Math.round((p.completed / p.total) * 100)
    const completedMB = (p.completed / 1024 / 1024).toFixed(0)
    const totalMB = (p.total / 1024 / 1024).toFixed(0)
    return `${p.status} ${pct}% (${completedMB}/${totalMB} MB)`
  }
  return p.status
}

/** Extract the base Ollama URL (without /v1 or /api suffix) from a stored config URL */
export function stripOllamaApiSuffix(url: string): string {
  return url.replace(/\/(v1|api)\/?$/, '')
}
