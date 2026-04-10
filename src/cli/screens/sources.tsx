import React, { useState, useEffect } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { getConfig } from '../../config/index.js'
import { listSources, getSource, removeSource, markForReingest, type SourceRecord } from '../../core/sources.js'

type View = 'list' | 'viewing' | 'confirm-delete' | 'confirm-reingest' | 'loading'

export function SourcesScreen() {
  const { exit } = useApp()
  const config = getConfig()

  const [sources, setSources] = useState<SourceRecord[]>([])
  const [selected, setSelected] = useState(0)
  const [view, setView] = useState<View>('loading')
  const [viewContent, setViewContent] = useState('')
  const [message, setMessage] = useState<{ text: string; color: string } | null>(null)
  const [viewScroll, setViewScroll] = useState(0)

  useEffect(() => {
    if (!config) return
    void listSources(config.wikiDir).then((s) => {
      setSources(s)
      setView('list')
    })
  }, [])

  useInput((input, key) => {
    if (view === 'list') {
      if (key.upArrow) setSelected((s) => Math.max(0, s - 1))
      if (key.downArrow) setSelected((s) => Math.min(sources.length - 1, s + 1))
      if (input === 'v' || input === 'V') handleView()
      if (input === 'd' || input === 'D') setView('confirm-delete')
      if (input === 'r' || input === 'R') setView('confirm-reingest')
      if (input === 'q' || key.escape) exit()
    }

    if (view === 'viewing') {
      if (key.upArrow) setViewScroll((s) => Math.max(0, s - 1))
      if (key.downArrow) setViewScroll((s) => s + 1)
      if (input === 'q' || key.escape || key.return) {
        setView('list')
        setViewContent('')
        setViewScroll(0)
      }
    }

    if (view === 'confirm-delete') {
      if (input === 'y' || input === 'Y') void handleDelete()
      if (input === 'n' || input === 'N' || key.escape) setView('list')
    }

    if (view === 'confirm-reingest') {
      if (input === 'y' || input === 'Y') void handleReingest()
      if (input === 'n' || input === 'N' || key.escape) setView('list')
    }
  })

  async function handleView() {
    if (!config || sources.length === 0) return
    const src = sources[selected]
    if (!src) return
    try {
      const content = await getSource(config.wikiDir, src.filename)
      setViewContent(content)
      setViewScroll(0)
      setView('viewing')
    } catch {
      setMessage({ text: `No summary page found for ${src.filename}`, color: 'yellow' })
      setTimeout(() => setMessage(null), 3000)
    }
  }

  async function handleDelete() {
    if (!config || sources.length === 0) return
    const src = sources[selected]
    if (!src) return
    try {
      await removeSource(config.wikiDir, src.filename)
      const updated = await listSources(config.wikiDir)
      setSources(updated)
      setSelected((s) => Math.min(s, Math.max(0, updated.length - 1)))
      setMessage({ text: `Removed ${src.filename}`, color: 'green' })
      setTimeout(() => setMessage(null), 3000)
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), color: 'red' })
      setTimeout(() => setMessage(null), 3000)
    }
    setView('list')
  }

  async function handleReingest() {
    if (!config || sources.length === 0) return
    const src = sources[selected]
    if (!src) return
    await markForReingest(config.wikiDir, src.filename)
    setMessage({ text: `Marked ${src.filename} for re-ingest`, color: 'green' })
    setTimeout(() => setMessage(null), 3000)
    setView('list')
  }

  if (!config) {
    return (
      <Box padding={1}>
        <Text color="yellow">Not configured. Run <Text color="cyan">axiom-wiki init</Text> first.</Text>
      </Box>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (view === 'loading') {
    return (
      <Box padding={1}>
        <Text color="gray">Loading sources...</Text>
      </Box>
    )
  }

  const currentSrc = sources[selected]

  // ── View source content ────────────────────────────────────────────────────
  if (view === 'viewing' && currentSrc) {
    const lines = viewContent.split('\n').slice(viewScroll, viewScroll + 30)
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">{currentSrc.filename}</Text>
        <Box marginTop={1} flexDirection="column">
          {lines.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color="gray">↑↓ scroll   q/Enter back</Text>
        </Box>
      </Box>
    )
  }

  // ── Confirm delete ─────────────────────────────────────────────────────────
  if (view === 'confirm-delete' && currentSrc) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="red">Delete source "{currentSrc.filename}"?</Text>
        {currentSrc.summaryPage ? (
          <Box marginTop={1}>
            <Text color="gray">This will remove <Text color="white">{currentSrc.summaryPage}</Text></Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color="yellow">No summary page found — nothing to delete.</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text>Confirm? </Text>
          <Text color="gray">(y/N)</Text>
        </Box>
      </Box>
    )
  }

  // ── Confirm re-ingest ──────────────────────────────────────────────────────
  if (view === 'confirm-reingest' && currentSrc) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Mark "{currentSrc.filename}" for re-ingest?</Text>
        <Box marginTop={1}>
          <Text color="gray">Next ingest will diff against existing pages.</Text>
        </Box>
        <Box marginTop={1}>
          <Text>Confirm? </Text>
          <Text color="gray">(y/N)</Text>
        </Box>
      </Box>
    )
  }

  // ── List view ──────────────────────────────────────────────────────────────
  if (sources.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Sources (0 ingested)</Text>
        <Box marginTop={1}>
          <Text color="gray">No sources ingested yet.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Run <Text color="cyan">axiom-wiki ingest {'<file>'}</Text> to add your first source.</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">Sources ({sources.length} ingested)</Text>

      <Box marginTop={1} flexDirection="column">
        {sources.map((src, i) => {
          const isSelected = i === selected
          return (
            <Box key={i}>
              <Text color={isSelected ? 'cyan' : undefined}>
                {isSelected ? '▶ ' : '  '}
              </Text>
              <Text bold={isSelected} color={isSelected ? 'white' : 'gray'}>
                {src.filename.padEnd(30)}
              </Text>
              <Text color="gray">
                {src.ingestedAt}{'   '}
                {src.pageCount > 0 ? `${src.pageCount} pages` : ''}
              </Text>
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">↑↓ navigate   </Text>
        <Text color="gray">v view   </Text>
        <Text color="gray">r re-ingest   </Text>
        <Text color="gray">d delete   </Text>
        <Text color="gray">q quit</Text>
      </Box>

      {message && (
        <Box marginTop={1}>
          <Text color={message.color as any}>{message.text}</Text>
        </Box>
      )}
    </Box>
  )
}
