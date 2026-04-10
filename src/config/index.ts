import Conf from 'conf'

export interface AxiomConfig {
  provider: 'google' | 'openai' | 'anthropic'
  apiKey: string
  model: string
  wikiDir: string
  rawDir: string
}

const store = new Conf<AxiomConfig>({ projectName: 'axiom-wiki' })

export function getConfig(): AxiomConfig | null {
  const provider = store.get('provider')
  const apiKey = store.get('apiKey')
  const model = store.get('model')
  const wikiDir = store.get('wikiDir')
  const rawDir = store.get('rawDir')

  if (!provider || !apiKey || !model || !wikiDir || !rawDir) return null

  return { provider, apiKey, model, wikiDir, rawDir }
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
