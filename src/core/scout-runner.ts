import crypto from 'crypto'
import http from 'http'
import os from 'os'

import type { AxiomConfig } from '../config/index.js'
import {
  DEFAULT_SCOUT_PORT,
  SCOUT_DROP_DIR,
  SCOUT_MENTION,
  SCOUT_NAME,
  clearScoutHeartbeat,
  drainScout,
  publicScoutItem,
  queueShare,
  scanScoutDrop,
  scoutSummary,
  scoutToken,
  writeScoutHeartbeat,
  loadScoutItems,
  type ScoutDrainResult,
} from './scout.js'

/**
 * The always-on side of Scout: a tiny HTTP listener for share sheets, curl,
 * shortcuts, and the bookmarklet, plus a timer that drains the queue.
 *
 * It is deliberately not the web server. The listener stays up when the UI is
 * closed, and it can run on the LAN (`--host 0.0.0.0`) so a phone can hand it
 * a link. Every mutating request needs the token from `scout/token`.
 */

export interface ScoutRunnerOptions {
  port?: number
  host?: string
  /** Compile sources into the wiki. False only clips them into raw/. */
  ingest?: boolean
  /** Also scan `scout/drop/` for files. */
  drop?: boolean
  pollMs?: number
  onStatus?: (line: string) => void
  onDrain?: (result: ScoutDrainResult) => void
}

export interface ScoutRunnerInfo {
  host: string
  port: number
  token: string
  url: string
  /** Reachable LAN address when bound to 0.0.0.0/::. */
  lanUrl?: string
}

function lanAddress(): string | null {
  const interfaces = os.networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return null
}

const MAX_BODY_BYTES = 1_000_000

export class ScoutRunner {
  readonly config: AxiomConfig
  private readonly options: ScoutRunnerOptions
  private server: http.Server | null = null
  private timer: NodeJS.Timeout | null = null
  private draining: Promise<ScoutDrainResult> | null = null
  private startedAt = new Date().toISOString()
  private info: ScoutRunnerInfo | null = null

  constructor(config: AxiomConfig, options: ScoutRunnerOptions = {}) {
    this.config = config
    this.options = options
  }

  get running(): boolean {
    return this.server !== null
  }

  async start(): Promise<ScoutRunnerInfo> {
    if (this.server) return this.info as ScoutRunnerInfo

    const host = this.options.host ?? '127.0.0.1'
    const port = this.options.port ?? DEFAULT_SCOUT_PORT
    const token = scoutToken(this.config.wikiDir)

    this.server = http.createServer((req, res) => {
      void this.handle(req, res, token)
    })

    await new Promise<void>((resolve, reject) => {
      const server = this.server as http.Server
      const onError = (err: Error) => {
        server.off('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, host)
    })

    const bound = this.server.address()
    const boundPort = typeof bound === 'object' && bound ? bound.port : port
    const printableHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
    const lan = host === '0.0.0.0' || host === '::' ? lanAddress() : null
    this.info = {
      host,
      port: boundPort,
      token,
      url: `http://${printableHost}:${boundPort}`,
      ...(lan ? { lanUrl: `http://${lan}:${boundPort}` } : {}),
    }
    this.startedAt = new Date().toISOString()
    this.heartbeat()

    const pollMs = Math.max(1000, this.options.pollMs ?? 5000)
    this.timer = setInterval(() => {
      void this.tick()
    }, pollMs)
    this.timer.unref?.()

    // Pick up anything queued before the process started.
    void this.tick()
    return this.info
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    const server = this.server
    this.server = null
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    clearScoutHeartbeat(this.config.wikiDir)
    this.info = null
  }

  /** Drains the queue immediately, coalescing concurrent callers. */
  drainNow(): Promise<ScoutDrainResult> {
    if (this.draining) return this.draining
    this.draining = drainScout(this.config, {
      ingest: this.options.ingest !== false,
      onStatus: this.options.onStatus,
    })
      .then((result) => {
        this.options.onDrain?.(result)
        return result
      })
      .finally(() => {
        this.draining = null
      })
    return this.draining
  }

  private heartbeat(): void {
    if (!this.info) return
    writeScoutHeartbeat(this.config.wikiDir, {
      pid: process.pid,
      host: this.info.host,
      port: this.info.port,
      startedAt: this.startedAt,
      heartbeatAt: new Date().toISOString(),
      ...(this.info.lanUrl ? { lanUrl: this.info.lanUrl } : {}),
    })
  }

  private async tick(): Promise<void> {
    this.heartbeat()
    try {
      if (this.options.drop !== false) scanScoutDrop(this.config.wikiDir)
    } catch {
      /* an unreadable drop stays put for the next pass */
    }
    if (scoutSummary(this.config.wikiDir).pending === 0) return
    await this.drainNow()
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse, token: string): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    const send = (status: number, body: unknown) => {
      const payload = JSON.stringify(body, null, 2)
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Scout-Token, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Length': Buffer.byteLength(payload),
      })
      res.end(payload)
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Scout-Token, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      })
      res.end()
      return
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      const summary = scoutSummary(this.config.wikiDir)
      send(200, { ok: true, name: SCOUT_NAME, mention: SCOUT_MENTION, pending: summary.pending })
      return
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const text = [
        `${SCOUT_NAME} — always-on intake for Axiom Wiki`,
        '',
        'POST /share   {"url": "https://…", "tags": ["read-later"], "note": "why" }',
        'POST /text    {"text": "a pasted thread #tag @scout"}',
        'GET  /queue?token=…',
        'GET  /healthz',
        '',
        'Every request except /healthz needs the token from scout/token.',
        `Drop files into ${SCOUT_DROP_DIR}/ to queue them without HTTP.`,
        '',
      ].join('\n')
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(text)
      return
    }

    if (!authorize(req, url, token)) {
      send(401, { error: 'Missing or invalid Scout token.' })
      return
    }

    if (req.method === 'GET' && url.pathname === '/queue') {
      const summary = scoutSummary(this.config.wikiDir)
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200)
      const items = loadScoutItems(this.config.wikiDir)
        .slice(-limit)
        .reverse()
        .map(publicScoutItem)
      send(200, { summary, items })
      return
    }

    if (req.method === 'POST' && (url.pathname === '/share' || url.pathname === '/text')) {
      let body: Record<string, unknown>
      try {
        body = await readBody(req)
      } catch (err) {
        send(400, { error: err instanceof Error ? err.message : String(err) })
        return
      }

      try {
        const input =
          url.pathname === '/text'
            ? { text: stringField(body, 'text'), tags: tagField(body['tags']), note: stringField(body, 'note'), source: 'text' }
            : {
                url: stringField(body, 'url'),
                text: stringField(body, 'text'),
                tags: tagField(body['tags']),
                note: stringField(body, 'note'),
                source: 'share',
              }
        const outcome = queueShare(this.config.wikiDir, input)
        send(202, {
          ok: true,
          added: outcome.added.map(publicScoutItem),
          duplicates: outcome.duplicates.map(publicScoutItem),
          parsed: outcome.parsed,
          summary: scoutSummary(this.config.wikiDir),
        })
        // Let the request settle, then work through the queue.
        setImmediate(() => {
          void this.drainNow().catch(() => {})
        })
      } catch (err) {
        send(400, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    if (req.method === 'POST' && url.pathname === '/drain') {
      try {
        const result = await this.drainNow()
        send(202, result)
      } catch (err) {
        send(500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    send(404, { error: `Unknown Scout path “${url.pathname}”.` })
  }
}

function authorize(req: http.IncomingMessage, url: URL, token: string): boolean {
  const header = req.headers['x-scout-token']
  const bearer = req.headers['authorization']
  const provided =
    (Array.isArray(header) ? header[0] : header) ??
    (typeof bearer === 'string' && bearer.toLowerCase().startsWith('bearer ')
      ? bearer.slice(7).trim()
      : undefined) ??
    url.searchParams.get('token') ??
    ''
  if (!provided || provided.length !== token.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(token))
  } catch {
    return false
  }
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function tagField(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map((tag) => tag.replace(/^#/, '').trim())
      .filter(Boolean)
  }
  return []
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new Error('Body is too large (limit 1 MB).')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) return {}

  const type = String(req.headers['content-type'] ?? '')
  if (type.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      throw new Error('Body is not valid JSON.')
    }
  }

  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw))
  }

  // A share sheet that sends the URL as a plain body is the common case.
  return { text: raw }
}
