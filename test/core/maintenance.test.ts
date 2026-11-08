import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import matter from 'gray-matter'

import {
  appendRelatedLink,
  applyMaintenance,
  deriveSummary,
  formatMaintenancePlan,
  planMaintenance,
  runMaintenance,
} from '../../src/core/maintenance.js'
import { acquireLock, releaseLock } from '../../src/core/lock.js'
import type { AxiomConfig } from '../../src/config/index.js'

function writePage(
  wikiDir: string,
  id: string,
  data: Record<string, unknown>,
  body: string,
): void {
  const abs = path.join(wikiDir, 'wiki/pages', `${id}.md`)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, matter.stringify(`${body}\n`, data), 'utf-8')
}

function readPage(wikiDir: string, id: string) {
  return matter(fs.readFileSync(path.join(wikiDir, 'wiki/pages', `${id}.md`), 'utf-8'))
}

function exists(wikiDir: string, id: string): boolean {
  return fs.existsSync(path.join(wikiDir, 'wiki/pages', `${id}.md`))
}

describe('deriveSummary', () => {
  it('strips Markdown syntax and citation markers', () => {
    const summary = deriveSummary(
      '# Turing machine\n\nThe **Turing machine** is an abstract device. See [[concepts/logic|logic]] ^[paper.pdf#p1] for more.',
    )
    expect(summary).toBe('The Turing machine is an abstract device. See logic for more.')
  })

  it('clamps long prose at a sentence boundary', () => {
    const body = `${'A sentence about logic. '.repeat(30)}`
    const summary = deriveSummary(body, 80)
    expect(summary.length).toBeLessThanOrEqual(81)
    expect(summary.endsWith('.')).toBe(true)
  })

  it('returns an empty string for an empty body', () => {
    expect(deriveSummary('   \n\n ')).toBe('')
  })
})

describe('appendRelatedLink', () => {
  it('creates a Related section', () => {
    const body = 'Logic is the study of inference.\n'
    expect(appendRelatedLink(body, '[[concepts/quantum-logic|Quantum logic]]')).toBe(
      'Logic is the study of inference.\n\n## Related\n\n- [[concepts/quantum-logic|Quantum logic]]\n',
    )
  })

  it('adds to an existing Related section without touching later sections', () => {
    const body = '# Logic\n\nBody.\n\n## Related\n\n- [[concepts/a|A]]\n\n## Notes\n\nKeep me.\n'
    const next = appendRelatedLink(body, '[[concepts/b|B]]')
    expect(next).toContain('- [[concepts/a|A]]\n- [[concepts/b|B]]')
    expect(next).toContain('## Notes\n\nKeep me.')
  })
})

describe('maintenance plan and apply', () => {
  let wikiDir: string

  beforeEach(() => {
    wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-maintain-'))

    writePage(
      wikiDir,
      'entities/alan-turing',
      { title: 'Alan Turing', summary: 'Mathematician.', tags: ['computing'], category: 'entities' },
      'Alan Turing proposed the Turing machine. [[concepts/turing-machine]]',
    )
    writePage(
      wikiDir,
      'entities/alan-turing-bio',
      { title: 'Alan Turing', summary: 'Biography stub.', tags: ['computing'], category: 'entities' },
      'A longer biography of the man.',
    )
    writePage(
      wikiDir,
      'concepts/turing-machine',
      { title: 'Turing machine', summary: '', tags: ['computing'], category: 'concepts' },
      'The Turing machine is an abstract device. It connects to the Halting problem. ^[paper.pdf#p1]',
    )
    writePage(
      wikiDir,
      'concepts/halting-problem',
      { title: 'Halting problem', summary: '', tags: ['computing'], category: 'concepts' },
      'The halting problem asks whether a program halts.',
    )
    writePage(
      wikiDir,
      'concepts/quantum-logic',
      { title: 'Quantum logic', summary: 'A non-classical logic.', tags: ['logic'], category: 'concepts' },
      'Quantum logic generalises Boolean algebra.',
    )
    writePage(
      wikiDir,
      'concepts/logic',
      { title: 'Logic', summary: 'The study of inference.', tags: ['logic'], category: 'concepts' },
      'Logic is the study of valid inference.',
    )
    writePage(
      wikiDir,
      'analyses/survey',
      { title: 'Survey', summary: 'A survey.', tags: ['overview'], category: 'analyses' },
      'See [[concepts/logic]], [[concepts/turing-machine]], [[entities/alan-turing]], and [[concepts/ghost]].',
    )
    writePage(
      wikiDir,
      'concepts/untagged',
      { title: 'Untagged', summary: 'Has no tags.', category: 'concepts' },
      'A page without tags.',
    )
    writePage(
      wikiDir,
      'inbox/idea',
      { title: 'Idea', summary: '', tags: ['inbox'], category: 'inbox' },
      'A fleeting thought.',
    )
  })

  afterEach(() => {
    fs.rmSync(wikiDir, { recursive: true, force: true })
  })

  it('finds missing summaries and leaves tagged pages alone', () => {
    const plan = planMaintenance(wikiDir)
    const ids = plan.summaries.map((fix) => fix.id)

    expect(ids).toContain('concepts/turing-machine')
    expect(ids).toContain('concepts/halting-problem')
    expect(ids).not.toContain('concepts/untagged')

    const turing = plan.summaries.find((fix) => fix.id === 'concepts/turing-machine')
    expect(turing?.summary).toContain('abstract device')
    expect(turing?.summary).not.toContain('paper.pdf')
  })

  it('adopts orphans through an existing mention', () => {
    const plan = planMaintenance(wikiDir)
    const halting = plan.orphanLinks.find((fix) => fix.id === 'concepts/halting-problem')
    expect(halting).toMatchObject({
      from: 'concepts/turing-machine',
      mode: 'mention',
    })
    expect(halting?.snippet).toContain('Halting problem')

    const bio = plan.orphanLinks.find((fix) => fix.id === 'entities/alan-turing-bio')
    expect(bio).toMatchObject({ from: 'entities/alan-turing', mode: 'mention' })
  })

  it('falls back to a related page when there is no mention', () => {
    const plan = planMaintenance(wikiDir)
    const quantum = plan.orphanLinks.find((fix) => fix.id === 'concepts/quantum-logic')
    expect(quantum).toMatchObject({ from: 'concepts/logic', mode: 'related' })
  })

  it('never adopts inbox notes', () => {
    const plan = planMaintenance(wikiDir)
    expect(plan.orphans).not.toContain('inbox/idea')
    expect(plan.orphanLinks.some((fix) => fix.id.startsWith('inbox/'))).toBe(false)
  })

  it('proposes duplicate pages without merging them', () => {
    const plan = planMaintenance(wikiDir)
    const pair = plan.duplicates.find(
      (entry) =>
        (entry.a === 'entities/alan-turing' && entry.b === 'entities/alan-turing-bio') ||
        (entry.a === 'entities/alan-turing-bio' && entry.b === 'entities/alan-turing'),
    )
    expect(pair).toMatchObject({ reason: 'same-title', similarity: 1 })
    expect(exists(wikiDir, 'entities/alan-turing-bio')).toBe(true)
  })

  it('reports dead links and marks safe stub targets', () => {
    const plan = planMaintenance(wikiDir)
    const ghost = plan.deadLinks.find((link) => link.to === 'concepts/ghost')
    expect(ghost).toMatchObject({ from: ['analyses/survey'], creatable: true })
  })

  it('reports pages without tags without inventing any', () => {
    const plan = planMaintenance(wikiDir)
    expect(plan.pagesWithoutTags.map((page) => page.id)).toContain('concepts/untagged')
  })

  it('applies summaries and links without changing the prose', () => {
    const plan = planMaintenance(wikiDir)
    const applied = applyMaintenance(wikiDir, plan)

    expect(applied.summaries).toBeGreaterThan(0)
    expect(applied.links).toBeGreaterThan(0)
    expect(applied.stubs).toBe(0)

    const turing = readPage(wikiDir, 'concepts/turing-machine')
    expect(turing.data['summary']).toContain('abstract device')
    expect(turing.content).toContain('The Turing machine is an abstract device.')
    expect(turing.content).toContain('^[paper.pdf#p1]')

    const adopter = readPage(wikiDir, 'concepts/turing-machine')
    expect(adopter.content).toContain(
      '[[concepts/halting-problem|Halting problem]]',
    )

    const logic = readPage(wikiDir, 'concepts/logic')
    expect(logic.content).toContain('## Related')
    expect(logic.content).toContain('[[concepts/quantum-logic|Quantum logic]]')

    expect(exists(wikiDir, 'concepts/ghost')).toBe(false)
  })

  it('is idempotent after the safe fixes are applied', () => {
    applyMaintenance(wikiDir, planMaintenance(wikiDir))
    const next = planMaintenance(wikiDir)

    expect(next.summaries).toHaveLength(0)
    expect(next.orphanLinks).toHaveLength(0)
  })

  it('creates stubs only when asked', () => {
    const plan = planMaintenance(wikiDir)
    const applied = applyMaintenance(wikiDir, plan, { createStubs: true })

    expect(applied.stubs).toBe(1)
    expect(exists(wikiDir, 'concepts/ghost')).toBe(true)
    const stub = readPage(wikiDir, 'concepts/ghost')
    expect(stub.data['title']).toBe('Ghost')
    expect(stub.data['tags']).toEqual(['stub'])
    expect(stub.data['category']).toBe('concepts')
  })

  it('formats a readable plan', () => {
    const text = formatMaintenancePlan(planMaintenance(wikiDir))
    expect(text).toContain('Wiki maintenance plan')
    expect(text).toContain('Summaries')
    expect(text).toContain('Orphan links')
    expect(text).toContain('Duplicate candidates')
    expect(text).toContain('Dead links')
  })

  it('refuses to apply while a live lock is held, even by this process', async () => {
    const config = {
      wikiDir,
      rawDir: path.join(wikiDir, 'raw'),
      provider: 'openai',
      apiKey: 'test',
      model: 'gpt-4o-mini',
    } as unknown as AxiomConfig

    expect(acquireLock(wikiDir)).toBe(true)
    try {
      const result = await runMaintenance(config, { apply: true })
      expect(result.status).toBe('busy')
      // Planning stays read-only and must still work.
      const dry = await runMaintenance(config, { apply: false })
      expect(dry.status).toBe('ok')
    } finally {
      releaseLock(wikiDir)
    }
  })
})
