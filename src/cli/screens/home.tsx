import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { getConfig, hasConfig } from '../../config/index.js'
import { getStatus } from '../../core/wiki.js'
import { Header } from '../components/Header.js'
import { SlashMenu, SLASH_COMMANDS, parseSlash } from '../components/SlashMenu.js'
import { QueryScreen } from './query.js'
import { IngestScreen } from './ingest.js'
import { StatusScreen } from './status.js'
import { ModelScreen } from './model.js'
import { WatchScreen } from './watch.js'
import { ClipScreen } from './clip.js'
import { SourcesScreen } from './sources.js'
import { ReviewScreen } from './review.js'

type ActiveScreen =
  | { name: 'shell' }
  | { name: 'query'; prefill?: string }
  | { name: 'ingest'; file?: string; interactive?: boolean }
  | { name: 'status' }
  | { name: 'model' }
  | { name: 'watch' }
  | { name: 'clip'; url?: string }
  | { name: 'sources' }
  | { name: 'review' }

interface LogLine {
  text: string
  color?: string
}

const HELP_LINES: LogLine[] = [
  { text: 'Available commands:', color: 'white' },
  ...SLASH_COMMANDS.map((c) => ({
    text: `  /${c.name}${c.args ? ' ' + c.args : ''}  —  ${c.desc}`,
    color: 'gray',
  })),
  { text: '  Or type a question to query your wiki directly.', color: 'gray' },
]

export function HomeScreen() {
  const { exit } = useApp()
  const config = getConfig()

  const [screen, setScreen] = useState<ActiveScreen>({ name: 'shell' })
  const [input, setInput] = useState('')
  const [totalPages, setTotalPages] = useState<number | undefined>(undefined)
  const [log, setLog] = useState<LogLine[]>([
    { text: 'Type /help to see commands, or ask a question.', color: 'gray' },
  ])

  useEffect(() => {
    if (!config) return
    getStatus(config.wikiDir, config.rawDir)
      .then((s) => setTotalPages(s.totalPages))
      .catch(() => {})
  }, [screen]) // refresh stats when returning to shell

  useInput((char, key) => {
    if (screen.name !== 'shell') return
    if (key.ctrl && char === 'c') exit()
  })

  const addLog = useCallback((...lines: LogLine[]) => {
    setLog((prev) => [...prev, ...lines].slice(-80))
  }, [])

  const submit = useCallback((value: string) => {
    const trimmed = value.trim()
    setInput('')
    if (!trimmed) return

    addLog({ text: `> ${trimmed}`, color: 'cyan' })

    // Slash command
    if (trimmed.startsWith('/')) {
      const parsed = parseSlash(trimmed)

      if (!parsed) {
        addLog({ text: `  Unknown command: ${trimmed}`, color: 'red' })
        addLog({ text: '  Type /help to see available commands.', color: 'gray' })
        return
      }

      if (parsed.command === 'help') {
        addLog(...HELP_LINES)
        return
      }

      if (parsed.command === 'status') { setScreen({ name: 'status' }); return }
      if (parsed.command === 'model')  { setScreen({ name: 'model' }); return }
      if (parsed.command === 'watch')  { setScreen({ name: 'watch' }); return }
      if (parsed.command === 'sources') { setScreen({ name: 'sources' }); return }
      if (parsed.command === 'review') { setScreen({ name: 'review' }); return }

      if (parsed.command === 'ingest') {
        const interactive = parsed.arg.includes('--interactive')
        const file = parsed.arg.replace('--interactive', '').trim() || undefined
        setScreen({ name: 'ingest', file, interactive })
        return
      }

      if (parsed.command === 'clip') {
        setScreen({ name: 'clip', url: parsed.arg || undefined })
        return
      }

      if (parsed.command === 'lint') {
        addLog({ text: '  Run: axiom-wiki lint', color: 'gray' })
        addLog({ text: '  (lint runs outside the shell — use the CLI directly)', color: 'gray' })
        return
      }

      return
    }

    // Direct question → query mode
    setScreen({ name: 'query', prefill: trimmed })
  }, [addLog, exit])

  // ── Not configured ────────────────────────────────────────────────────────
  if (!hasConfig() || !config) {
    return (
      <Box padding={1} flexDirection="column">
        <Box borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1} flexDirection="column">
          <Text bold color="cyan">axiom wiki</Text>
          <Text color="gray">The wiki that maintains itself.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="yellow">Run <Text color="cyan">axiom-wiki init</Text> to get started.</Text>
        </Box>
      </Box>
    )
  }

  // ── Sub-screens ───────────────────────────────────────────────────────────
  if (screen.name === 'query')   return <QueryScreen prefill={screen.prefill} onExit={() => setScreen({ name: 'shell' })} />
  if (screen.name === 'ingest')  return <IngestScreen file={screen.file} interactive={screen.interactive} onExit={() => setScreen({ name: 'shell' })} />
  if (screen.name === 'status')  return <StatusScreen onExit={() => setScreen({ name: 'shell' })} />
  if (screen.name === 'model')   return <ModelScreen onExit={() => setScreen({ name: 'shell' })} />
  if (screen.name === 'watch')   return <WatchScreen onExit={() => setScreen({ name: 'shell' })} />
  if (screen.name === 'clip')    return <ClipScreen url={screen.url} onExit={() => setScreen({ name: 'shell' })} />
  if (screen.name === 'sources') return <SourcesScreen onExit={() => setScreen({ name: 'shell' })} />
  if (screen.name === 'review')  return <ReviewScreen onExit={() => setScreen({ name: 'shell' })} />

  // ── Shell ─────────────────────────────────────────────────────────────────
  const showSlashMenu = input.startsWith('/')

  return (
    <Box flexDirection="column" padding={1}>
      <Header config={config} totalPages={totalPages} />

      {/* Log / output area */}
      <Box flexDirection="column" marginBottom={1}>
        {log.slice(-12).map((line, i) => (
          <Text key={i} color={(line.color as any) ?? undefined}>{line.text}</Text>
        ))}
      </Box>

      {/* Slash command menu */}
      {showSlashMenu && <SlashMenu input={input} />}

      {/* Input */}
      <Box>
        <Text color="cyan" bold>{'> '}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder="type /help or ask a question..."
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>Ctrl+C to exit</Text>
      </Box>
    </Box>
  )
}
