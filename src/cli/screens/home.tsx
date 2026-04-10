import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { getConfig, hasConfig } from '../../config/index.js'
import { getStatus } from '../../core/wiki.js'
import { Header } from '../components/Header.js'
import { SlashMenu, SLASH_COMMANDS, filterCommands, parseSlash } from '../components/SlashMenu.js'
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
  const [menuIndex, setMenuIndex] = useState(0)
  const [totalPages, setTotalPages] = useState<number | undefined>(undefined)
  const [log, setLog] = useState<LogLine[]>([
    { text: 'Type /help to see commands, or ask a question.', color: 'gray' },
  ])

  const menuMatches = useMemo(
    () => input.startsWith('/') ? filterCommands(input) : [],
    [input]
  )
  const showSlashMenu = menuMatches.length > 0
  // Clamp menuIndex whenever matches list shrinks (avoids out-of-bounds without an extra effect)
  const safeMenuIndex = menuMatches.length > 0 ? Math.min(menuIndex, menuMatches.length - 1) : 0

  useEffect(() => {
    setMenuIndex(0)
  }, [input])

  const screenName = screen.name
  useEffect(() => {
    if (!config) return
    getStatus(config.wikiDir, config.rawDir)
      .then((s) => setTotalPages(s.totalPages))
      .catch(() => {})
  }, [screenName])

  const handleInput = useCallback((char: string, key: any) => {
    if (screen.name !== 'shell') return
    if (key.ctrl && char === 'c') exit()

    if (showSlashMenu) {
      if (key.upArrow) {
        setMenuIndex((i) => Math.max(0, i - 1))
        return
      }
      if (key.downArrow) {
        setMenuIndex((i) => Math.min(menuMatches.length - 1, i + 1))
        return
      }
      // Tab or right arrow completes the selected command into the input
      if (key.tab || key.rightArrow) {
        const cmd = menuMatches[safeMenuIndex]
        if (cmd) setInput(`/${cmd.name}${cmd.args ? ' ' : ''}`)
        return
      }
    }

    if (key.escape) {
      if (input.length > 0) {
        setInput('')
      }
    }
  }, [screen.name, showSlashMenu, menuMatches, safeMenuIndex, input, exit])

  useInput(handleInput)

  const addLog = useCallback((...lines: LogLine[]) => {
    setLog((prev) => [...prev, ...lines].slice(-80))
  }, [])

  const runCommand = useCallback((trimmed: string) => {
    addLog({ text: `> ${trimmed}`, color: 'cyan' })

    if (trimmed.startsWith('/')) {
      // If user hits Enter while menu is open with a selection, use that command
      const parsed = parseSlash(trimmed)

      if (!parsed) {
        addLog({ text: `  Unknown command: ${trimmed}`, color: 'red' })
        addLog({ text: '  Type /help to see available commands.', color: 'gray' })
        return
      }

      if (parsed.command === 'help') { addLog(...HELP_LINES); return }
      if (parsed.command === 'status')  { setScreen({ name: 'status' }); return }
      if (parsed.command === 'model')   { setScreen({ name: 'model' }); return }
      if (parsed.command === 'watch')   { setScreen({ name: 'watch' }); return }
      if (parsed.command === 'sources') { setScreen({ name: 'sources' }); return }
      if (parsed.command === 'review')  { setScreen({ name: 'review' }); return }

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
  }, [addLog])

  const submit = useCallback((value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return

    // If menu is open, Enter completes the command — user then adds args and presses Enter again
    if (showSlashMenu && menuMatches[safeMenuIndex]) {
      const cmd = menuMatches[safeMenuIndex]!
      const completion = `/${cmd.name}${cmd.args ? ' ' : ''}`
      if (trimmed !== completion.trim()) {
        setInput(completion)
        return
      }
      // Input already matches the command exactly — fall through to run it
    }

    setInput('')
    runCommand(trimmed)
  }, [showSlashMenu, menuMatches, safeMenuIndex, runCommand])

  const goHome = useCallback(() => setScreen({ name: 'shell' }), [])

  // ── Not configured ────────────────────────────────────────────────────────
  if (!hasConfig() || !config) {
    return (
      <Box paddingX={2} paddingY={1} flexDirection="column">
        <Box flexDirection="column">
          <Text color="cyan" bold>{'  █████╗ ██╗  ██╗██╗ ██████╗ ███╗   ███╗'}</Text>
          <Text color="cyan" bold>{'  ██╔══██╗╚██╗██╔╝██║██╔═══██╗████╗ ████║'}</Text>
          <Text color="cyan" bold>{'  ███████║ ╚███╔╝ ██║██║   ██║██╔████╔██║'}</Text>
          <Text color="cyan" bold>{'  ██╔══██║ ██╔██╗ ██║██║   ██║██║╚██╔╝██║'}</Text>
          <Text color="cyan" bold>{'  ██║  ██║██╔╝ ██╗██║╚██████╔╝██║ ╚═╝ ██║'}</Text>
          <Text color="cyan" bold>{'  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝'}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray" dimColor>{'  '}The wiki that maintains itself.</Text>
        </Box>
        <Box marginTop={2}>
          <Text color="yellow">  Run <Text color="cyan">axiom-wiki init</Text> to get started.</Text>
        </Box>
      </Box>
    )
  }

  // ── Sub-screens ───────────────────────────────────────────────────────────
  if (screen.name === 'query')   return <QueryScreen prefill={screen.prefill} onExit={goHome} />
  if (screen.name === 'ingest')  return <IngestScreen file={screen.file} interactive={screen.interactive} onExit={goHome} />
  if (screen.name === 'status')  return <StatusScreen onExit={goHome} />
  if (screen.name === 'model')   return <ModelScreen onExit={goHome} />
  if (screen.name === 'watch')   return <WatchScreen onExit={goHome} />
  if (screen.name === 'clip')    return <ClipScreen url={screen.url} onExit={goHome} />
  if (screen.name === 'sources') return <SourcesScreen onExit={goHome} />
  if (screen.name === 'review')  return <ReviewScreen onExit={goHome} />

  // ── Shell ─────────────────────────────────────────────────────────────────
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
      {showSlashMenu && (
        <SlashMenu
          selectedIndex={safeMenuIndex}
          matches={menuMatches}
          onSelect={(cmd) => { setInput(`/${cmd.name}${cmd.args ? ' ' : ''}`); setMenuIndex(0) }}
        />
      )}

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
        <Text color="gray" dimColor>Ctrl+C to exit  ·  ↑↓ navigate  ·  Enter/Tab complete  ·  Esc clear</Text>
      </Box>
    </Box>
  )
}
