import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Server } from 'http'

import { startServer } from '../../src/server/index.js'
import { releaseLock } from '../../src/core/lock.js'
import type { AxiomConfig } from '../../src/config/index.js'

function scaffold(): { wikiDir: string; config: AxiomConfig } {
  const wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-actions-'))
  const pages = path.join(wikiDir, 'wiki', 'pages')
  fs.mkdirSync(path.join(pages, 'sources'), { recursive: true })
  fs.mkdirSync(path.join(pages, 'entities'), { recursive: true })
  fs.mkdirSync(path.join(wikiDir, 'raw'), { recursive: true })

  fs.writeFileSync(
    path.join(pages, 'sources', 'paper-summary.md'),
    `---\ntitle: "Paper"\nsummary: "A paper"\ntags: [source]\ncategory: sources\nsources: [paper.pdf]\nupdatedAt: "2026-01-01"\n---\n\nSummary.\n`,
  )
  fs.writeFileSync(
    path.join(pages, 'entities', 'thing.md'),
    `---\ntitle: "Thing"\nsummary: "A thing"\ntags: [entity]\ncategory: entities\nupdatedAt: "2026-01-01"\n---\n\nLinks to [[concepts/missing]].\n`,
  )
  fs.writeFileSync(path.join(wikiDir, 'raw', 'paper.pdf'), 'not really a pdf')
  fs.writeFileSync(
    path.join(wikiDir, 'wiki', 'log.md'),
    '# Wiki Log\n\n## [2026-01-01] ingest | paper.pdf (1 pages)\n',
  )
  fs.writeFileSync(
    path.join(wikiDir, 'state.json'),
    JSON.stringify({
      version: 1,
      sources: {
        'paper.pdf': {
          sha256: 'abc123',
          lastIngestedAt: '2026-01-01',
          sizeBytes: 15,
          concepts: ['wiki/pages/sources/paper-summary.md'],
          truncated: false,
        },
      },
      frozenSlugs: [],
    }),
  )

  return {
    wikiDir,
    config: {
      wikiDir,
      rawDir: path.join(wikiDir, 'raw'),
      provider: 'openai',
      apiKey: 'secret-key',
      model: 'gpt-4o-mini',
    } as unknown as AxiomConfig,
  }
}

describe('action API', () => {
  const { wikiDir, config } = scaffold()
  let server: Server | null = null
  let base = ''

  beforeAll(async () => {
    server = await startServer({
      config,
      port: 0,
      host: '127.0.0.1',
      quiet: true,
      staticDir: false,
      allowWrite: true,
    })
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    base = `http://127.0.0.1:${port}`
  })

  afterAll(() => {
    releaseLock(wikiDir)
    server?.close()
    fs.rmSync(wikiDir, { recursive: true, force: true })
  })

  function post(action: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${base}/api/v1/actions/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Axiom-Write': '1', ...headers },
      body: JSON.stringify(body),
    })
  }

  it('lists sources with state metadata', async () => {
    const res = await fetch(`${base}/api/v1/sources`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sources).toHaveLength(1)
    expect(body.sources[0].filename).toBe('paper.pdf')
    expect(body.sources[0].sha256).toBe('abc123')
    expect(body.rawFiles).toContain('paper.pdf')
  })

  it('reports integrity without heredoc escaping issues', async () => {
    const res = await fetch(`${base}/api/v1/integrity`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.counts.pages).toBe(2)
    expect(body.counts.deadLinks).toBe(1)
    expect(body.deadLinks[0].to).toBe('concepts/missing')
  })

  it('exposes config without credentials', async () => {
    const res = await fetch(`${base}/api/v1/config`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provider).toBe('openai')
    expect(body.writeMode).toBe(true)
    expect(JSON.stringify(body)).not.toContain('secret-key')
    expect(body.embeddings.provider).toBe('none')
  })

  it('allows read-only lint actions without the write header', async () => {
    const res = await fetch(`${base}/api/v1/actions/lint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'integrity' }),
    })
    expect(res.status).toBe(200)
  })

  it('rejects write actions missing X-Axiom-Write', async () => {
    const res = await fetch(`${base}/api/v1/actions/sources/reingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'paper.pdf' }),
    })
    expect(res.status).toBe(403)
  })

  it('rejects files outside raw/', async () => {
    const res = await post('ingest', { file: '../escape.md' })
    expect(res.status).toBe(400)
  })

  it('re-ingests a source by clearing its hash', async () => {
    const res = await post('sources/reingest', { filename: 'paper.pdf' })
    expect(res.status).toBe(200)
    const state = JSON.parse(fs.readFileSync(path.join(wikiDir, 'state.json'), 'utf-8'))
    expect(state.sources['paper.pdf'].sha256).toBe('')
  })

  it('returns 409 when the compilation lock is held', async () => {
    // Pretend another live process (the test runner's parent) holds the lock.
    const lockPath = path.join(wikiDir, 'lock')
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.ppid, acquiredAt: new Date().toISOString() }),
    )
    try {
      const res = await post('sources/delete', { filename: 'paper.pdf' })
      expect(res.status).toBe(409)
    } finally {
      fs.rmSync(lockPath, { force: true })
    }
  })

  it('files an analysis through the lock', async () => {
    const res = await post('analysis/save', {
      question: 'What is the thing?',
      answer: 'A thing.',
      title: 'What is the thing',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toContain('wiki/pages/analyses/')
    expect(fs.existsSync(path.join(wikiDir, body.path))).toBe(true)
  })

  it('starts and stops raw watching', async () => {
    const start = await post('watch/start', {})
    expect(start.status).toBe(200)
    expect((await start.json()).running).toBe(true)

    const status = await (await fetch(`${base}/api/v1/watch`)).json()
    expect(status.running).toBe(true)

    const stop = await post('watch/stop', {})
    expect(stop.status).toBe(200)
    expect((await stop.json()).running).toBe(false)
  })

  it('returns 404 for an unknown job', async () => {
    const res = await fetch(`${base}/api/v1/jobs/missing`)
    expect(res.status).toBe(404)
  })

  it('opens the wiki event stream', async () => {
    const controller = new AbortController()
    const res = await fetch(`${base}/api/v1/events`, { signal: controller.signal })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body?.getReader()
    const first = await reader?.read()
    expect(Buffer.from(first?.value ?? []).toString()).toContain('event: ready')
    controller.abort()
  })
})

describe('read-only action API', () => {
  const { wikiDir, config } = scaffold()
  let server: Server | null = null
  let base = ''

  beforeAll(async () => {
    server = await startServer({
      config,
      port: 0,
      host: '127.0.0.1',
      quiet: true,
      staticDir: false,
    })
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    base = `http://127.0.0.1:${port}`
  })

  afterAll(() => {
    server?.close()
    fs.rmSync(wikiDir, { recursive: true, force: true })
  })

  it('refuses write actions', async () => {
    const res = await fetch(`${base}/api/v1/actions/sources/reingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Axiom-Write': '1' },
      body: JSON.stringify({ filename: 'paper.pdf' }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('--allow-write')
  })

  it('still serves read-only endpoints', async () => {
    expect((await fetch(`${base}/api/v1/pages`)).status).toBe(200)
    expect((await fetch(`${base}/api/v1/integrity`)).status).toBe(200)
  })

  it('does not expose the job queue', async () => {
    const body = await (await fetch(`${base}/api/v1/jobs`)).json()
    expect(body.jobs).toEqual([])
  })

  it('refuses agent lint', async () => {
    const res = await fetch(`${base}/api/v1/actions/lint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'agent' }),
    })
    expect(res.status).toBe(403)
  })
})
