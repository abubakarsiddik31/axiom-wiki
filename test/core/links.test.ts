import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  analyzeLinks,
  buildLinkIndex,
  findRelatedPages,
  findUnlinkedMentions,
  linkFirstMentionInBody,
  rewriteLinksForRename,
} from '../../src/core/links.js'

function writePage(wikiDir: string, rel: string, frontmatter: Record<string, unknown>, body: string) {
  const abs = path.join(wikiDir, 'wiki/pages', rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n')
  fs.writeFileSync(abs, `---\n${yaml}\n---\n\n${body}\n`, 'utf-8')
}

describe('link intelligence', () => {
  let wikiDir: string

  beforeEach(() => {
    wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-links-'))
    writePage(wikiDir, 'entities/alan-turing.md', { title: 'Alan Turing', tags: ['computing'] }, 'Mathematician.')
    writePage(
      wikiDir,
      'concepts/computability.md',
      { title: 'Computability', tags: ['computing', 'logic'] },
      'Alan Turing formalised computability. See [[entities/alan-turing]].',
    )
    writePage(
      wikiDir,
      'concepts/logic.md',
      { title: 'Logic', tags: ['logic'] },
      'Alan Turing worked on logic but never linked it.',
    )
    writePage(
      wikiDir,
      'sources/biography.md',
      { title: 'Biography', tags: [] },
      '```\nAlan Turing appears in a code block\n```\nThe real mention: Alan Turing and then [[concepts/logic]].',
    )
  })

  afterEach(() => {
    fs.rmSync(wikiDir, { recursive: true, force: true })
  })

  it('indexes titles, tags and outbound links', () => {
    const index = buildLinkIndex(wikiDir)
    expect(index.size).toBe(4)
    expect(index.get('concepts/computability')?.links).toContain('entities/alan-turing')
    expect(index.get('entities/alan-turing')?.tags).toEqual(['computing'])
  })

  it('finds unlinked mentions and skips already-linked pages and code blocks', () => {
    const mentions = findUnlinkedMentions(wikiDir, 'entities/alan-turing')
    const ids = mentions.map((mention) => mention.id)
    // computability already links; logic and biography merely mention.
    expect(ids).not.toContain('concepts/computability')
    expect(ids).toContain('concepts/logic')
    expect(ids).toContain('sources/biography')
    // The code-block mention is ignored, so biography reports one occurrence.
    expect(mentions.find((mention) => mention.id === 'sources/biography')?.mentions).toBe(1)
  })

  it('ranks related pages by shared tags and links', () => {
    const related = findRelatedPages(wikiDir, 'entities/alan-turing')
    const computability = related.find((page) => page.id === 'concepts/computability')
    expect(computability).toBeDefined()
    expect(computability?.reasons).toContain('link')
    expect(computability?.reasons).toContain('tag')
    expect(computability?.sharedTags).toContain('computing')
  })

  it('wraps the first unlinked mention with a wiki-link', () => {
    const body = 'Some prose about Alan Turing and then Alan Turing again.'
    const result = linkFirstMentionInBody(
      body,
      { title: 'Alan Turing', aliases: [], id: 'entities/alan-turing' },
      'entities/alan-turing',
    )
    expect(result.changed).toBe(true)
    expect(result.body).toContain('[[entities/alan-turing|Alan Turing]]')
    expect(result.body.match(/\[\[/g)?.length).toBe(1)
  })

  it('rewrites every inbound link form on rename', () => {
    writePage(
      wikiDir,
      'analyses/survey.md',
      { title: 'Survey', tags: [] },
      'See [[entities/alan-turing]], [[entities/alan-turing|Turing]], and [[alan-turing#early-life]].',
    )
    const report = rewriteLinksForRename(wikiDir, 'entities/alan-turing', 'people/alan-turing', false)
    expect(report.rewritten.length).toBeGreaterThan(0)

    const survey = fs.readFileSync(path.join(wikiDir, 'wiki/pages/analyses/survey.md'), 'utf-8')
    expect(survey).toContain('[[people/alan-turing]]')
    expect(survey).toContain('[[people/alan-turing|Turing]]')
    expect(survey).toContain('[[people/alan-turing#early-life]]')
    expect(survey).not.toContain('entities/alan-turing')

    // A similarly named page must be left alone.
    const computability = fs.readFileSync(
      path.join(wikiDir, 'wiki/pages/concepts/computability.md'),
      'utf-8',
    )
    expect(computability).toContain('[[people/alan-turing]]')
  })

  it('returns a combined analysis payload', () => {
    const payload = analyzeLinks(wikiDir, 'entities/alan-turing')
    expect(payload?.id).toBe('entities/alan-turing')
    expect(payload?.unlinked.length).toBeGreaterThan(0)
    expect(payload?.related.length).toBeGreaterThan(0)
  })
})
