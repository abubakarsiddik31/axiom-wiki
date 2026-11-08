import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import matter from 'gray-matter'

import {
  deletePage,
  mergePages,
  renamePage,
  resolvePageId,
  savePage,
} from '../../src/core/page-ops.js'
import type { CompilationState } from '../../src/core/state.js'

function emptyState(): CompilationState {
  return { version: 1, sources: {}, frozenSlugs: [] }
}

function read(wikiDir: string, rel: string) {
  return fs.readFileSync(path.join(wikiDir, 'wiki/pages', rel), 'utf-8')
}

describe('page operations', () => {
  let wikiDir: string

  beforeEach(() => {
    wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-pages-'))
  })

  afterEach(() => {
    fs.rmSync(wikiDir, { recursive: true, force: true })
  })

  it('derives ids and creates a page with normalized frontmatter', () => {
    expect(resolvePageId({ title: 'Alan Turing', category: 'entities', body: '' })).toBe(
      'entities/alan-turing',
    )

    const result = savePage(wikiDir, {
      category: 'entities',
      title: 'Alan Turing',
      summary: 'Mathematician',
      tags: ['computing', 'history'],
      body: '## Life\n\nWorked on computability.',
    })

    expect(result.created).toBe(true)
    const parsed = matter(read(wikiDir, 'entities/alan-turing.md'))
    expect(parsed.data['title']).toBe('Alan Turing')
    expect(parsed.data['category']).toBe('entities')
    expect(parsed.data['tags']).toEqual(['computing', 'history'])
    expect(parsed.content).toContain('## Life')
  })

  it('edits an existing page without dropping unknown frontmatter', () => {
    savePage(wikiDir, { category: 'concepts', title: 'Logic', body: 'old' })
    const abs = path.join(wikiDir, 'wiki/pages/concepts/logic.md')
    fs.writeFileSync(
      abs,
      matter.stringify('old body', {
        title: 'Logic',
        summary: 'kept',
        tags: ['x'],
        category: 'concepts',
        updatedAt: '2020-01-01',
        custom: 'keep-me',
      }),
    )

    const result = savePage(wikiDir, {
      id: 'concepts/logic',
      title: 'Logic',
      body: 'new body',
    })
    expect(result.created).toBe(false)

    const parsed = matter(read(wikiDir, 'concepts/logic.md'))
    expect(parsed.data['custom']).toBe('keep-me')
    expect(parsed.content).toContain('new body')
  })

  it('renames a page, rewrites inbound links and state paths', () => {
    savePage(wikiDir, { category: 'entities', title: 'Alan Turing', body: 'body' })
    savePage(wikiDir, {
      category: 'concepts',
      title: 'Computability',
      body: 'About [[entities/alan-turing]] and [[alan-turing|Turing]].',
    })

    const state = emptyState()
    state.sources['paper.pdf'] = {
      sha256: 'abc',
      lastIngestedAt: '2026-01-01',
      sizeBytes: 1,
      concepts: ['wiki/pages/entities/alan-turing.md'],
      truncated: false,
    }

    const result = renamePage(wikiDir, 'entities/alan-turing', 'people/alan-turing', state)

    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages/entities/alan-turing.md'))).toBe(false)
    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages/people/alan-turing.md'))).toBe(true)
    expect(result.touched).toContain('concepts/computability')

    const body = read(wikiDir, 'concepts/computability.md')
    expect(body).toContain('[[people/alan-turing]]')
    expect(body).toContain('[[people/alan-turing|Turing]]')
    expect(state.sources['paper.pdf'].concepts).toEqual(['wiki/pages/people/alan-turing.md'])

    // Frontmatter category follows the new id.
    const moved = matter(read(wikiDir, 'people/alan-turing.md'))
    expect(moved.data['category']).toBe('people')
  })

  it('refuses to rename onto an existing page', () => {
    savePage(wikiDir, { category: 'entities', title: 'One', body: 'a' })
    savePage(wikiDir, { category: 'entities', title: 'Two', body: 'b' })
    expect(() => renamePage(wikiDir, 'entities/one', 'entities/two', emptyState())).toThrow(
      /already exists/,
    )
  })

  it('merges a page into another and repoints links', () => {
    savePage(wikiDir, { category: 'concepts', title: 'Logic', body: 'Target body.' })
    savePage(wikiDir, { category: 'concepts', title: 'Formal Logic', body: 'Source body.' })
    savePage(wikiDir, {
      category: 'analyses',
      title: 'Survey',
      body: 'See [[concepts/formal-logic]].',
    })

    const result = mergePages(wikiDir, 'concepts/formal-logic', 'concepts/logic', emptyState())

    expect(result.removedId).toBe('concepts/formal-logic')
    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages/concepts/formal-logic.md'))).toBe(false)
    const merged = read(wikiDir, 'concepts/logic.md')
    expect(merged).toContain('Target body.')
    expect(merged).toContain('Source body.')
    expect(merged).toContain('Merged from Formal Logic')

    const survey = read(wikiDir, 'analyses/survey.md')
    expect(survey).toContain('[[concepts/logic]]')
  })

  it('deletes a page and cleans state references', () => {
    savePage(wikiDir, { category: 'concepts', title: 'Logic', body: 'x' })
    const state = emptyState()
    state.sources['a.pdf'] = {
      sha256: 'abc',
      lastIngestedAt: '2026-01-01',
      sizeBytes: 1,
      concepts: ['wiki/pages/concepts/logic.md'],
      truncated: false,
    }
    state.frozenSlugs = ['wiki/pages/concepts/logic.md']

    deletePage(wikiDir, 'concepts/logic', state)

    expect(fs.existsSync(path.join(wikiDir, 'wiki/pages/concepts/logic.md'))).toBe(false)
    expect(state.sources['a.pdf'].concepts).toEqual([])
    expect(state.frozenSlugs).toEqual([])
  })
})
