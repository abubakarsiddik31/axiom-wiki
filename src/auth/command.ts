import crypto from 'node:crypto'
import http from 'node:http'
import readline from 'node:readline/promises'
import { spawn } from 'node:child_process'
import { stdin as input, stdout as output } from 'node:process'
import { URL } from 'node:url'
import { configScope, getConfig, setConfig, type AxiomConfig } from '../config/index.js'
import { getDefaultModel } from '../config/models.js'

type AuthProvider = 'openai'

type AuthOptions = {
  apiKey?: string
  activate?: boolean
  oauth?: boolean
  noOpen?: boolean
  clientId?: string
  authUrl?: string
  tokenUrl?: string
  scope?: string
  redirectPort?: string
}

interface OpenAITokenResponse {
  access_token: string
  token_type?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

const DEFAULT_SCOPE = 'openid profile email'

function isAuthProvider(value: string): value is AuthProvider {
  return value === 'openai'
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return '•'.repeat(Math.max(key.length, 4))
  return `${key.slice(0, 4)}${'•'.repeat(Math.max(key.length - 8, 4))}${key.slice(-4)}`
}

function maskToken(token: string): string {
  if (token.length <= 10) return '•'.repeat(Math.max(token.length, 6))
  return `${token.slice(0, 6)}…${token.slice(-4)}`
}

function getOpenAiOAuthSettings(opts?: AuthOptions): {
  clientId: string
  authUrl: string
  tokenUrl: string
  scope: string
  redirectPort: number
} {
  const clientId = opts?.clientId || process.env['AXIOM_OPENAI_OAUTH_CLIENT_ID'] || process.env['OPENAI_OAUTH_CLIENT_ID']
  const authUrl = opts?.authUrl || process.env['AXIOM_OPENAI_OAUTH_AUTH_URL']
  const tokenUrl = opts?.tokenUrl || process.env['AXIOM_OPENAI_OAUTH_TOKEN_URL']
  const scope = opts?.scope || process.env['AXIOM_OPENAI_OAUTH_SCOPE'] || DEFAULT_SCOPE
  const redirectPortRaw = opts?.redirectPort || process.env['AXIOM_OPENAI_OAUTH_PORT'] || '8787'
  const redirectPort = Number.parseInt(redirectPortRaw, 10)

  if (!clientId || !authUrl || !tokenUrl) {
    throw new Error(
      'OAuth not configured. Set AXIOM_OPENAI_OAUTH_CLIENT_ID, AXIOM_OPENAI_OAUTH_AUTH_URL, and AXIOM_OPENAI_OAUTH_TOKEN_URL.'
    )
  }
  if (!Number.isFinite(redirectPort) || redirectPort <= 0 || redirectPort > 65535) {
    throw new Error(`Invalid redirect port: ${redirectPortRaw}`)
  }

  return { clientId, authUrl, tokenUrl, scope, redirectPort }
}

function getProviderKey(config: AxiomConfig | null, provider: AuthProvider): string {
  if (!config) return ''
  if (config.provider === provider && config.apiKey) return config.apiKey
  return config.providerApiKeys?.[provider] ?? ''
}

function getOpenAiAuthState(config: AxiomConfig | null): AxiomConfig['auth'] extends infer T ? T : never {
  return config?.auth
}

async function promptForApiKey(provider: AuthProvider): Promise<string> {
  const rl = readline.createInterface({ input, output })
  try {
    const answer = await rl.question(`Enter ${provider === 'openai' ? 'OpenAI' : provider} API key: `)
    return answer.trim()
  } finally {
    rl.close()
  }
}

function saveProviderKey(provider: AuthProvider, apiKey: string, activate: boolean): void {
  const existing = getConfig()
  const providerApiKeys = {
    ...(existing?.providerApiKeys ?? {}),
    [provider]: apiKey,
  }

  const patch: Partial<AxiomConfig> = {
    providerApiKeys,
    auth: {
      ...(existing?.auth ?? {}),
      openai: {
        method: 'apikey',
        configuredAt: new Date().toISOString(),
      },
    },
  }

  if (existing?.provider === provider) {
    patch.apiKey = apiKey
  }

  if (activate) {
    patch.provider = provider
    patch.apiKey = apiKey
    patch.model = getDefaultModel(provider).id
  }

  setConfig(patch)
}

function randomUrlSafe(bytes: number): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

function createPkce() {
  const codeVerifier = randomUrlSafe(64)
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

function openUrlInBrowser(url: string): boolean {
  const platform = process.platform
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open'

  try {
    const child = spawn(cmd, [url], {
      stdio: 'ignore',
      detached: true,
      shell: platform === 'win32',
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

async function waitForOAuthCode(redirectUri: string, expectedState: string): Promise<string> {
  const redirect = new URL(redirectUri)
  const hostname = redirect.hostname
  const port = Number.parseInt(redirect.port, 10)
  const callbackPath = redirect.pathname || '/oauth/callback'

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('OAuth timed out after 5 minutes.'))
    }, 5 * 60 * 1000)

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://${hostname}:${port}`)
      if (reqUrl.pathname !== callbackPath) {
        res.statusCode = 404
        res.end('Not found')
        return
      }

      const error = reqUrl.searchParams.get('error')
      if (error) {
        const desc = reqUrl.searchParams.get('error_description') ?? 'OAuth callback returned an error.'
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(`OAuth failed: ${desc}`)
        clearTimeout(timeout)
        server.close()
        reject(new Error(`OAuth failed: ${error} (${desc})`))
        return
      }

      const code = reqUrl.searchParams.get('code')
      const state = reqUrl.searchParams.get('state')
      if (!code || !state) {
        res.statusCode = 400
        res.end('Missing code or state')
        return
      }

      if (state !== expectedState) {
        res.statusCode = 400
        res.end('State mismatch. Please retry.')
        clearTimeout(timeout)
        server.close()
        reject(new Error('State mismatch in OAuth callback.'))
        return
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end('<html><body><h2>Axiom Wiki auth complete.</h2><p>You can close this tab and return to your terminal.</p></body></html>')

      clearTimeout(timeout)
      server.close()
      resolve(code)
    })

    server.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    server.listen(port, hostname)
  })
}

async function exchangeOAuthCode(input: {
  tokenUrl: string
  clientId: string
  code: string
  codeVerifier: string
  redirectUri: string
}): Promise<OpenAITokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
  })

  const res = await fetch(input.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })

  if (!res.ok) {
    const msg = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${msg}`)
  }

  const json = await res.json() as OpenAITokenResponse
  if (!json.access_token) throw new Error('Token response missing access_token')
  return json
}

async function runOpenAiOAuth(opts?: AuthOptions): Promise<void> {
  const settings = getOpenAiOAuthSettings(opts)
  const redirectUri = `http://127.0.0.1:${settings.redirectPort}/oauth/callback`
  const state = randomUrlSafe(24)
  const { codeVerifier, codeChallenge } = createPkce()

  const authUrl = new URL(settings.authUrl)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', settings.clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', settings.scope)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  console.log('Starting OpenAI OAuth...')
  console.log(`Callback URL: ${redirectUri}`)

  const opened = opts?.noOpen ? false : openUrlInBrowser(authUrl.toString())
  if (!opened) {
    console.log('Open this URL in your browser to continue:')
    console.log(authUrl.toString())
  }

  const code = await waitForOAuthCode(redirectUri, state)
  const token = await exchangeOAuthCode({
    tokenUrl: settings.tokenUrl,
    clientId: settings.clientId,
    code,
    codeVerifier,
    redirectUri,
  })

  const now = Date.now()
  const expiresAt = token.expires_in ? new Date(now + token.expires_in * 1000).toISOString() : undefined
  const existing = getConfig()

  const patch: Partial<AxiomConfig> = {
    auth: {
      ...(existing?.auth ?? {}),
      openai: {
        method: 'oauth',
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenType: token.token_type,
        scope: token.scope,
        expiresAt,
        configuredAt: new Date().toISOString(),
      },
    },
    providerApiKeys: {
      ...(existing?.providerApiKeys ?? {}),
      openai: token.access_token,
    },
  }

  if (existing?.provider === 'openai' || opts?.activate) {
    patch.provider = 'openai'
    patch.apiKey = token.access_token
    patch.model = getDefaultModel('openai').id
  }

  setConfig(patch)

  console.log('OpenAI OAuth authentication saved.')
  console.log('Note: ChatGPT subscription and API billing are currently separate in OpenAI docs.')
  if (expiresAt) console.log(`Access token expires at: ${expiresAt}`)
  if (opts?.activate) {
    console.log(`OpenAI is now the active provider with default model \`${getDefaultModel('openai').id}\`.`)
  }
}

export async function runAuthCommand(subcommand?: string, opts?: AuthOptions): Promise<void> {
  const command = (subcommand ?? '').trim().toLowerCase()

  if (!command || command === 'help') {
    console.log('Usage:')
    console.log('  axiom-wiki auth openai [--api-key <key>] [--activate]')
    console.log('  axiom-wiki auth openai --oauth [--activate] [--no-open]')
    console.log('  axiom-wiki auth status')
    console.log('  axiom-wiki auth logout openai')
    console.log('')
    console.log('OAuth env (required for --oauth):')
    console.log('  AXIOM_OPENAI_OAUTH_CLIENT_ID, AXIOM_OPENAI_OAUTH_AUTH_URL, AXIOM_OPENAI_OAUTH_TOKEN_URL')
    return
  }

  if (command === 'status') {
    const cfg = getConfig()
    const scope = configScope()
    const key = getProviderKey(cfg, 'openai')
    const auth = getOpenAiAuthState(cfg)
    const oauth = auth?.openai
    const viaEnv = process.env['OPENAI_API_KEY'] ? 'yes' : 'no'

    console.log('Authentication status')
    console.log(`  Scope: ${scope}`)
    console.log(`  OpenAI key saved: ${key ? 'yes' : 'no'}`)
    if (key) console.log(`  Saved key: ${maskApiKey(key)}`)
    if (oauth?.method === 'oauth') {
      console.log('  OpenAI auth method: oauth')
      if (oauth.accessToken) console.log(`  OAuth token: ${maskToken(oauth.accessToken)}`)
      if (oauth.expiresAt) console.log(`  OAuth expiresAt: ${oauth.expiresAt}`)
    } else if (oauth?.method === 'apikey') {
      console.log('  OpenAI auth method: apikey')
    }
    console.log(`  OPENAI_API_KEY env present: ${viaEnv}`)
    if (cfg) console.log(`  Active provider: ${cfg.provider}`)
    return
  }

  if (command === 'logout') {
    console.error('Specify a provider, e.g. `axiom-wiki auth logout openai`.')
    process.exitCode = 1
    return
  }

  if (command.startsWith('logout ')) {
    const provider = command.replace(/^logout\s+/, '')
    if (!isAuthProvider(provider)) {
      console.error(`Unsupported provider: ${provider}. Currently supported: openai`)
      process.exitCode = 1
      return
    }

    const cfg = getConfig()
    if (cfg?.provider === provider) {
      console.error(`Cannot logout ${provider} while it is the active provider. Switch provider first via \`axiom-wiki model\`.`)
      process.exitCode = 1
      return
    }

    const nextProviderKeys = { ...(cfg?.providerApiKeys ?? {}) }
    delete nextProviderKeys[provider]
    const nextAuth = { ...(cfg?.auth ?? {}) }
    delete nextAuth.openai

    setConfig({ providerApiKeys: nextProviderKeys, auth: nextAuth })
    console.log(`Logged out from ${provider}. Stored credentials removed.`)
    return
  }

  if (!isAuthProvider(command)) {
    console.error(`Unsupported auth command: ${command}`)
    console.error('Try: `axiom-wiki auth openai`, `axiom-wiki auth status`, or `axiom-wiki auth logout openai`.')
    process.exitCode = 1
    return
  }

  if (opts?.oauth) {
    await runOpenAiOAuth(opts)
    return
  }

  const apiKey = (opts?.apiKey?.trim() || await promptForApiKey(command)).trim()
  if (!apiKey) {
    console.error('API key is required.')
    process.exitCode = 1
    return
  }

  if (!apiKey.startsWith('sk-')) {
    console.error('OpenAI API keys usually start with `sk-`. Please verify and retry.')
    process.exitCode = 1
    return
  }

  saveProviderKey(command, apiKey, Boolean(opts?.activate))
  console.log('OpenAI authentication saved.')
  if (opts?.activate) {
    console.log(`OpenAI is now the active provider with default model \`${getDefaultModel('openai').id}\`.`)
  } else {
    console.log('Tip: run `axiom-wiki auth openai --activate` to switch to OpenAI now.')
  }
}
