import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import path from 'path'
import fs from 'fs'
import { getConfig } from '../../config/index.js'
import { createAxiomAgent } from '../../agent/index.js'
import { writePage, appendLog, listPages } from '../../core/wiki.js'

type QueryState = 'idle' | 'thinking' | 'filing_prompt' | 'filing_title' | 'filing'

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
}

export function QueryScreen({ onExit, prefill }: Props) {
  const { exit } = useApp()
  const doExit = onExit ?? exit
  const config = getConfig()

  const [state, setState] = useState<QueryState>('idle')
  const [input, setInput] = useState(prefill ?? '')
  const [streamText, setStreamText] = useState('')
  const [history, setHistory] = useState<QAPair[]>([])
  const [currentQ, setCurrentQ] = useState('')
  const [currentA, setCurrentA] = useState('')
  const [filingTitle, setFilingTitle] = useState('')
  const [statusLine, setStatusLine] = useState('')
  const [wikiEmpty, setWikiEmpty] = useState(false)

  // Check if wiki is empty on mount
  useEffect(() => {
    if (!config) return
    listPages(config.wikiDir).then((pages) => {
      if (pages.length === 0) setWikiEmpty(true)
    })
  }, [])

  // Handle y/n at filing prompt
  useInput((char, key) => {
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

    setInput('')
    setCurrentQ(q)
    setCurrentA('')
    setStreamText('')
    setState('thinking')

    const agent = createAxiomAgent(config)

    // Build context messages from history (max last 10 exchanges)
    const contextMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    for (const pair of history.slice(-10)) {
      contextMessages.push({ role: 'user', content: pair.question })
      contextMessages.push({ role: 'assistant', content: pair.answer })
    }
    contextMessages.push({ role: 'user', content: q })

    try {
      const stream = await agent.stream(contextMessages)
      let fullAnswer = ''

      for await (const chunk of stream.textStream) {
        fullAnswer += chunk
        setCurrentA(fullAnswer)
        setStreamText(fullAnswer)
        setState('answering' as any)
      }

      await appendLog(config.wikiDir, q, 'query')
      setCurrentA(fullAnswer)
      setState('filing_prompt')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setCurrentA(`Error: ${msg}`)
      commitQA(q, `Error: ${msg}`)
      setState('idle')
    }
  }, [config, history, doExit])

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

  const divider = '─'.repeat(50)

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Axiom Wiki — Query</Text>
      <Text color="gray">{divider}</Text>

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
        </Box>
      )}
    </Box>
  )
}
