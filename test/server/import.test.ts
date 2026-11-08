import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Server } from 'http'

import { startServer } from '../../src/server/index.js'
import { releaseLock } from '../../src/core/lock.js'
import type { AxiomConfig } from '../../src/config/index.js'

function scaffold() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-import-api-'))
  const wikiDir = path.join(root, 'wiki-root')
  const rawDir = path.join(wikiDir, 'raw')
  const inbox = path.join(root, 'inbox')
  fs.mkdirSync(path.join(wikiDir, 'wiki', 'pages', 'concepts'), { recursive: true })
  fs.mkdirSync(rawDir, { recursive: true })
  fs.mkdirSync(inbox, { recursive: true })
  fs.writeFileSync(path.join(wikiDir, 'wiki', 'log.md'), '# Wiki Log\n')
  fs.writeFileSync(path.join(inbox, 'note.md'), '# Note\n\nImported content.\n')

  return {
    root,
    inbox,
    wikiDir,
    config: {
      wikiDir,
      rawDir,
      provider: 'openai',
      apiKey: 'secret-key',
      model: 'gpt-4o-mini',
      rerank: { provider: 'none' },
    } as unknown as AxiomConfig,
  }
}

const { root, inbox, wikiDir, config } = scaffold()

let server: Server | null = null
let readOnly: Server | null = null
let base = ''
let readOnlyBase = ''

beforeAll(async () => {
  server = await startServer({
    config,
    port: 0,
    host: '127.0.0.1',
    quiet: true,
    staticDir: false,
    allowWrite: true,
  })
  const address = server.address()
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

  readOnly = await startServer({
    config,
    port: 0,
    host: '127.0.0.1',
    quiet: true,
    staticDir: false,
    allowWrite: false,
  })
  const roAddress = readOnly.address()
  readOnlyBase = `http://127.0.0.1:${typeof roAddress === 'object' && roAddress ? roAddress.port : 0}`
})

afterAll(() => {
  releaseLock(wikiDir)
  server?.close()
  readOnly?.close()
  fs.rmSync(root, { recursive: true, force: true })
})

function post(action: string, body: unknown, origin = base) {
  return fetch(`${origin}/api/v1/actions/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Axiom-Write': '1' },
    body: JSON.stringify(body),
  })
}

async function waitForJob(id: string, timeoutMs = 10_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${base}/api/v1/jobs/${id}`)
    const body = (await res.json()) as { job: { status: string; result: unknown; error: string | null } }
    if (['succeeded', 'failed', 'cancelled'].includes(body.job.status)) return body.job
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('job did not settle')
}

describe('import API', () => {
  it('plans without touching the wiki', async () => {
    const res = await post('import/plan', { paths: [inbox] })
    expect(res.status).toBe(200)

    const { plan } = (await res.json()) as { plan: { ready: number; items: Array<{ label: string }> } }
    expect(plan.ready).toBe(1)
    expect(plan.items[0]?.label).toBe('note.md')
    expect(fs.readdirSync(path.join(wikiDir, 'raw'))).toHaveLength(0)
  })

  it('rejects an empty plan body gracefully', async () => {
    const res = await post('import/plan', {})
    expect(res.status).toBe(200)
    const { plan } = (await res.json()) as { plan: { ready: number } }
    expect(plan.ready).toBe(0)
  })

  it('runs as a job, stages files, and reports the result', async () => {
    const res = await post('import/run', { paths: [inbox], ingest: false })
    expect(res.status).toBe(202)

    const { job } = (await res.json()) as { job: { id: string } }
    const settled = await waitForJob(job.id)

    expect(settled.status).toBe('succeeded')
    const result = settled.result as { staged: Array<{ ok: boolean }>; summary: string }
    expect(result.staged.filter((entry) => entry.ok)).toHaveLength(1)
    expect(fs.existsSync(path.join(wikiDir, 'raw', 'note.md'))).toBe(true)
  })

  it('refuses both planning and running on a read-only server', async () => {
    const plan = await post('import/plan', { paths: [inbox] }, readOnlyBase)
    expect(plan.status).toBe(403)

    const run = await post('import/run', { paths: [inbox] }, readOnlyBase)
    expect(run.status).toBe(403)
  })

  it('validates oversized payloads', async () => {
    const res = await post('import/run', { paths: Array.from({ length: 201 }, () => '/tmp/x.md') })
    expect(res.status).toBe(400)
  })
})
