import Conf from 'conf'

export interface AxiomConfig {
  provider: 'google' | 'openai' | 'anthropic' | 'ollama'
  apiKey: string
  model: string
  wikiDir: string
  rawDir: string
  ollamaBaseUrl?: string
}

const store = new Conf<AxiomConfig>({ projectName: 'axiom-wiki' })

export function getConfig(): AxiomConfig | null {
  const provider = store.get('provider')
  const apiKey = store.get('apiKey')
  const model = store.get('model')
  const wikiDir = store.get('wikiDir')
  const rawDir = store.get('rawDir')

  // Ollama doesn't require an apiKey
  if (!provider || !model || !wikiDir || !rawDir) return null
  if (provider !== 'ollama' && !apiKey) return null

  const ollamaBaseUrl =
    process.env['OLLAMA_BASE_URL'] ||
    store.get('ollamaBaseUrl') ||
    'http://localhost:11434/api'

  return { provider, apiKey: apiKey ?? '', model, wikiDir, rawDir, ollamaBaseUrl }
}

export function setConfig(cfg: Partial<AxiomConfig>): void {
  for (const [key, value] of Object.entries(cfg)) {
    store.set(key as keyof AxiomConfig, value)
  }
}

export function hasConfig(): boolean {
  return getConfig() !== null
}

export function clearConfig(): void {
  store.clear()
}
