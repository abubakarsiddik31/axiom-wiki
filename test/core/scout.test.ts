import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  appendScoutEvent,
  buildShareItems,
  clearFinishedScoutItems,
  drainScout,
  loadScoutItems,
  normalizeUrl,
  parseShareText,
  queueShare,
  reduceScoutEvents,
  requeueScoutItem,
  scanScoutDrop,
  scoutSummary,
  acquireScoutLock,
  releaseScoutLock,
  type ScoutEvent,
} from '../../src/core/scout.js'
import { acquireLock, releaseLock } from '../../src/core/lock.js'
import type { AxiomConfig } from '../../src/config/index.js'

function scaffold(): { wikiDir: string; config: AxiomConfig } {
  const wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-scout-'))
  fs.mkdirSync(path.join(wikiDir, 'wiki/pages/concepts'), { recursive: true })
  fs.mkdirSync(path.join(wikiDir, 'raw'), { recursive: true })
  fs.writeFileSync(path.join(wikiDir, 'wiki/log.md'), '# Wiki Log\n')
  fs.writeFileSync(
    path.join(wikiDir, 'wiki/pages/concepts/logic.md'),
    '---\ntitle: "Logic"\nsummary: "Valid inference"\ntags: [logic]\ncategory: concepts\nupdatedAt: "2026-01-01"\n---\n\nLogic is the study of valid inference.\n',
  )
  const config = {
    wikiDir,
    rawDir: path.join(wikiDir, 'raw'),
    provider: 'openai',
    apiKey: 'test',
    model: 'gpt-4o-mini',
    rerank: { provider: 'none' },
  } as unknown as AxiomConfig
  return { wikiDir, config }
}

describe('share parsing', () => {
  it('extracts links, tags, and the mention from a pasted thread', () => {
    const parsed = parseShareText(
      '@scout check these out #read-later #ai\nhttps://youtu.be/dQw4w9WgXcQ\nand https://example.com/post?utm_source=x.',
    )
    expect(parsed.mentioned).toBe(true)
    expect(parsed.urls).toEqual([
      'https://youtu.be/dQw4w9WgXcQ',
      'https://example.com/post?utm_source=x',
    ])
    expect(parsed.tags).toEqual(['read-later', 'ai'])
    expect(parsed.text).toContain('check these out')
    expect(parsed.text).not.toContain('@scout')
    expect(parsed.text).not.toContain('#read-later')
  })

  it('does not read URL fragments or color literals as tags', () => {
    const parsed = parseShareText('see https://example.com/doc#section and #fff but not #read-later')
    expect(parsed.tags).toEqual(['read-later'])
    expect(parsed.urls).toEqual(['https://example.com/doc#section'])
  })

  it('keeps prose as the note when a link is present', () => {
    const built = buildShareItems({
      url: 'https://example.com/a',
      text: 'why this matters #context',
    })
    expect(built.items).toHaveLength(1)
    expect(built.items[0]?.kind).toBe('url')
    expect(built.items[0]?.url).toBe('https://example.com/a')
    expect(built.items[0]?.note).toBe('why this matters')
    expect(built.items[0]?.tags).toEqual(['context'])
  })

  it('turns text without a link into one note', () => {
    const built = buildShareItems({ text: 'a thought worth keeping\n\nsecond line' })
    expect(built.items).toHaveLength(1)
    expect(built.items[0]?.kind).toBe('text')
    expect(built.items[0]?.text).toContain('second line')
  })

  it('rejects an empty share', () => {
    expect(() => buildShareItems({ text: '   ' })).not.toThrow()
    expect(buildShareItems({ text: '   ' }).items).toHaveLength(0)
  })
})

describe('url normalization', () => {
  it('collapses YouTube share shapes', () => {
    expect(normalizeUrl('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe(
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
    )
    expect(normalizeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30')).toBe(
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
    )
    expect(normalizeUrl('https://m.youtube.com/shorts/abc123')).toBe(
      'https://youtube.com/watch?v=abc123',
    )
  })

  it('drops tracking parameters and the www prefix', () => {
    expect(
      normalizeUrl('https://www.example.com/post/?utm_source=news&utm_medium=email&id=7'),
    ).toBe('https://example.com/post?id=7')
  })

  it('keeps a non-default port', () => {
    expect(normalizeUrl('http://127.0.0.1:8899/notes?utm_source=x')).toBe(
      'http://127.0.0.1:8899/notes',
    )
  })

  it('rejects non-http links', () => {
    expect(() => normalizeUrl('file:///etc/passwd')).toThrow(/http/)
  })
})

describe('event log', () => {
  it('replays share, start, done, and remove', () => {
    const base = {
      id: 'scout_a',
      key: 'url:https://example.com',
      kind: 'url' as const,
      url: 'https://example.com',
      tags: [],
      source: 'test',
      addedAt: '2026-01-01T00:00:00.000Z',
      status: 'queued' as const,
      attempts: 0,
    }
    const events: ScoutEvent[] = [
      { type: 'share', at: base.addedAt, item: base },
      { type: 'start', at: '2026-01-01T00:00:01.000Z', id: base.id },
      { type: 'done', at: '2026-01-01T00:00:02.000Z', id: base.id, result: { pages: ['sources/x'] } },
    ]
    const done = reduceScoutEvents(events)
    expect(done[0]?.status).toBe('done')
    expect(done[0]?.attempts).toBe(1)
    expect(done[0]?.result?.pages).toEqual(['sources/x'])

    const removed = reduceScoutEvents([...events, { type: 'remove', at: '2026-01-01T00:00:03.000Z', id: base.id }])
    expect(removed).toHaveLength(0)
  })
})

describe('queue', () => {
  let wikiDir: string
  let config: AxiomConfig

  beforeEach(() => {
    ;({ wikiDir, config } = scaffold())
  })

  afterEach(() => {
    releaseLock(wikiDir)
    fs.rmSync(wikiDir, { recursive: true, force: true })
  })

  it('queues a link once and reports the duplicate', () => {
    const first = queueShare(wikiDir, { url: 'https://youtu.be/abc123?si=one' })
    expect(first.added).toHaveLength(1)
    expect(first.added[0]?.url).toBe('https://youtube.com/watch?v=abc123')

    const second = queueShare(wikiDir, { url: 'https://youtube.com/watch?v=abc123&t=10' })
    expect(second.added).toHaveLength(0)
    expect(second.duplicates).toHaveLength(1)
    expect(scoutSummary(wikiDir).pending).toBe(1)
  })

  it('requeues a failed item without losing its id', () => {
    const queued = queueShare(wikiDir, { url: 'https://example.com/a' })
    const id = queued.added[0]?.id as string
    const item = loadScoutItems(wikiDir).find((entry) => entry.id === id)
    expect(item).toBeTruthy()

    // Simulate a failure by appending the event the drain would write.
    appendScoutEvent(wikiDir, {
      type: 'failed',
      at: new Date().toISOString(),
      id,
      error: 'network down',
    })
    expect(scoutSummary(wikiDir).failed).toBe(1)

    const retried = queueShare(wikiDir, { url: 'https://example.com/a', tags: ['retry'] })
    expect(retried.added[0]?.id).toBe(id)
    expect(scoutSummary(wikiDir).pending).toBe(1)
    expect(loadScoutItems(wikiDir).find((entry) => entry.id === id)?.tags).toContain('retry')

    const explicit = requeueScoutItem(wikiDir, id)
    expect(explicit?.status).toBe('queued')
  })

  it('clears finished items but keeps pending ones', () => {
    queueShare(wikiDir, { text: 'one' })
    queueShare(wikiDir, { text: 'two' })
    const first = loadScoutItems(wikiDir)[0]
    if (!first) throw new Error('missing item')
    appendScoutEvent(wikiDir, { type: 'done', at: new Date().toISOString(), id: first.id })

    expect(clearFinishedScoutItems(wikiDir)).toBe(1)
    expect(scoutSummary(wikiDir).pending).toBe(1)
  })

  it('moves dropped files into the queue and out of the drop folder', () => {
    const drop = path.join(wikiDir, 'scout/drop')
    fs.mkdirSync(drop, { recursive: true })
    fs.writeFileSync(path.join(drop, 'note.md'), 'a dropped note #drop')
    fs.writeFileSync(path.join(drop, 'link.url'), '[InternetShortcut]\nURL=https://example.com/x\n')

    const outcomes = scanScoutDrop(wikiDir)
    expect(outcomes).toHaveLength(2)
    expect(scoutSummary(wikiDir).pending).toBe(2)
    expect(fs.readdirSync(drop)).toHaveLength(0)
    expect(fs.readdirSync(path.join(wikiDir, 'scout/processed'))).toHaveLength(2)
  })
})

describe('draining', () => {
  let wikiDir: string
  let config: AxiomConfig

  beforeEach(() => {
    ;({ wikiDir, config } = scaffold())
  })

  afterEach(() => {
    releaseLock(wikiDir)
    fs.rmSync(wikiDir, { recursive: true, force: true })
  })

  it('files a text share in the inbox and applies its tags', async () => {
    queueShare(wikiDir, { text: 'Remember the halting problem #read-later', source: 'test' })
    const result = await drainScout(config, { ingest: false })

    expect(result.failed).toBe(0)
    expect(result.remaining).toBe(0)
    const done = loadScoutItems(wikiDir)[0]
    expect(done?.status).toBe('done')
    expect(done?.result?.inbox).toMatch(/^inbox\//)

    const page = path.join(wikiDir, `wiki/pages/${done?.result?.inbox}.md`)
    expect(fs.existsSync(page)).toBe(true)
    const body = fs.readFileSync(page, 'utf-8')
    expect(body).toContain('halting problem')
    expect(body).toContain('read-later')
    expect(fs.readFileSync(path.join(wikiDir, 'wiki/log.md'), 'utf-8')).toContain('ingest')
  })

  it('leaves the queue alone while another operation holds the wiki lock', async () => {
    queueShare(wikiDir, { text: 'queued behind an ingest' })
    expect(acquireLock(wikiDir)).toBe(true)
    try {
      const result = await drainScout(config, { ingest: false })
      expect(result.processed).toHaveLength(0)
      expect(result.remaining).toBe(1)
      expect(loadScoutItems(wikiDir)[0]?.status).toBe('queued')
    } finally {
      releaseLock(wikiDir)
    }
  })

  it('does not run two drains at once', async () => {
    queueShare(wikiDir, { text: 'one drain only' })
    expect(acquireScoutLock(wikiDir)).toBe(true)
    try {
      const result = await drainScout(config, { ingest: false })
      expect(result.busy).toBe(true)
      expect(result.processed).toHaveLength(0)
    } finally {
      releaseScoutLock(wikiDir)
    }
    const after = await drainScout(config, { ingest: false })
    expect(after.busy).toBe(false)
    expect(after.processed).toHaveLength(1)
  })
})
