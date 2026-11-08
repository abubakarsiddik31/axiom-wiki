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
      rerank: { provider: 'none' },
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

  it('previews the graph context for a question', async () => {
    const res = await fetch(`${base}/api/v1/actions/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'paper' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.sources)).toBe(true)
    expect(body.sources.length).toBeGreaterThan(0)
    expect(body.text).toContain('## Retrieved wiki evidence')
    expect(body.estimatedTokens).toBeGreaterThan(0)
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

  it('previews graph context in read-only mode', async () => {
    const res = await fetch(`${base}/api/v1/actions/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'paper' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).sources.length).toBeGreaterThan(0)
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

  it('refuses capture in read-only mode', async () => {
    const res = await fetch(`${base}/api/v1/actions/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Axiom-Write': '1' },
      body: JSON.stringify({ text: 'nope' }),
    })
    expect(res.status).toBe(403)
  })

  it('plans maintenance but refuses to apply it', async () => {
    const plan = await fetch(`${base}/api/v1/actions/maintain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links: false, duplicates: false }),
    })
    expect(plan.status).toBe(200)
    const body = await plan.json()
    expect(body.counts.pages).toBeGreaterThan(0)

    const apply = await fetch(`${base}/api/v1/actions/maintain/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Axiom-Write': '1' },
      body: JSON.stringify({}),
    })
    expect(apply.status).toBe(403)
  })

  it('refuses settings changes and reranker setup', async () => {
    const save = await fetch(`${base}/api/v1/actions/settings/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Axiom-Write': '1' },
      body: JSON.stringify({ rerank: { provider: 'none' } }),
    })
    expect(save.status).toBe(403)

    const setup = await fetch(`${base}/api/v1/actions/rerank/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Axiom-Write': '1' },
      body: JSON.stringify({}),
    })
    expect(setup.status).toBe(403)

    const scout = await fetch(`${base}/api/v1/actions/scout/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Axiom-Write': '1' },
      body: JSON.stringify({ text: 'not allowed' }),
    })
    expect(scout.status).toBe(403)
  })

  it('exposes the reranker settings in the config payload', async () => {
    const config = await (await fetch(`${base}/api/v1/config`)).json()
    expect(config.rerank).toMatchObject({
      provider: 'none',
      topN: 6,
      candidates: 24,
    })
    expect(config.rerank.presets.map((preset: { key: string }) => preset.key)).toEqual([
      'fast',
      'balanced',
      'multilingual',
    ])
  })
})

describe('page curation actions', () => {
  const { wikiDir, config } = scaffold()
  let server: Server | null = null
  let base = ''
  let savedConfig: Partial<AxiomConfig> | null = null

  beforeAll(async () => {
    // A git repo makes history and scoped commits real rather than mocked.
    const { execFileSync } = await import('child_process')
    const git = (args: string[]) => execFileSync('git', args, { cwd: wikiDir, stdio: 'ignore' })
    git(['init'])
    git(['config', 'user.email', 'test@example.com'])
    git(['config', 'user.name', 'Axiom Test'])
    git(['add', '.'])
    git(['commit', '-m', 'seed'])

    server = await startServer({
      config,
      port: 0,
      host: '127.0.0.1',
      quiet: true,
      staticDir: false,
      allowWrite: true,
      saveConfig: (cfg) => {
        savedConfig = cfg
      },
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

  it('previews markdown without requiring write mode headers', async () => {
    const res = await fetch(`${base}/api/v1/actions/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '# Hello\n\nWorld' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).html).toContain('<h1')
  })

  it('creates and edits a page, returning its body for the editor', async () => {
    const created = await post('page/save', {
      category: 'concepts',
      title: 'Computability',
      summary: 'What can be computed',
      tags: ['logic', 'computing'],
      body: 'Alan Turing defined computability.',
    })
    expect(created.status).toBe(200)
    const result = await created.json()
    expect(result.created).toBe(true)
    expect(result.id).toBe('concepts/computability')

    const page = await (await fetch(`${base}/api/v1/pages/concepts/computability`)).json()
    expect(page.body).toContain('Alan Turing defined computability.')
    expect(page.frontmatter.tags).toEqual(['logic', 'computing'])

    const edited = await post('page/save', {
      id: 'concepts/computability',
      title: 'Computability',
      body: 'Edited body.',
    })
    expect(edited.status).toBe(200)
    expect((await edited.json()).created).toBe(false)
  })

  it('reports unlinked mentions and related pages', async () => {
    const body = await (await fetch(`${base}/api/v1/pages/entities/thing/links`)).json()
    expect(body.id).toBe('entities/thing')
    // "Thing" is mentioned by the related concept page's body? No — assert shape
    // and that the endpoint is wired, not a specific corpus.
    expect(Array.isArray(body.unlinked)).toBe(true)
    expect(Array.isArray(body.related)).toBe(true)
  })

  it('wraps an unlinked mention into a wiki-link', async () => {
    await post('page/save', {
      category: 'analyses',
      title: 'Survey',
      body: 'The Thing matters a great deal.',
    })

    const linked = await post('link/insert', {
      sourceId: 'analyses/survey',
      targetId: 'entities/thing',
    })
    expect(linked.status).toBe(200)
    const survey = fs.readFileSync(path.join(wikiDir, 'wiki/pages/analyses/survey.md'), 'utf-8')
    expect(survey).toContain('[[entities/thing|Thing]]')

    // The shared link index must be invalidated synchronously: reading it right
    // after the write should not still report the mention as unlinked.
    const after = await (await fetch(`${base}/api/v1/pages/entities/thing/links`)).json()
    expect(after.unlinked.map((mention: { id: string }) => mention.id)).not.toContain(
      'analyses/survey',
    )
  })

  it('renames a page and rewrites inbound links', async () => {
    await post('page/save', {
      category: 'concepts',
      title: 'Variance',
      body: 'Links to [[entities/thing]].',
    })

    const res = await post('page/rename', { id: 'entities/thing', newId: 'concepts/thing' })
    expect(res.status).toBe(200)
    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages/entities/thing.md'))).toBe(false)
    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages/concepts/thing.md'))).toBe(true)

    const variance = fs.readFileSync(path.join(wikiDir, 'wiki/pages/concepts/variance.md'), 'utf-8')
    expect(variance).toContain('[[concepts/thing]]')
  })

  it('serves history and diffs for a page', async () => {
    const history = await (await fetch(`${base}/api/v1/pages/concepts/variance/history`)).json()
    expect(history.available).toBe(true)
    expect(history.commits.length).toBeGreaterThan(0)

    const rev = history.commits[0].hash
    const diff = await fetch(
      `${base}/api/v1/pages/concepts/variance/diff?rev=${encodeURIComponent(rev)}`,
    )
    expect(diff.status).toBe(200)
    expect((await diff.json()).patch).toContain('variance')
  })

  it('restores a previous version', async () => {
    const first = await (await fetch(`${base}/api/v1/pages/concepts/variance/history`)).json()
    const oldest = first.commits[first.commits.length - 1].hash

    await post('page/save', { id: 'concepts/variance', title: 'Variance', body: 'Changed.' })
    const restored = await post('page/restore', { id: 'concepts/variance', rev: oldest })
    expect(restored.status).toBe(200)

    const page = await (await fetch(`${base}/api/v1/pages/concepts/variance`)).json()
    expect(page.body).not.toBe('Changed.')
  })

  it('merges a page into another and deletes the source', async () => {
    await post('page/save', { category: 'concepts', title: 'Alpha', body: 'alpha body' })
    await post('page/save', { category: 'concepts', title: 'Beta', body: 'beta body' })

    const res = await post('page/merge', { source: 'concepts/beta', target: 'concepts/alpha' })
    expect(res.status).toBe(200)
    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages/concepts/beta.md'))).toBe(false)

    const alpha = fs.readFileSync(path.join(wikiDir, 'wiki/pages/concepts/alpha.md'), 'utf-8')
    expect(alpha).toContain('alpha body')
    expect(alpha).toContain('beta body')
  })

  it('deletes a page', async () => {
    await post('page/save', { category: 'concepts', title: 'Disposable', body: 'gone' })
    const res = await post('page/delete', { id: 'concepts/disposable' })
    expect(res.status).toBe(200)
    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages/concepts/disposable.md'))).toBe(false)
  })

  it('captures a note and surfaces it in the overview count', async () => {
    const res = await post('capture', {
      text: 'The halting problem is diagonalisation wearing a hat.',
      title: 'Halting problem note',
      tags: ['logic'],
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('inbox/halting-problem-note')

    const file = fs.readFileSync(path.join(wikiDir, body.path), 'utf-8')
    expect(file).toContain('category: inbox')
    expect(file).toContain('diagonalisation')

    const overview = await (await fetch(`${base}/api/v1/overview`)).json()
    expect(overview.inboxCount).toBe(1)

    // Leave the inbox empty for the promotion test that follows.
    const cleanup = await post('page/delete', { id: body.id })
    expect(cleanup.status).toBe(200)
  })

  it('rejects an empty capture', async () => {
    const res = await post('capture', { text: '   ' })
    expect(res.status).toBe(400)
  })

  it('promotes an inbox note into a category', async () => {
    const created = await post('capture', { text: 'Promote me.', title: 'Promote me' })
    const { id } = await created.json()

    const res = await post('inbox/promote', { id, category: 'concepts' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.newId).toBe('concepts/promote-me')
    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages/inbox/promote-me.md'))).toBe(false)

    const page = await (await fetch(`${base}/api/v1/pages/concepts/promote-me`)).json()
    expect(page.frontmatter.category).toBe('concepts')
    expect(page.frontmatter.tags).not.toContain('inbox')

    const overview = await (await fetch(`${base}/api/v1/overview`)).json()
    expect(overview.inboxCount).toBe(0)
  })

  it('rejects malformed page ids', async () => {
    const res = await post('page/save', { id: '../escape', title: 'X', body: '' })
    expect(res.status).toBe(400)
  })

  it('plans deterministic maintenance', async () => {
    const res = await post('maintain', { links: false, duplicates: false })
    expect(res.status).toBe(200)
    const plan = await res.json()

    expect(plan.counts.pages).toBeGreaterThan(0)
    const ghost = plan.deadLinks.find((link: { to: string }) => link.to === 'concepts/missing')
    expect(ghost).toBeTruthy()
    expect(ghost.creatable).toBe(true)
  })

  it('applies maintenance and creates stubs only when asked', async () => {
    const dry = await post('maintain/apply', {
      summaries: false,
      links: false,
      duplicates: false,
      createStubs: false,
    })
    expect(dry.status).toBe(200)
    expect((await dry.json()).applied.stubs).toBe(0)
    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages/concepts/missing.md'))).toBe(false)

    const res = await post('maintain/apply', {
      summaries: false,
      links: false,
      duplicates: false,
      createStubs: true,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.applied.created).toContain('concepts/missing')
    expect(body.applied.stubs).toBe(body.applied.created.length)
    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages/concepts/missing.md'))).toBe(true)

    const page = await (await fetch(`${base}/api/v1/pages/concepts/missing`)).json()
    expect(page.frontmatter.category).toBe('concepts')
    expect(page.frontmatter.tags).toContain('stub')

    const log = fs.readFileSync(path.join(wikiDir, 'wiki/log.md'), 'utf-8')
    expect(log).toContain('maintain')
  })

  it('queues a share for Scout and drains it into the inbox', async () => {
    const share = await post('scout/share', { text: '@scout a shared thread #read-later' })
    expect(share.status).toBe(200)
    const shared = await share.json()
    expect(shared.added).toHaveLength(1)
    expect(shared.parsed.mentioned).toBe(true)
    expect(shared.parsed.tags).toEqual(['read-later'])

    const before = await (await fetch(`${base}/api/v1/scout`)).json()
    expect(before.summary.pending).toBe(1)
    expect(before.mention).toBe('@scout')
    expect(before.items[0].preview).toContain('shared thread')
    expect(typeof before.token).toBe('string')

    const drain = await post('scout/drain', { ingest: false })
    expect(drain.status).toBe(202)
    const { job } = await drain.json()

    let current: { job: { status: string; result?: { processed?: unknown[] } } } | null = null
    for (let attempt = 0; attempt < 80; attempt += 1) {
      current = await (await fetch(`${base}/api/v1/jobs/${job.id}`)).json()
      if (current?.job.status === 'succeeded' || current?.job.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(current?.job.status).toBe('succeeded')
    expect(current?.job.result?.processed).toHaveLength(1)

    const after = await (await fetch(`${base}/api/v1/scout`)).json()
    expect(after.summary.pending).toBe(0)
    expect(after.summary.done).toBe(1)
    const inbox = fs.readdirSync(path.join(wikiDir, 'wiki/pages/inbox'))
    expect(inbox.length).toBeGreaterThan(0)

    const cleared = await post('scout/clear', {})
    expect(cleared.status).toBe(200)
    expect((await cleared.json()).removed).toBeGreaterThanOrEqual(1)
  })

  it('saves reranker settings without exposing the key', async () => {
    const res = await post('settings/save', {
      rerank: {
        provider: 'cohere',
        model: 'rerank-v3.5',
        topN: 4,
        candidates: 12,
        apiKey: 'cohere-secret',
      },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rerank.provider).toBe('cohere')
    expect(body.rerank.topN).toBe(4)
    expect(body.rerank.candidates).toBe(12)
    expect(body.rerank.hasApiKey).toBe(true)
    expect(JSON.stringify(body)).not.toContain('cohere-secret')

    expect(savedConfig?.rerank).toMatchObject({
      provider: 'cohere',
      topN: 4,
      candidates: 12,
    })

    const config = await (await fetch(`${base}/api/v1/config`)).json()
    expect(config.rerank.provider).toBe('cohere')
    expect(config.rerank.topN).toBe(4)
    expect(config.rerank.candidates).toBe(12)
    expect(JSON.stringify(config)).not.toContain('cohere-secret')

    // Leave the shared fixture rerank-free for any later test.
    const restored = await post('settings/save', { rerank: { provider: 'none' } })
    expect(restored.status).toBe(200)
  })

  it('tests the reranker and reports the fallback when it is off', async () => {
    const res = await post('rerank/test', { query: 'paper' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provider).toBe('none')
    expect(body.used).toBe(false)
    expect(body.results.length).toBeGreaterThan(0)
  })
})
