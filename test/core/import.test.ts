import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  formatImportPlan,
  importLedgerPath,
  planImport,
  readUrlList,
  runImport,
} from '../../src/core/import.js'
import type { AxiomConfig } from '../../src/config/index.js'

interface Scaffold {
  root: string
  wikiDir: string
  rawDir: string
  inbox: string
  config: AxiomConfig
}

function scaffold(): Scaffold {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-import-'))
  const wikiDir = path.join(root, 'wiki-root')
  const rawDir = path.join(wikiDir, 'raw')
  const inbox = path.join(root, 'inbox')
  fs.mkdirSync(rawDir, { recursive: true })
  fs.mkdirSync(inbox, { recursive: true })

  return {
    root,
    wikiDir,
    rawDir,
    inbox,
    config: {
      wikiDir,
      rawDir,
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    } as unknown as AxiomConfig,
  }
}

function write(dir: string, relative: string, content: string | Buffer): string {
  const file = path.join(dir, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

describe('bulk import planning', () => {
  let s: Scaffold

  beforeEach(() => {
    s = scaffold()
  })

  afterEach(() => {
    fs.rmSync(s.root, { recursive: true, force: true })
  })

  it('walks a folder, skipping hidden, unsupported, and media by default', () => {
    write(s.inbox, 'note.md', '# Note\n')
    write(s.inbox, 'sub/second.txt', 'second')
    write(s.inbox, 'paper.pdf', '%PDF-1.4 fake')
    write(s.inbox, 'image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    write(s.inbox, 'skip.xyz', 'nope')
    write(s.inbox, '.obsidian/workspace.json', '{}')

    const plan = planImport(s.config, { paths: [s.inbox] })
    const ready = plan.items.filter((item) => item.status === 'ready')

    expect(plan.fileCount).toBe(2)
    expect(ready.map((item) => item.label).sort()).toEqual(['note.md', 'second.txt'])
    expect(plan.items.some((item) => item.label === 'skip.xyz')).toBe(false)
    expect(plan.items.some((item) => item.label === 'paper.pdf')).toBe(false)
  })

  it('includes PDFs and images when asked', () => {
    write(s.inbox, 'note.md', '# Note\n')
    write(s.inbox, 'paper.pdf', '%PDF-1.4 fake')
    write(s.inbox, 'image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const plan = planImport(s.config, { paths: [s.inbox], includeMedia: true })
    const ready = plan.items.filter((item) => item.status === 'ready')

    expect(ready).toHaveLength(3)
    expect(plan.totalBytes).toBeGreaterThan(0)
  })

  it('flags a file whose content already exists in raw/', () => {
    write(s.rawDir, 'existing.md', 'same content')
    const source = write(s.inbox, 'renamed.md', 'same content')

    const plan = planImport(s.config, { paths: [source] })
    expect(plan.ready).toBe(0)
    expect(plan.duplicates).toBe(1)
    expect(plan.items[0]).toMatchObject({ status: 'duplicate', target: 'existing.md' })
  })

  it('deduplicates identical files inside one batch', () => {
    write(s.inbox, 'a.md', 'identical')
    write(s.inbox, 'b.md', 'identical')

    const plan = planImport(s.config, { paths: [s.inbox] })
    expect(plan.ready).toBe(1)
    expect(plan.duplicates).toBe(1)
    expect(plan.items.find((item) => item.status === 'duplicate')?.reason).toContain('in this import')
  })

  it('renames colliding filenames instead of overwriting', () => {
    write(s.rawDir, 'note.md', 'already here')
    write(s.inbox, 'note.md', 'different content')

    const plan = planImport(s.config, { paths: [path.join(s.inbox, 'note.md')] })
    expect(plan.items[0]).toMatchObject({ status: 'ready', target: 'note-2.md' })
  })

  it('reports unsupported and missing inputs instead of throwing', () => {
    const binary = write(s.inbox, 'thing.bin', 'x')
    const plan = planImport(s.config, { paths: [binary, path.join(s.inbox, 'gone.md')] })

    expect(plan.unsupported).toBe(1)
    expect(plan.invalid).toBe(1)
    expect(plan.items.find((item) => item.status === 'invalid')?.reason).toBe('path not found')
  })

  it('treats files already inside raw/ as duplicates', () => {
    const existing = write(s.rawDir, 'inside.md', 'content')
    const plan = planImport(s.config, { paths: [existing] })
    expect(plan.items[0]).toMatchObject({ status: 'duplicate', reason: 'already in raw/' })
  })

  it('caps the number of URLs and says how many were left out', () => {
    const urls = Array.from({ length: 5 }, (_, index) => `https://example.com/${index}`)
    const plan = planImport(s.config, { urls, urlLimit: 2 })

    expect(plan.urlCount).toBe(2)
    expect(plan.truncatedUrls).toBe(3)
  })

  it('reports an invalid URL and collapses repeats', () => {
    const plan = planImport(s.config, {
      urls: ['https://example.com/a', 'https://example.com/a', 'not a url'],
    })

    expect(plan.ready).toBe(1)
    expect(plan.invalid).toBe(1)
    expect(plan.items.filter((item) => item.kind === 'url')).toHaveLength(2)
  })

  it('recognises URLs already clipped and URLs in the ledger', () => {
    write(
      s.rawDir,
      'article.md',
      '---\nsource_url: https://example.com/clipped\n---\n\nbody\n',
    )
    fs.writeFileSync(
      importLedgerPath(s.wikiDir),
      JSON.stringify({
        version: 1,
        urls: {
          'https://example.com/ledger': { filename: 'article.md', at: '2026-01-01T00:00:00.000Z' },
        },
      }),
    )

    const plan = planImport(s.config, {
      urls: ['https://example.com/clipped?utm_source=x', 'https://example.com/ledger'],
    })

    expect(plan.ready).toBe(0)
    expect(plan.duplicates).toBe(2)
  })

  it('formats a plan without dumping every item', () => {
    write(s.inbox, 'note.md', '# Note\n')
    const plan = planImport(s.config, { paths: [s.inbox] })
    const text = formatImportPlan(plan)

    expect(text).toContain('Import plan')
    expect(text).toContain('1 ready')
    expect(text).toContain('+ note.md')
  })
})

describe('URL list parsing', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-url-list-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('reads one URL per line and ignores comments', () => {
    const file = write(root, 'links.txt', '# reading\nhttps://example.com/a\n\nhttps://example.com/b\nnot a link\n')
    expect(readUrlList(file)).toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('reads a CSV with a URL column', () => {
    const file = write(
      root,
      'readwise.csv',
      'Title,URL,Note\n"Raft","https://example.com/raft","important"\n"Paxos","https://example.com/paxos",""\n',
    )
    expect(readUrlList(file)).toEqual(['https://example.com/raft', 'https://example.com/paxos'])
  })

  it('reads a bookmarks HTML export', () => {
    const file = write(
      root,
      'bookmarks.html',
      '<DL><DT><A HREF="https://example.com/one">One</A><DT><A HREF="https://example.com/two">Two</A></DL>',
    )
    expect(readUrlList(file)).toEqual(['https://example.com/one', 'https://example.com/two'])
  })

  it('reads nested JSON bookmarks', () => {
    const file = write(
      root,
      'bookmarks.json',
      JSON.stringify({
        roots: {
          bookmark_bar: {
            children: [
              { type: 'url', name: 'One', url: 'https://example.com/one' },
              { type: 'folder', children: [{ type: 'url', url: 'https://example.com/two' }] },
            ],
          },
        },
      }),
    )
    expect(readUrlList(file)).toEqual(['https://example.com/one', 'https://example.com/two'])
  })

  it('explains a malformed JSON export', () => {
    const file = write(root, 'bookmarks.json', '{ not json')
    expect(() => readUrlList(file)).toThrow(/Could not parse/)
  })

  it('rejects an unsupported list type', () => {
    const file = write(root, 'links.md', 'https://example.com/a')
    expect(() => readUrlList(file)).toThrow(/Unsupported list file/)
  })
})

describe('bulk import execution', () => {
  let s: Scaffold

  beforeEach(() => {
    s = scaffold()
  })

  afterEach(() => {
    fs.rmSync(s.root, { recursive: true, force: true })
  })

  it('copies ready files into raw/ and reports what was staged', async () => {
    write(s.inbox, 'note.md', '# Note\n')
    write(s.inbox, 'sub/second.md', '# Second\n')

    const result = await runImport(s.config, { paths: [s.inbox], ingest: false })

    expect(result.staged.filter((entry) => entry.ok)).toHaveLength(2)
    expect(fs.existsSync(path.join(s.rawDir, 'note.md'))).toBe(true)
    expect(fs.existsSync(path.join(s.rawDir, 'second.md'))).toBe(true)
    expect(result.ingest).toBeNull()
    expect(result.summary).toContain('2 staged')
    expect(fs.existsSync(path.join(s.inbox, 'note.md'))).toBe(true)
  })

  it('does not overwrite an existing raw file with a different body', async () => {
    write(s.rawDir, 'note.md', 'old')
    write(s.inbox, 'note.md', 'new')

    await runImport(s.config, { paths: [path.join(s.inbox, 'note.md')], ingest: false })

    expect(fs.readFileSync(path.join(s.rawDir, 'note.md'), 'utf-8')).toBe('old')
    expect(fs.readFileSync(path.join(s.rawDir, 'note-2.md'), 'utf-8')).toBe('new')
  })

  it('moves instead of copying when asked', async () => {
    const source = write(s.inbox, 'note.md', '# Note\n')

    await runImport(s.config, { paths: [source], ingest: false, move: true })

    expect(fs.existsSync(source)).toBe(false)
    expect(fs.existsSync(path.join(s.rawDir, 'note.md'))).toBe(true)
  })

  it('is a no-op when there is nothing new', async () => {
    const result = await runImport(s.config, { paths: [], ingest: false })
    expect(result.staged).toHaveLength(0)
    expect(result.summary).toContain('Nothing')
  })

  it('records staged files so a second plan calls them duplicates', async () => {
    write(s.inbox, 'note.md', '# Note\n')
    await runImport(s.config, { paths: [s.inbox], ingest: false })

    const plan = planImport(s.config, { paths: [s.inbox] })
    expect(plan.ready).toBe(0)
    expect(plan.duplicates).toBe(1)
  })
})
