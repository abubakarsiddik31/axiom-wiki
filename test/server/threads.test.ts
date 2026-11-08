import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Server } from 'http'

import { startServer } from '../../src/server/index.js'
import { releaseLock } from '../../src/core/lock.js'
import { appendMessage, newMessage } from '../../src/core/threads.js'
import type { AxiomConfig } from '../../src/config/index.js'

function scaffold(): { wikiDir: string; config: AxiomConfig } {
  const wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-threads-api-'))
  const pages = path.join(wikiDir, 'wiki', 'pages')
  fs.mkdirSync(path.join(pages, 'concepts'), { recursive: true })
  fs.mkdirSync(path.join(wikiDir, 'raw'), { recursive: true })
  fs.writeFileSync(
    path.join(pages, 'concepts', 'logic.md'),
    '---\ntitle: "Logic"\nsummary: "Valid inference"\ntags: [logic]\ncategory: concepts\nupdatedAt: "2026-01-01"\n---\n\nLogic.\n',
  )
  fs.writeFileSync(path.join(wikiDir, 'wiki', 'log.md'), '# Wiki Log\n')

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

describe('thread API', () => {
  const { wikiDir, config } = scaffold()
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
    const addr = server.address()
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`

    readOnly = await startServer({
      config,
      port: 0,
      host: '127.0.0.1',
      quiet: true,
      staticDir: false,
      allowWrite: false,
    })
    const roAddr = readOnly.address()
    readOnlyBase = `http://127.0.0.1:${typeof roAddr === 'object' && roAddr ? roAddr.port : 0}`
  })

  afterAll(() => {
    releaseLock(wikiDir)
    server?.close()
    readOnly?.close()
    fs.rmSync(wikiDir, { recursive: true, force: true })
  })

  function post(action: string, body: unknown) {
    return fetch(`${base}/api/v1/actions/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Axiom-Write': '1' },
      body: JSON.stringify(body),
    })
  }

  it('starts with no conversations', async () => {
    const res = await fetch(`${base}/api/v1/threads`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ threads: [] })
  })

  it('creates, lists, and reads a thread', async () => {
    const created = await post('thread/new', { title: 'First thread' })
    expect(created.status).toBe(201)
    const { thread } = await created.json()
    expect(thread.id).toMatch(/^thr_[a-z0-9]+$/)
    expect(thread.title).toBe('First thread')

    const list = await (await fetch(`${base}/api/v1/threads`)).json()
    expect(list.threads).toHaveLength(1)
    expect(list.threads[0]).toMatchObject({ id: thread.id, title: 'First thread', messageCount: 0 })

    const read = await fetch(`${base}/api/v1/threads/${thread.id}`)
    expect(read.status).toBe(200)
    expect((await read.json()).thread.id).toBe(thread.id)
  })

  it('returns 404 for an unknown or malformed thread id', async () => {
    expect((await fetch(`${base}/api/v1/threads/thr_missing0`)).status).toBe(404)
    expect((await fetch(`${base}/api/v1/threads/${encodeURIComponent('../../etc/passwd')}`)).status).toBe(404)
  })

  it('validates thread/ask before starting a job', async () => {
    const missing = await post('thread/ask', {})
    expect(missing.status).toBe(400)

    const unknown = await post('thread/ask', { threadId: 'thr_missing0', question: 'hello' })
    expect(unknown.status).toBe(404)
  })

  it('renames a thread', async () => {
    const { thread } = await (await post('thread/new', {})).json()
    const res = await post('thread/rename', { id: thread.id, title: 'Renamed thread' })
    expect(res.status).toBe(200)
    expect((await res.json()).thread.title).toBe('Renamed thread')
  })

  it('files a conversation as an analysis page', async () => {
    const { thread } = await (await post('thread/new', { title: 'Halting' })).json()
    appendMessage(wikiDir, thread.id, newMessage('user', 'What is the halting problem?'))
    appendMessage(
      wikiDir,
      thread.id,
      newMessage('assistant', 'It is undecidable.', {
        sources: [
          {
            id: 'concepts/logic',
            title: 'Logic',
            category: 'concepts',
            summary: 'Valid inference',
            score: 1,
            origin: 'search',
          },
        ],
      }),
    )

    const res = await post('thread/save', { id: thread.id })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toMatch(/^wiki\/pages\/analyses\//)

    const page = fs.readFileSync(path.join(wikiDir, body.path), 'utf-8')
    expect(page).toContain('## 1. What is the halting problem?')
    expect(page).toContain('It is undecidable.')
    expect(page).toContain('[[concepts/logic|Logic]]')
    expect(page).toContain('category: analyses')
  })

  it('deletes a thread', async () => {
    const { thread } = await (await post('thread/new', {})).json()
    const res = await post('thread/delete', { id: thread.id })
    expect(res.status).toBe(200)
    expect((await fetch(`${base}/api/v1/threads/${thread.id}`)).status).toBe(404)
  })

  it('keeps conversations readable but immutable in read-only mode', async () => {
    const list = await fetch(`${readOnlyBase}/api/v1/threads`)
    expect(list.status).toBe(200)

    const create = await fetch(`${readOnlyBase}/api/v1/actions/thread/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Axiom-Write': '1' },
      body: JSON.stringify({}),
    })
    expect(create.status).toBe(403)
  })
})
