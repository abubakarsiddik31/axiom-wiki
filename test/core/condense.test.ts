import { describe, it, expect } from 'vitest'

import {
  buildRewritePrompt,
  fallbackStandaloneQuery,
  looksSelfContained,
  rewriteFollowUp,
} from '../../src/core/condense.js'
import type { AxiomConfig } from '../../src/config/index.js'
import type { ChatTurn } from '../../src/core/threads.js'

const config = {
  wikiDir: '/tmp/does-not-matter',
  rawDir: '/tmp/does-not-matter/raw',
  provider: 'openai',
  apiKey: 'test',
  model: 'gpt-4o-mini',
} as unknown as AxiomConfig

const history: ChatTurn[] = [
  { role: 'user', content: 'What is the halting problem?' },
  { role: 'assistant', content: 'The halting problem asks whether a program halts on a given input.' },
]

describe('looksSelfContained', () => {
  it('accepts questions that name their own subject', () => {
    expect(looksSelfContained('What is the difference between TCP and UDP?')).toBe(true)
    expect(looksSelfContained('Summarize the Scout intake queue design')).toBe(true)
  })

  it('treats anaphora and short openers as follow-ups', () => {
    expect(looksSelfContained('and how does that compare?')).toBe(false)
    expect(looksSelfContained('What about the second one?')).toBe(false)
    expect(looksSelfContained('Why?')).toBe(false)
    expect(looksSelfContained('Tell me more')).toBe(false)
  })
})

describe('fallbackStandaloneQuery', () => {
  it('returns the follow-up when there is no history', () => {
    expect(fallbackStandaloneQuery(null, 'and then?')).toBe('and then?')
  })

  it('keeps the previous question for context', () => {
    expect(fallbackStandaloneQuery('What is X?', 'how does it work?')).toBe(
      'What is X? how does it work?',
    )
  })

  it('does not duplicate a question that already contains the follow-up', () => {
    expect(fallbackStandaloneQuery('What is the halting problem?', 'halting problem')).toBe(
      'What is the halting problem?',
    )
  })
})

describe('rewriteFollowUp', () => {
  it('returns the typed question unchanged when there is no history', async () => {
    let called = false
    const result = await rewriteFollowUp(config, [], 'and why is that?', {
      generate: async () => {
        called = true
        return 'should not run'
      },
    })
    expect(called).toBe(false)
    expect(result).toEqual({ query: 'and why is that?', rewritten: false })
  })

  it('skips the model for a self-contained question', async () => {
    let called = false
    const result = await rewriteFollowUp(config, history, 'What is a Turing machine?', {
      generate: async () => {
        called = true
        return 'unused'
      },
    })
    expect(called).toBe(false)
    expect(result.rewritten).toBe(false)
    expect(result.query).toBe('What is a Turing machine?')
  })

  it('rewrites a follow-up into a standalone query', async () => {
    const result = await rewriteFollowUp(config, history, 'and why does that matter?', {
      generate: async (prompt) => {
        expect(prompt).toContain('What is the halting problem?')
        return 'Why does the halting problem matter?'
      },
    })
    expect(result).toEqual({
      query: 'Why does the halting problem matter?',
      rewritten: true,
    })
  })

  it('strips a label the model adds', async () => {
    const result = await rewriteFollowUp(config, history, 'what about it?', {
      generate: async () => 'Standalone query: "halting problem significance"',
    })
    expect(result.query).toBe('halting problem significance')
  })

  it('falls back to the previous question when the model fails', async () => {
    const result = await rewriteFollowUp(config, history, 'and why?', {
      generate: async () => {
        throw new Error('rate limited')
      },
    })
    expect(result.rewritten).toBe(true)
    expect(result.query).toContain('What is the halting problem?')
    expect(result.query).toContain('and why?')
  })

  it('treats an essay-length response as a failed rewrite', async () => {
    const result = await rewriteFollowUp(config, history, 'and why?', {
      generate: async () => 'x'.repeat(400),
    })
    expect(result.query).toContain('What is the halting problem?')
  })

  it('builds a prompt with the conversation and the follow-up', () => {
    const prompt = buildRewritePrompt(history, 'and why?')
    expect(prompt).toContain('Q: What is the halting problem?')
    expect(prompt).toContain('Follow-up: and why?')
    expect(prompt).toContain('Standalone query:')
  })
})
