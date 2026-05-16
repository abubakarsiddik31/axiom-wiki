import Conf from 'conf'
import fs from 'fs'
import path from 'path'

export interface AxiomConfig {
  provider: 'google' | 'openai' | 'anthropic' | 'openrouter' | 'deepseek' | 'groq' | 'mistral' | 'ollama'
  apiKey: string
  providerApiKeys?: Partial<Record<'google' | 'openai' | 'anthropic' | 'openrouter' | 'deepseek' | 'groq' | 'mistral', string>>
  auth?: {
    openai?: {
      method: 'apikey' | 'oauth'
      issuer?: string
      clientId?: string
      authUrl?: string
      tokenUrl?: string
      redirectPort?: number
      accessToken?: string
      refreshToken?: string
      tokenType?: string
      scope?: string
      expiresAt?: string
      configuredAt: string
    }
  }
  model: string
  wikiDir: string
  rawDir: string
  ollamaBaseUrl?: string
  /** Override Ollama num_ctx (context window tokens). Default: 65536. */
  ollamaNumCtx?: number
  /** Use [[page-name]] instead of [[category/page-name]] for Obsidian compatibility. */
  obsidianCompat?: boolean
  embeddings?: {
    provider: 'google' | 'openai' | 'ollama' | 'none'
    apiKey?: string
    model?: string
    dimensions?: number
  }
}

export type ConfigScope = 'local' | 'global'

const LOCAL_CONFIG_FILENAME = 'axiom/config.json'
const LEGACY_LOCAL_CONFIG_FILENAME = '.axiom/config.json'

const store = new Conf<AxiomConfig>({ projectName: 'axiom-wiki' })

function resolveProviderCredential(
  provider: AxiomConfig['provider'] | undefined,
  apiKey: string | undefined,
  providerApiKeys: AxiomConfig['providerApiKeys'] | undefined,
  auth: AxiomConfig['auth'] | undefined,
): string {
  if (!provider || provider === 'ollama') return ''
  if (apiKey) return apiKey
  if (provider === 'openai' && auth?.openai?.accessToken) return auth.openai.accessToken
  return providerApiKeys?.[provider] ?? ''
}

function getGlobalConfig(): AxiomConfig | null {
  const provider = store.get('provider')
  const apiKey = store.get('apiKey')
  const providerApiKeys = store.get('providerApiKeys')
  const auth = store.get('auth')
  const model = store.get('model')
  const wikiDir = store.get('wikiDir')
  const rawDir = store.get('rawDir')
  const resolvedApiKey = resolveProviderCredential(provider, apiKey, providerApiKeys, auth)

  if (!provider || !model || !wikiDir || !rawDir) return null
  if (provider !== 'ollama' && !resolvedApiKey) return null

  const ollamaBaseUrl =
    process.env['OLLAMA_BASE_URL'] ||
    store.get('ollamaBaseUrl') ||
    'http://localhost:11434/v1'

  const ollamaNumCtx = store.get('ollamaNumCtx')
  const obsidianCompat = store.get('obsidianCompat')
  const embeddings = store.get('embeddings')
  return { provider, apiKey: resolvedApiKey, providerApiKeys, auth, model, wikiDir, rawDir, ollamaBaseUrl, ollamaNumCtx, obsidianCompat, embeddings }
}

let _cachedLocalConfigPath: string | null | undefined = undefined

export function findLocalConfig(startDir?: string): string | null {
  if (_cachedLocalConfigPath !== undefined) return _cachedLocalConfigPath

  let dir = path.resolve(startDir ?? process.cwd())
  const root = path.parse(dir).root

  while (true) {
    const candidate = path.join(dir, LOCAL_CONFIG_FILENAME)
    if (fs.existsSync(candidate)) {
      _cachedLocalConfigPath = candidate
      return candidate
    }
    // Fall back to legacy .axiom/ directory for existing users
    const legacyCandidate = path.join(dir, LEGACY_LOCAL_CONFIG_FILENAME)
    if (fs.existsSync(legacyCandidate)) {
      _cachedLocalConfigPath = legacyCandidate
      return legacyCandidate
    }
    const parent = path.dirname(dir)
    if (parent === dir || dir === root) break
    dir = parent
  }

  _cachedLocalConfigPath = null
  return null
}

interface LocalConfigFile {
  provider?: AxiomConfig['provider']
  apiKey?: string
  providerApiKeys?: AxiomConfig['providerApiKeys']
  auth?: AxiomConfig['auth']
  model?: string
  wikiDir?: string
  rawDir?: string
  ollamaBaseUrl?: string
  ollamaNumCtx?: number
  obsidianCompat?: boolean
  embeddings?: AxiomConfig['embeddings']
}

function readLocalConfig(configPath: string): AxiomConfig | null {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed: LocalConfigFile = JSON.parse(raw)
    const { provider, apiKey, providerApiKeys, auth, model, wikiDir, rawDir, ollamaBaseUrl, ollamaNumCtx, obsidianCompat, embeddings } = parsed
    const resolvedApiKey = resolveProviderCredential(provider, apiKey, providerApiKeys, auth)

    if (!provider || !model || !wikiDir || !rawDir) return null
    if (provider !== 'ollama' && !resolvedApiKey) return null

    const resolvedOllamaUrl =
      process.env['OLLAMA_BASE_URL'] ?? ollamaBaseUrl ?? 'http://localhost:11434/v1'

    return {
      provider,
      apiKey: resolvedApiKey,
      providerApiKeys,
      auth,
      model,
      wikiDir,
      rawDir,
      ollamaBaseUrl: resolvedOllamaUrl,
      ollamaNumCtx,
      obsidianCompat,
      embeddings,
    }
  } catch {
    return null
  }
}

export function getLocalConfig(): AxiomConfig | null {
  const configPath = findLocalConfig()
  if (!configPath) return null
  return readLocalConfig(configPath)
}

export function hasLocalConfig(): boolean {
  return getLocalConfig() !== null
}

export function setLocalConfig(cfg: Partial<AxiomConfig>, configPath?: string): void {
  const target = configPath ?? findLocalConfig() ?? path.join(process.cwd(), LOCAL_CONFIG_FILENAME)

  if (cfg.wikiDir && !path.isAbsolute(cfg.wikiDir)) {
    cfg = { ...cfg, wikiDir: path.resolve(cfg.wikiDir) }
  }
  if (cfg.rawDir && !path.isAbsolute(cfg.rawDir)) {
    cfg = { ...cfg, rawDir: path.resolve(cfg.rawDir) }
  }

  let existing: LocalConfigFile = {}
  try {
    existing = JSON.parse(fs.readFileSync(target, 'utf-8'))
  } catch {
    // File doesn't exist or is empty — start fresh
  }

  const merged = { ...existing, ...cfg }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(merged, null, 2), 'utf-8')
}

export function configScope(): ConfigScope {
  return getLocalConfig() !== null ? 'local' : 'global'
}

/** Clear the cached local config path. Call after renaming the config directory. */
export function clearLocalConfigCache(): void {
  _cachedLocalConfigPath = undefined
}

/** Returns true if the local config is in a legacy `.axiom/` directory. */
export function isLegacyLocalConfig(): boolean {
  const configPath = findLocalConfig()
  if (!configPath) return false
  return configPath.includes('/.axiom/')
}

export function getLocalConfigError(): string | null {
  const configPath = findLocalConfig()
  if (!configPath) return null

  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
    const { provider, model, wikiDir, rawDir } = parsed

    if (!provider || !model || !wikiDir || !rawDir) {
      return `Local config at ${configPath} is missing required fields (provider, model, wikiDir, rawDir).`
    }
    const providerApiKeys = parsed.providerApiKeys as AxiomConfig['providerApiKeys'] | undefined
    const auth = parsed.auth as AxiomConfig['auth'] | undefined
    const hasProviderKey = Boolean(resolveProviderCredential(provider, parsed.apiKey as string | undefined, providerApiKeys, auth))
    if (provider !== 'ollama' && !hasProviderKey) {
      return `Local config at ${configPath} is missing apiKey for provider '${provider}'.`
    }
    return null
  } catch (e) {
    return `Local config at ${configPath} could not be parsed: ${e instanceof Error ? e.message : String(e)}`
  }
}

export function getConfig(): AxiomConfig | null {
  const local = getLocalConfig()
  if (local) return local
  return getGlobalConfig()
}

export function setConfig(cfg: Partial<AxiomConfig>): void {
  const localPath = findLocalConfig()
  if (localPath) {
    setLocalConfig(cfg, localPath)
  } else {
    for (const [key, value] of Object.entries(cfg)) {
      store.set(key as keyof AxiomConfig, value)
    }
  }
}

export function hasConfig(): boolean {
  return getConfig() !== null
}

export function clearConfig(scope?: ConfigScope): void {
  const target = scope ?? configScope()
  if (target === 'local') {
    const localPath = findLocalConfig()
    if (localPath) fs.writeFileSync(localPath, '{}', 'utf-8')
  } else {
    store.clear()
  }
}
