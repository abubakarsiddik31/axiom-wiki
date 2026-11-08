import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { ScoutRunner, type ScoutRunnerInfo } from '../../src/core/scout-runner.js'
import { liveScoutWorker, loadScoutItems, scoutToken } from '../../src/core/scout.js'
import type { AxiomConfig } from '../../src/config/index.js'

describe('Scout listener', () => {
  let root: string
  let config: AxiomConfig
  let runner: ScoutRunner
  let info: ScoutRunnerInfo

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-scout-runner-'))
    fs.mkdirSync(path.join(root, 'wiki/pages/concepts'), { recursive: true })
    fs.mkdirSync(path.join(root, 'raw'), { recursive: true })
    fs.writeFileSync(path.join(root, 'wiki/log.md'), '# Wiki Log\n')
    fs.writeFileSync(
      path.join(root, 'wiki/pages/concepts/logic.md'),
      '---\ntitle: "Logic"\nsummary: "Valid inference"\ntags: [logic]\ncategory: concepts\nupdatedAt: "2026-01-01"\n---\n\nLogic.\n',
    )
    config = {
      wikiDir: root,
      rawDir: path.join(root, 'raw'),
      provider: 'openai',
      apiKey: 'test',
      model: 'gpt-4o-mini',
      rerank: { provider: 'none' },
    } as unknown as AxiomConfig

    runner = new ScoutRunner(config, { port: 0, host: '127.0.0.1', ingest: false, pollMs: 60_000 })
    info = await runner.start()
  })

  afterAll(async () => {
    await runner.stop()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('reports health without a token', async () => {
    const res = await fetch(`${info.url}/healthz`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, name: 'Scout', mention: '@scout' })
  })

  it('rejects a share without the token', async () => {
    const res = await fetch(`${info.url}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/no-token' }),
    })
    expect(res.status).toBe(401)
    expect(loadScoutItems(root)).toHaveLength(0)
  })

  it('queues a share with the token and drains it', async () => {
    const token = scoutToken(root)
    const res = await fetch(`${info.url}/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scout-Token': token },
      body: JSON.stringify({ text: 'A shared thought #read-later' }),
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.added).toHaveLength(1)
    expect(body.parsed.tags).toEqual(['read-later'])

    const queue = await fetch(`${info.url}/queue?token=${encodeURIComponent(token)}`)
    expect(queue.status).toBe(200)
    const queued = await queue.json()
    expect(queued.items).toHaveLength(1)

    // The listener schedules a drain after the response.
    let item = loadScoutItems(root)[0]
    for (let attempt = 0; attempt < 60 && item?.status !== 'done'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      item = loadScoutItems(root)[0]
    }
    expect(item?.status).toBe('done')
    expect(item?.result?.inbox).toMatch(/^inbox\//)
  })

  it('accepts a note as a plain-text body', async () => {
    const token = scoutToken(root)
    const res = await fetch(`${info.url}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'X-Scout-Token': token },
      body: 'A plain body note #plain',
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.added[0]?.kind).toBe('text')
    expect(body.parsed.tags).toEqual(['plain'])
  })

  it('writes a live heartbeat and clears it on stop', async () => {
    expect(liveScoutWorker(root)).toMatchObject({ pid: process.pid, port: info.port })
    const token = scoutToken(root)
    await runner.stop()
    expect(liveScoutWorker(root)).toBeNull()

    // Restart so afterAll has something to close.
    runner = new ScoutRunner(config, { port: 0, host: '127.0.0.1', ingest: false, pollMs: 60_000 })
    info = await runner.start()
    expect(token).toBe(scoutToken(root))
  })
})
