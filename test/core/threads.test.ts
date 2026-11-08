import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  appendMessage,
  createThread,
  deleteThread,
  historyFor,
  isValidThreadId,
  listThreads,
  loadThread,
  newMessage,
  renameThread,
  threadMarkdown,
  titleFromQuestion,
  type ChatMessage,
} from '../../src/core/threads.js'

function scaffold(): string {
  const wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-threads-'))
  fs.mkdirSync(path.join(wikiDir, 'wiki/pages/analyses'), { recursive: true })
  return wikiDir
}

describe('threads store', () => {
  let wikiDir: string

  beforeEach(() => {
    wikiDir = scaffold()
  })

  afterEach(() => {
    fs.rmSync(wikiDir, { recursive: true, force: true })
  })

  it('creates a thread and lists it newest first', async () => {
    const first = createThread(wikiDir, { title: 'First', at: '2026-01-01T00:00:00.000Z' })
    const second = createThread(wikiDir, { title: 'Second', at: '2026-01-02T00:00:00.000Z' })

    const threads = listThreads(wikiDir)
    expect(threads.map((thread) => thread.id)).toEqual([second.id, first.id])
    expect(threads[0]).toMatchObject({ title: 'Second', messageCount: 0 })
  })

  it('names a titled-new thread from its first question', () => {
    const thread = createThread(wikiDir)
    appendMessage(wikiDir, thread.id, newMessage('user', '  What is the halting problem?  '))

    const loaded = loadThread(wikiDir, thread.id)
    expect(loaded?.title).toBe('What is the halting problem?')
    expect(loaded?.messages).toHaveLength(1)
    expect(loaded?.messages[0]?.role).toBe('user')
  })

  it('keeps the thread title when you rename it', () => {
    const thread = createThread(wikiDir)
    appendMessage(wikiDir, thread.id, newMessage('user', 'first question'))
    renameThread(wikiDir, thread.id, 'Renamed')
    appendMessage(wikiDir, thread.id, newMessage('user', 'second question'))

    expect(loadThread(wikiDir, thread.id)?.title).toBe('Renamed')
  })

  it('persists sources and the rewritten query on an assistant turn', () => {
    const thread = createThread(wikiDir)
    appendMessage(
      wikiDir,
      thread.id,
      newMessage('assistant', 'An answer.', {
        sources: [
          {
            id: 'concepts/logic',
            title: 'Logic',
            category: 'concepts',
            summary: 'Valid inference',
            score: 0.9,
            origin: 'search',
          },
        ],
        rerank: { provider: 'none', model: 'off', used: false },
        searched: 'What is logic?',
      }),
    )

    const turn = loadThread(wikiDir, thread.id)?.messages[0]
    expect(turn?.sources?.[0]?.id).toBe('concepts/logic')
    expect(turn?.searched).toBe('What is logic?')
    expect(turn?.rerank?.provider).toBe('none')
  })

  it('deletes a thread', () => {
    const thread = createThread(wikiDir)
    expect(deleteThread(wikiDir, thread.id)).toBe(true)
    expect(loadThread(wikiDir, thread.id)).toBeNull()
    expect(listThreads(wikiDir)).toHaveLength(0)
    expect(deleteThread(wikiDir, thread.id)).toBe(false)
  })

  it('rejects ids that could escape the chat directory', () => {
    expect(isValidThreadId('thr_abc123')).toBe(true)
    expect(isValidThreadId('../../etc/passwd')).toBe(false)
    expect(loadThread(wikiDir, '../../etc/passwd')).toBeNull()
    expect(deleteThread(wikiDir, '../state')).toBe(false)
  })

  it('caps a thread title', () => {
    const title = titleFromQuestion('word '.repeat(40))
    expect(title.length).toBeLessThanOrEqual(80)
    expect(title.endsWith('…')).toBe(true)
  })
})

describe('historyFor', () => {
  const message = (role: 'user' | 'assistant', content: string, error?: string): ChatMessage => ({
    id: `${role}-${content.length}-${Math.random()}`,
    role,
    content,
    at: '2026-01-01T00:00:00.000Z',
    ...(error ? { error } : {}),
  })

  it('drops failed turns and empty answers', () => {
    const history = historyFor([
      message('user', 'first'),
      message('assistant', 'answer'),
      message('user', 'second'),
      message('assistant', '', 'authentication failed'),
    ])
    expect(history.map((turn) => turn.content)).toEqual(['first', 'answer', 'second'])
  })

  it('starts with a user turn', () => {
    const history = historyFor([message('assistant', 'orphan'), message('user', 'question')])
    expect(history[0]?.role).toBe('user')
  })

  it('truncates long answers', () => {
    const long = 'x'.repeat(5000)
    const history = historyFor([message('user', 'q'), message('assistant', long)], { maxChars: 500 })
    expect(history[1]?.content.length).toBe(501)
    expect(history[1]?.content.endsWith('…')).toBe(true)
  })
})

describe('threadMarkdown', () => {
  it('renders a transcript with grounding links', () => {
    const markdown = threadMarkdown(
      {
        id: 'thr_halting',
        title: 'Halting',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messages: [
          newMessage('user', 'What is the halting problem?'),
          newMessage('assistant', 'It is undecidable.', {
            sources: [
              {
                id: 'concepts/halting',
                title: 'Halting Problem',
                category: 'concepts',
                summary: 'Undecidable',
                score: 1,
                origin: 'search',
              },
            ],
          }),
        ],
      },
      { title: 'Halting', date: '2026-02-02' },
    )

    expect(markdown).toContain('category: analyses')
    expect(markdown).toContain('## 1. What is the halting problem?')
    expect(markdown).toContain('It is undecidable.')
    expect(markdown).toContain('[[concepts/halting|Halting Problem]]')
    expect(markdown).toContain('updatedAt: "2026-02-02"')
  })
})
