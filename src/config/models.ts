export type ProviderId = 'google' | 'openai' | 'anthropic' | 'ollama'

export interface ModelDef {
  id: string
  label: string
  desc: string
  recommended?: boolean
  /** USD per 1M tokens */
  pricing?: { input: number; output: number }
  /** Context window size in tokens */
  contextWindow?: number
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
      { id: 'gemini-3-flash-preview',      label: 'Gemini 3 Flash Preview',      desc: 'Fast, frontier intelligence with search and grounding', recommended: true, pricing: { input: 0.50, output: 3.00 }, contextWindow: 1_000_000 },
      { id: 'gemini-3.1-pro-preview',      label: 'Gemini 3.1 Pro Preview',      desc: 'SOTA reasoning, multimodal, deep coding capabilities', pricing: { input: 2.00, output: 12.00 }, contextWindow: 1_000_000 },
      { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite',     desc: 'Most cost-efficient, optimized for high-volume agentic tasks', pricing: { input: 0.25, output: 1.50 }, contextWindow: 1_000_000 },
      { id: 'gemini-2.5-pro',              label: 'Gemini 2.5 Pro',              desc: 'Advanced reasoning, 1M context, coding and complex tasks', pricing: { input: 1.25, output: 10.00 }, contextWindow: 1_000_000 },
      { id: 'gemini-2.0-flash',            label: 'Gemini 2.0 Flash',            desc: 'Second-gen multimodal, great performance across all tasks', pricing: { input: 0.10, output: 0.40 }, contextWindow: 1_000_000 },
      { id: 'gemma-4-26b-a4b-it',          label: 'Gemma 4 26B (MoE)',           desc: 'Open-weight MoE, activates 4B params per inference, free tier', contextWindow: 128_000 },
      { id: 'gemma-4-31b-it',              label: 'Gemma 4 31B',                 desc: 'Open-weight dense model, 256K context, data center quality, free tier', contextWindow: 256_000 },
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
      { id: 'gpt-5.4',      label: 'GPT-5.4',      desc: 'Flagship — complex reasoning and coding', pricing: { input: 15.00, output: 60.00 }, contextWindow: 128_000 },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', desc: 'Fast and affordable', recommended: true, pricing: { input: 0.40, output: 1.60 }, contextWindow: 128_000 },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', desc: 'Ultra-fast, lightweight', pricing: { input: 0.10, output: 0.40 }, contextWindow: 128_000 },
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
      { id: 'claude-opus-4-6',   label: 'Claude Opus 4.6',   desc: 'Most capable — best reasoning and coding', pricing: { input: 15.00, output: 75.00 }, contextWindow: 200_000 },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', desc: 'Balanced speed and quality', recommended: true, pricing: { input: 3.00, output: 15.00 }, contextWindow: 200_000 },
      { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  desc: 'Fast and cost-efficient', pricing: { input: 0.80, output: 4.00 }, contextWindow: 200_000 },
    ],
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    keyLabel: 'Ollama Base URL',
    keyEnv: 'OLLAMA_BASE_URL',
    keyUrl: 'https://ollama.com',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:11434/v1',
    models: [
      { id: 'llama3.2',  label: 'Llama 3.2 (3B)',  desc: 'Fast and lightweight', recommended: true, contextWindow: 128_000 },
      { id: 'llama3.1',  label: 'Llama 3.1 (8B)',  desc: 'Strong general-purpose model', contextWindow: 128_000 },
      { id: 'mistral',   label: 'Mistral 7B',       desc: 'Great instruction following', contextWindow: 32_000 },
      { id: 'qwen2.5',   label: 'Qwen 2.5 (7B)',    desc: 'Multilingual, strong reasoning', contextWindow: 128_000 },
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

const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_OLLAMA_CONTEXT_WINDOW = 65_536

export function getContextWindow(providerId: ProviderId, modelId: string): number {
  const model = getModel(providerId, modelId)
  if (providerId === 'ollama') return model?.contextWindow ?? DEFAULT_OLLAMA_CONTEXT_WINDOW
  return model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
}

export function getOllamaNumCtx(modelId: string, configOverride?: number): number {
  if (configOverride !== undefined) return configOverride
  const model = getModel('ollama', modelId)
  return model?.contextWindow ?? DEFAULT_OLLAMA_CONTEXT_WINDOW
}

/** Rough token estimate from text length. ~3.5 chars per token on average. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}
