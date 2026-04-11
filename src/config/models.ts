export type ProviderId = 'google' | 'openai' | 'anthropic' | 'ollama'

export interface ModelDef {
  id: string
  label: string
  desc: string
  recommended?: boolean
  /** USD per 1M tokens */
  pricing?: { input: number; output: number }
}

export interface ProviderDef {
  id: ProviderId
  label: string
  keyLabel: string
  keyEnv: string
  keyUrl: string
  requiresApiKey: boolean
  defaultBaseUrl?: string
  models: ModelDef[]
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  google: {
    id: 'google',
    label: 'Google Gemini',
    keyLabel: 'Gemini API Key',
    keyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    requiresApiKey: true,
    models: [
      { id: 'gemini-3.1-pro',         label: 'Gemini 3.1 Pro',      desc: 'Latest flagship — agentic workflows, 1M context, adaptive thinking', pricing: { input: 1.25, output: 5.00 } },
      { id: 'gemini-3-flash-preview',  label: 'Gemini 3 Flash',      desc: 'Fast and multimodal, recommended for most wikis', recommended: true, pricing: { input: 0.075, output: 0.30 } },
      { id: 'gemini-3.1-pro-lite',    label: 'Gemini 3.1 Pro Lite', desc: 'Lightweight Pro variant — lower cost, still capable', pricing: { input: 0.10, output: 0.40 } },
      { id: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro',      desc: 'Stable Pro — multimodal, 1M context', pricing: { input: 1.25, output: 10.00 } },
      { id: 'gemini-2.0-flash',       label: 'Gemini 2.0 Flash',    desc: 'Affordable stable option, wide availability', pricing: { input: 0.075, output: 0.30 } },
    ],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyLabel: 'OpenAI API Key',
    keyEnv: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    requiresApiKey: true,
    models: [
      { id: 'gpt-5.4',      label: 'GPT-5.4',      desc: 'Flagship — complex reasoning and coding', pricing: { input: 15.00, output: 60.00 } },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', desc: 'Fast and affordable', recommended: true, pricing: { input: 0.40, output: 1.60 } },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', desc: 'Ultra-fast, lightweight', pricing: { input: 0.10, output: 0.40 } },
    ],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    keyLabel: 'Anthropic API Key',
    keyEnv: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    requiresApiKey: true,
    models: [
      { id: 'claude-opus-4-6',   label: 'Claude Opus 4.6',   desc: 'Most capable — best reasoning and coding', pricing: { input: 15.00, output: 75.00 } },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', desc: 'Balanced speed and quality', recommended: true, pricing: { input: 3.00, output: 15.00 } },
      { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  desc: 'Fast and cost-efficient', pricing: { input: 0.80, output: 4.00 } },
    ],
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    keyLabel: 'Ollama Base URL',
    keyEnv: 'OLLAMA_BASE_URL',
    keyUrl: 'https://ollama.com',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:11434/api',
    models: [
      { id: 'llama3.2',  label: 'Llama 3.2 (3B)',  desc: 'Fast and lightweight', recommended: true },
      { id: 'llama3.1',  label: 'Llama 3.1 (8B)',  desc: 'Strong general-purpose model' },
      { id: 'mistral',   label: 'Mistral 7B',       desc: 'Great instruction following' },
      { id: 'qwen2.5',   label: 'Qwen 2.5 (7B)',    desc: 'Multilingual, strong reasoning' },
    ],
  },
}

export function getProvider(id: ProviderId): ProviderDef {
  return PROVIDERS[id]
}

export function getModel(providerId: ProviderId, modelId: string): ModelDef | undefined {
  return PROVIDERS[providerId].models.find((m) => m.id === modelId)
}

export function getDefaultModel(providerId: ProviderId): ModelDef {
  const models = PROVIDERS[providerId].models
  return models.find((m) => m.recommended) ?? models[0]
}

export function listProviders(): ProviderDef[] {
  return Object.values(PROVIDERS)
}
