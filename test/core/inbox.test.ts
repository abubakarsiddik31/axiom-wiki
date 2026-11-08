import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import matter from 'gray-matter'

import { capture, promoteInbox } from '../../src/core/inbox.js'
import { savePage } from '../../src/core/page-ops.js'
import type { CompilationState } from '../../src/core/state.js'

function emptyState(): CompilationState {
  return { version: 1, sources: {}, frozenSlugs: [] }
}

function read(wikiDir: string, id: string) {
  return fs.readFileSync(path.join(wikiDir, 'wiki/pages', `${id}.md`), 'utf-8')
}

describe('capture inbox', () => {
  let wikiDir: string

  beforeEach(() => {
    wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-inbox-'))
  })

  afterEach(() => {
    fs.rmSync(wikiDir, { recursive: true, force: true })
  })

  it('captures a note with a derived title and inbox metadata', () => {
    const result = capture(wikiDir, {
      text: 'Turing machines and the halting problem are the same idea viewed twice.',
    })

    expect(result.id).toMatch(/^inbox\//)
    const parsed = matter(read(wikiDir, result.id))
    expect(parsed.data['category']).toBe('inbox')
    expect(parsed.data['tags']).toContain('inbox')
    expect(parsed.data['title']).toBe(
      'Turing machines and the halting problem are the same idea viewed twice.',
    )
    expect(parsed.data['summary']).toContain('Turing machines')
    expect(parsed.data['capturedAt']).toBeTruthy()
    expect(parsed.content).toContain('halting problem')
  })

  it('derives a readable title from a bare URL and keeps the link', () => {
    const result = capture(wikiDir, { text: 'https://example.com/papers/turing-1936' })
    const parsed = matter(read(wikiDir, result.id))
    expect(parsed.data['title']).toBe('example.com/papers/turing-1936')
    expect(parsed.content).toContain('https://example.com/papers/turing-1936')
  })

  it('honours an explicit title, tags and source', () => {
    const result = capture(wikiDir, {
      text: 'Worth revisiting.',
      title: 'Revisit the halting proof',
      tags: ['reading', 'logic'],
      source: 'https://example.com/x',
    })
    const parsed = matter(read(wikiDir, result.id))
    expect(parsed.data['title']).toBe('Revisit the halting proof')
    expect(parsed.data['tags']).toEqual(['inbox', 'reading', 'logic'])
    expect(parsed.content).toContain('Source: <https://example.com/x>')
  })

  it('suffixes ids instead of overwriting a repeated capture', () => {
    const first = capture(wikiDir, { text: 'Same thought.', title: 'Same thought' })
    const second = capture(wikiDir, { text: 'Same thought.', title: 'Same thought' })
    expect(second.id).toBe(`${first.id}-2`)
    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages', `${first.id}.md`))).toBe(true)
    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages', `${second.id}.md`))).toBe(true)
  })

  it('rejects empty captures', () => {
    expect(() => capture(wikiDir, { text: '   ' })).toThrow(/Nothing to capture/)
  })

  it('promotes a note into a real category and drops the inbox tag', () => {
    const result = capture(wikiDir, { text: 'A durable idea.', title: 'Durable idea' })
    const state = emptyState()

    const promoted = promoteInbox(wikiDir, result.id, 'concepts', state)

    expect(promoted.newId).toBe('concepts/durable-idea')
    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages', `${result.id}.md`))).toBe(false)

    const parsed = matter(read(wikiDir, 'concepts/durable-idea'))
    expect(parsed.data['category']).toBe('concepts')
    expect(parsed.data['tags']).toEqual(['uncategorised'])
    expect(parsed.content).toContain('A durable idea')
  })

  it('keeps user tags and rewrites inbound links on promotion', () => {
    const captured = capture(wikiDir, {
      text: 'Body.',
      title: 'Promoted note',
      tags: ['logic'],
    })
    savePage(wikiDir, {
      category: 'analyses',
      title: 'Survey',
      body: `See [[${captured.id}]].`,
    })

    promoteInbox(wikiDir, captured.id, 'concepts', emptyState())

    const promoted = matter(read(wikiDir, 'concepts/promoted-note'))
    expect(promoted.data['tags']).toEqual(['logic'])

    const survey = read(wikiDir, 'analyses/survey')
    expect(survey).toContain('[[concepts/promoted-note]]')
  })

  it('refuses to promote a non-inbox page or into inbox', () => {
    savePage(wikiDir, { category: 'concepts', title: 'Logic', body: 'x' })
    expect(() => promoteInbox(wikiDir, 'concepts/logic', 'entities', emptyState())).toThrow(
      /not an inbox note/,
    )

    const captured = capture(wikiDir, { text: 'x', title: 'y' })
    expect(() => promoteInbox(wikiDir, captured.id, 'inbox', emptyState())).toThrow(
      /Promote to one of/,
    )
  })
})
