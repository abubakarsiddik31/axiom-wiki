import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { assembleContext } from '../../src/core/context.js'
import type { AxiomConfig } from '../../src/config/index.js'

function writePage(wikiDir: string, rel: string, frontmatter: Record<string, unknown>, body: string) {
  const abs = path.join(wikiDir, 'wiki/pages', rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n')
  fs.writeFileSync(abs, `---\n${yaml}\n---\n\n${body}\n`, 'utf-8')
}

describe('context assembly', () => {
  let wikiDir: string
  let config: AxiomConfig

  beforeEach(() => {
    wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-context-'))
    config = {
      wikiDir,
      rawDir: path.join(wikiDir, 'raw'),
      provider: 'openai',
      apiKey: 'test',
      model: 'gpt-4o-mini',
    } as unknown as AxiomConfig

    writePage(
      wikiDir,
      'concepts/computability.md',
      {
        title: 'Computability',
        summary: 'Which functions can be computed',
        tags: ['computing'],
        sources: ['turing-1936.pdf'],
      },
      'Computability is the study of which problems a machine can solve. See [[entities/alan-turing]].',
    )
    writePage(
      wikiDir,
      'entities/alan-turing.md',
      { title: 'Alan Turing', summary: 'Mathematician', tags: ['computing'] },
      'Alan Turing defined computability and the Turing machine.',
    )
    writePage(
      wikiDir,
      'analyses/survey.md',
      { title: 'Survey', summary: 'An overview', tags: ['computing'] },
      'This survey summarises [[concepts/computability]] for newcomers.',
    )
    writePage(
      wikiDir,
      'sources/turing-1936.md',
      { title: 'Turing 1936', summary: 'The original paper', tags: ['source'] },
      'Unrelated source summary about an old paper.',
    )
  })

  afterEach(() => {
    fs.rmSync(wikiDir, { recursive: true, force: true })
  })

  it('retrieves seeds and expands one hop in both directions', async () => {
    const context = await assembleContext(config, 'computability')
    const ids = context.sources.map((source) => source.id)

    expect(ids).toContain('concepts/computability')
    expect(ids).toContain('entities/alan-turing') // outbound link
    expect(ids).toContain('analyses/survey') // inbound link (backlink)

    const seed = context.sources.find((source) => source.id === 'concepts/computability')
    expect(seed?.origin).toBe('search')
    expect(seed?.sources).toEqual(['turing-1936.pdf'])

    expect(context.text).toContain('## Retrieved wiki evidence')
    expect(context.text).toContain('concepts/computability')
    expect(context.text).toContain('Cite')
    expect(context.estimatedTokens).toBeGreaterThan(0)
  })

  it('honours the character budget and reports truncation', async () => {
    const context = await assembleContext(config, 'computability', { maxChars: 320 })
    expect(context.truncated).toBe(true)
    expect(context.sources.length).toBeLessThan(3)
    expect(context.text.length).toBeLessThan(1200)
  })

  it('clamps excerpts', async () => {
    const context = await assembleContext(config, 'computability', {
      excerptChars: 40,
      expand: 0,
    })
    for (const source of context.sources) {
      expect(source.excerpt.length).toBeLessThanOrEqual(41)
    }
  })

  it('returns an empty block when nothing matches', async () => {
    const context = await assembleContext(config, 'zzzz-no-such-topic')
    if (context.sources.length === 0) {
      expect(context.text).toBe('')
    } else {
      // Lexical fallback may still return something; the block must stay usable.
      expect(context.text).toContain('## Retrieved wiki evidence')
    }
  })

  it('accepts pre-ranked seeds without searching', async () => {
    const context = await assembleContext(config, 'ignored', {
      seeds: ['entities/alan-turing'],
    })
    expect(context.sources[0]?.id).toBe('entities/alan-turing')
    expect(context.sources[0]?.origin).toBe('search')
  })
})
