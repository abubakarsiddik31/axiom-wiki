import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import path from 'path'
import fs from 'fs'
import { getConfig } from '../../config/index.js'
import { createAxiomAgent } from '../../agent/index.js'
import { withRetry } from '../../core/retry.js'
import { writePage, appendLog, listPages } from '../../core/wiki.js'
import { assembleContext, type ContextSource } from '../../core/context.js'
import {
  appendMessage,
  createThread,
  loadThread,
  newMessage,
  titleFromQuestion,
  type ThreadRerank,
} from '../../core/threads.js'

type QueryState = 'idle' | 'thinking' | 'answering' | 'filing_prompt' | 'filing_title' | 'filing'

interface QAPair {
  question: string
  answer: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
}

interface Props {
  onExit?: () => void
  prefill?: string
  forensic?: boolean
  /** Resume a saved conversation. */
  threadId?: string
}

export function QueryScreen({ onExit, prefill, forensic, threadId }: Props) {
  const { exit } = useApp()
  const doExit = onExit ?? exit
  const config = getConfig()

  const [state, setState] = useState<QueryState>('idle')
  const [isForensic, setIsForensic] = useState(forensic ?? config?.forensicCitations ?? false)
  const [input, setInput] = useState(prefill ?? '')
  const [streamText, setStreamText] = useState('')
  const [history, setHistory] = useState<QAPair[]>([])
  const [currentQ, setCurrentQ] = useState('')
  const [currentA, setCurrentA] = useState('')
  const [filingTitle, setFilingTitle] = useState('')
  const [statusLine, setStatusLine] = useState('')
  const [wikiEmpty, setWikiEmpty] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(threadId ?? null)
  const [threadTitle, setThreadTitle] = useState<string | null>(null)

  // Check if wiki is empty on mount
  useEffect(() => {
    if (!config) return
    listPages(config.wikiDir).then((pages) => {
      if (pages.length === 0) setWikiEmpty(true)
    })
  }, [])

  // Resume a saved conversation: rebuild the visible history from its turns.
  // Depend on the directory string, not the config object, so a re-render does
  // not reset a conversation in progress.
  const threadWikiDir = config?.wikiDir ?? null
  useEffect(() => {
    if (!threadWikiDir || !threadId) return
    const thread = loadThread(threadWikiDir, threadId)
    if (!thread) return
    setThreadTitle(thread.title)
    const pairs: QAPair[] = []
    let pending: string | null = null
    for (const message of thread.messages) {
      if (message.role === 'user') {
        pending = message.content
      } else if (pending && !message.error) {
        pairs.push({ question: pending, answer: message.content })
        pending = null
      } else {
        pending = null
      }
    }
    setHistory(pairs.slice(-10))
  }, [threadWikiDir, threadId])

  // Handle y/n at filing prompt + global escape + mode toggle
  useInput((char, key) => {
    if (key.escape && state === 'idle') { doExit(); return }
    if (key.ctrl && (char === 'g' || char === 'G' || char === 'f' || char === 'F') && state === 'idle') {
      setIsForensic((prev) => {
        const next = !prev
        setStatusLine(next ? '🛡️ Strict Grounded Mode enabled' : 'Standard Query Mode enabled')
        setTimeout(() => setStatusLine(''), 2000)
        return next
      })
      return
    }
    if (state === 'filing_prompt') {
      if (char === 'y' || char === 'Y') {
        const suggested = slugify(currentQ)
        setFilingTitle(suggested)
        setState('filing_title')
      } else if (char === 'n' || char === 'N' || key.escape) {
        commitQA(currentQ, currentA)
        setState('idle')
        setCurrentQ('')
        setCurrentA('')
        setStreamText('')
      }
    }
  })

  function commitQA(q: string, a: string) {
    setHistory((prev) => [...prev, { question: q, answer: a }].slice(-10))
  }

  const submitQuestion = useCallback(async (question: string) => {
    if (!config) return
    const q = question.trim()
    if (!q || q === 'exit') { doExit(); return }

    if (q === '/forensic' || q === '/grounded') {
      setIsForensic((prev) => {
        const next = !prev
        setStatusLine(next ? '🛡️ Strict Grounded Mode enabled' : 'Standard Query Mode enabled')
        setTimeout(() => setStatusLine(''), 2000)
        return next
      })
      setInput('')
      return
    }

    setInput('')
    setCurrentQ(q)
    setCurrentA('')
    setStreamText('')
    setState('thinking')

    // Every question is durable before the model runs, and the first one
    // names the conversation.
    let thread = activeThreadId
    if (!thread) {
      const startingTitle = titleFromQuestion(q)
      thread = createThread(config.wikiDir, { title: startingTitle }).id
      setActiveThreadId(thread)
      setThreadTitle(startingTitle)
    }
    appendMessage(config.wikiDir, thread, newMessage('user', q, {}))

    const agent = createAxiomAgent(config, { forensic: isForensic })
    let sources: ContextSource[] = []
    let rerankInfo: ThreadRerank | null = null

    // Build context messages from history (max last 10 exchanges)
    const contextMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    for (const pair of history.slice(-10)) {
      contextMessages.push({ role: 'user', content: pair.question })
      contextMessages.push({ role: 'assistant', content: pair.answer })
    }
    contextMessages.push({ role: 'user', content: q })

    try {
      let prompt = q
      try {
        setStatusLine('Retrieving wiki context…')
        const evidence = await assembleContext(config, q, {
          onStatus: (message) => setStatusLine(message),
          rerank: { allowDownload: false },
        })
        sources = evidence.sources
        rerankInfo = evidence.rerank ?? null
        if (evidence.sources.length > 0) {
          prompt = `${evidence.text}\n\n## Question\n\n${q}`
          const rerankLabel = evidence.rerank
            ? evidence.rerank.used
              ? ` · reranked (${evidence.rerank.provider})`
              : ' · hybrid ranking'
            : ''
          setStatusLine(
            `Context: ${evidence.sources.length} pages${rerankLabel}`,
          )
        } else {
          setStatusLine('')
        }
      } catch {
        setStatusLine('')
      }
      contextMessages[contextMessages.length - 1] = { role: 'user', content: prompt }

      const stream = await withRetry(() => agent.stream(contextMessages))
      let fullAnswer = ''

      for await (const chunk of stream.textStream) {
        fullAnswer += chunk
        setCurrentA(fullAnswer)
        setStreamText(fullAnswer)
        setState('answering')
      }

      appendMessage(
        config.wikiDir,
        thread,
        newMessage('assistant', fullAnswer, { sources, rerank: rerankInfo }),
      )
      await appendLog(config.wikiDir, q, 'query')
      setCurrentA(fullAnswer)
      setState('filing_prompt')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      appendMessage(config.wikiDir, thread, newMessage('assistant', '', { error: msg }))
      setCurrentA(`Error: ${msg}`)
      commitQA(q, `Error: ${msg}`)
      setState('idle')
    }
  }, [config, history, doExit, activeThreadId, isForensic])

  const submitFiling = useCallback(async (title: string) => {
    if (!config) return
    setState('filing')
    const slug = slugify(title || currentQ)
    const today = new Date().toISOString().slice(0, 10)
    const content = `---
title: "${title || currentQ}"
summary: "Analysis: ${currentQ.slice(0, 80)}"
tags: [analysis]
category: analyses
updatedAt: "${today}"
---

## Question

${currentQ}

## Answer

${currentA}
`
    const filePath = `wiki/pages/analyses/${slug}.md`
    try {
      await writePage(config.wikiDir, filePath, content)
      setStatusLine(`✓ Filed as ${filePath}`)
    } catch (err: unknown) {
      setStatusLine(`✗ Failed to file: ${err instanceof Error ? err.message : String(err)}`)
    }

    commitQA(currentQ, currentA)
    setCurrentQ('')
    setCurrentA('')
    setStreamText('')
    setFilingTitle('')
    setTimeout(() => { setStatusLine(''); setState('idle') }, 1500)
  }, [config, currentQ, currentA])

  // ── Render ────────────────────────────────────────────────────────────────

  if (!config) {
    return (
      <Box padding={1}>
        <Text color="yellow">Not configured. Run <Text color="cyan">axiom-wiki init</Text> first.</Text>
      </Box>
    )
  }

  if (wikiEmpty) {
    return (
      <Box padding={1}>
        <Text color="yellow">Your wiki is empty. Run <Text color="cyan">axiom-wiki ingest</Text> first.</Text>
      </Box>
    )
  }

  const divider = '─'.repeat(55)

  return (
    <Box flexDirection="column" padding={1}>
      <Box justifyContent="space-between">
        <Text bold>Axiom Wiki — Query</Text>
        {isForensic ? (
          <Text color="green" bold>🛡️ STRICT GROUNDED (Zero trained knowledge)</Text>
        ) : (
          <Text color="gray">Standard Mode (Ctrl+G to toggle Grounded)</Text>
        )}
      </Box>
      <Text color="gray">{divider}</Text>
      {activeThreadId ? (
        <Text color="gray">
          thread: {activeThreadId}
          {threadTitle ? ` · ${threadTitle}` : ''}
        </Text>
      ) : null}

      {/* Chat history (last 5) */}
      {history.slice(-5).map((pair, i) => (
        <Box key={i} flexDirection="column" marginTop={1}>
          <Text color="cyan">Q: {pair.question}</Text>
          <Box marginTop={1}>
            <Text>A: {pair.answer.slice(0, 400)}{pair.answer.length > 400 ? '...' : ''}</Text>
          </Box>
          <Text color="gray">{divider}</Text>
        </Box>
      ))}

      {/* Current exchange */}
      {currentQ ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan">Q: {currentQ}</Text>
          {(state === 'thinking') && (
            <Box marginTop={1}>
              <Text color="gray">⠸ Searching wiki...</Text>
            </Box>
          )}
          {currentA ? (
            <Box marginTop={1} flexDirection="column">
              <Text>A: {currentA}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {/* Filing prompt */}
      {state === 'filing_prompt' && (
        <Box marginTop={1}>
          <Text color="gray">{divider}</Text>
          <Box marginTop={1}>
            <Text>File this answer as an analysis page? </Text>
            <Text color="cyan">[y/n]</Text>
          </Box>
        </Box>
      )}

      {/* Filing title input */}
      {state === 'filing_title' && (
        <Box marginTop={1} flexDirection="column">
          <Text>Page title:</Text>
          <Box marginTop={1}>
            <Text>{'> '}</Text>
            <TextInput
              value={filingTitle}
              onChange={setFilingTitle}
              onSubmit={submitFiling}
            />
          </Box>
        </Box>
      )}

      {state === 'filing' && (
        <Box marginTop={1}>
          <Text color="gray">Filing answer...</Text>
        </Box>
      )}

      {statusLine ? (
        <Box marginTop={1}>
          <Text color={statusLine.startsWith('✓') ? 'green' : 'red'}>{statusLine}</Text>
        </Box>
      ) : null}

      {/* Input */}
      {state === 'idle' && (
        <Box marginTop={1}>
          <Text color="gray">{divider}</Text>
          <Box marginTop={1}>
            <Text color="cyan">Q: </Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={submitQuestion}
              placeholder="Ask a question... (type 'exit' to quit)"
            />
          </Box>
          <Box marginTop={1}>
            <Text color="gray" dimColor>Ctrl+C or type 'exit' to quit</Text>
          </Box>
          {activeThreadId ? (
            <Box marginTop={1}>
              <Text color="gray" dimColor>
                Saved · resume with: axiom-wiki query --thread {activeThreadId}
              </Text>
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  )
}
