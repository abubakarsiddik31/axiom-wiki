import { generateText } from 'ai'

import { resolveModel } from '../agent/index.js'
import type { AxiomConfig } from '../config/index.js'
import type { ChatTurn } from './threads.js'

/**
 * Follow-up retrieval.
 *
 * A chat turn like "and how does that compare to the other one?" is a fine
 * thing to ask and a useless thing to search for. Before retrieval we rewrite
 * it into a standalone query using the recent conversation — one small model
 * call, skipped entirely when the question already stands on its own.
 *
 * The rewrite never feeds the answer prompt. The model still sees the user's
 * actual words; only search uses the normalized form, which is shown in the UI.
 */

const ANAPHORA =
  /\b(it|its|it's|they|them|their|theirs|this|that|these|those|he|she|him|her|his|the first|the second|the third|the last|the former|the latter|the same|the other|above|previous|earlier|mentioned|aforementioned|again|also|too|then|there)\b/i

const OPENER =
  /^(and|but|so|then|also|or|why|how about|what about|what if|which one|compare|does it|do they|is it|are they|can you|tell me more|go on|continue|expand|elaborate)\b/i

export interface RewriteResult {
  query: string
  /** True when the query differs from what the user typed. */
  rewritten: boolean
}

export interface RewriteOptions {
  /** Test/override hook — returns the model's raw text. */
  generate?: (prompt: string) => Promise<string>
}

/** A question that names its own subject usually does not need rewriting. */
export function looksSelfContained(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (OPENER.test(q) || ANAPHORA.test(q)) return false
  const words = q.split(/\s+/).length
  if (words <= 4) return false
  return true
}

/**
 * Deterministic fallback: keep the previous question and append the follow-up.
 * This over-fetches slightly, but it never fails and never invents a subject.
 */
export function fallbackStandaloneQuery(
  previous: string | null,
  followUp: string,
): string {
  const next = followUp.trim()
  const prior = previous?.trim() ?? ''
  if (!prior) return next
  if (!next) return prior
  if (prior.toLowerCase().includes(next.toLowerCase())) return prior

  const merged = `${prior} ${next}`
  return merged.length > 240 ? `${merged.slice(0, 239).trimEnd()}…` : merged
}

function excerpt(content: string, max: number): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export function buildRewritePrompt(history: ChatTurn[], followUp: string): string {
  const recent = history.slice(-6)
  const transcript = recent
    .map((turn) =>
      turn.role === 'user'
        ? `Q: ${excerpt(turn.content, 240)}`
        : `A: ${excerpt(turn.content, 400)}`,
    )
    .join('\n')

  return [
    'Rewrite the follow-up into a standalone search query for a personal wiki.',
    'Use the conversation only to resolve pronouns and references.',
    'Keep entity names and technical terms exactly as written.',
    'Do not answer. Output one line, under 20 words, with no quotes or prefix.',
    '',
    'Conversation:',
    transcript,
    '',
    `Follow-up: ${excerpt(followUp, 400)}`,
    '',
    'Standalone query:',
  ].join('\n')
}

function cleanRewrite(raw: string, followUp: string): string {
  let value = raw.trim()
  value = value.replace(/^(standalone query|query|search)\s*:\s*/i, '')
  value = value.replace(/^["'“”]+|["'“”]+$/g, '')
  value = value.replace(/\s+/g, ' ').trim()

  if (!value) return ''
  // A model that ignores the instruction and answers at length is not a query.
  if (value.length > 240) return ''
  if (value.toLowerCase() === followUp.trim().toLowerCase()) return value
  return value
}

function defaultGenerate(config: AxiomConfig): (prompt: string) => Promise<string> {
  return async (prompt) => {
    const result = await generateText({
      model: resolveModel(config),
      system:
        'You normalize follow-up questions into standalone search queries. ' +
        'You never answer the question and never add new subjects.',
      prompt,
      // Reasoning models spend this budget before emitting a single token of
      // text; a tight limit silently yields an empty rewrite.
      maxOutputTokens: 512,
      temperature: 0,
    })
    return result.text
  }
}

/**
 * Returns the query retrieval should use for this turn. `rewritten` is false
 * when the typed question was used as-is.
 */
export async function rewriteFollowUp(
  config: AxiomConfig,
  history: ChatTurn[],
  followUp: string,
  options: RewriteOptions = {},
): Promise<RewriteResult> {
  const prior = history.filter((turn) => turn.content.trim().length > 0)
  if (prior.length === 0 || looksSelfContained(followUp)) {
    return { query: followUp, rewritten: false }
  }

  const previousUser =
    [...prior].reverse().find((turn) => turn.role === 'user')?.content ?? null

  try {
    const generate = options.generate ?? defaultGenerate(config)
    const raw = await generate(buildRewritePrompt(prior, followUp))
    const query = cleanRewrite(raw, followUp)
    if (!query) throw new Error('Empty rewrite.')
    return { query, rewritten: query.toLowerCase() !== followUp.trim().toLowerCase() }
  } catch {
    return {
      query: fallbackStandaloneQuery(previousUser, followUp),
      rewritten: true,
    }
  }
}
