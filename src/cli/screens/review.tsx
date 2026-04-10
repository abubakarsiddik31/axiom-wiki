import React, { useState, useEffect } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import { getConfig } from '../../config/index.js'
import { createAxiomAgent } from '../../agent/index.js'
import { listPages, readPage, writePage } from '../../core/wiki.js'

interface ContradictionPage {
  path: string
  title: string
  block: string   // the extracted ⚠️ block text
}

type View = 'scanning' | 'list' | 'resolving' | 'edit' | 'applying' | 'empty' | 'done'

function extractBlock(content: string): string {
  const m = content.match(/> ⚠️ Contradiction:.*$/m)
  return m ? m[0].replace(/^> /, '').trim() : '⚠️ Contradiction detected'
}

interface Props {
  onExit?: () => void
}

export function ReviewScreen({ onExit }: Props) {
  const { exit } = useApp()
  const doExit = onExit ?? exit
  const config = getConfig()

  const [view, setView] = useState<View>('scanning')
  const [pages, setPages] = useState<ContradictionPage[]>([])
  const [selected, setSelected] = useState(0)
  const [recommendation, setRecommendation] = useState('')
  const [editText, setEditText] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [resolved, setResolved] = useState(0)

  // Scan for contradictions on mount
  useEffect(() => {
    if (!config) return
    const scan = async () => {
      const allPages = await listPages(config.wikiDir)
      const found: ContradictionPage[] = []
      for (const p of allPages) {
        const content = await readPage(config.wikiDir, p.path)
        if (content.includes('⚠️ Contradiction:')) {
          found.push({ path: p.path, title: p.title, block: extractBlock(content) })
        }
      }
      setPages(found)
      setView(found.length === 0 ? 'empty' : 'list')
    }
    void scan()
  }, [])

  useInput((input, key) => {
    if (view === 'list') {
      if (key.upArrow) setSelected((s) => Math.max(0, s - 1))
      if (key.downArrow) setSelected((s) => Math.min(pages.length - 1, s + 1))
      if (key.return) void startResolve()
      if (input === 'q' || key.escape) doExit()
    }
    if (view === 'resolving') {
      if (input === 'y' || input === 'Y' || key.return) void applyResolution(recommendation)
      if (input === 'n' || input === 'N') { setRecommendation(''); setView('list') }
      if (input === 'e' || input === 'E') { setEditText(recommendation); setView('edit') }
    }
    if (view === 'done' || view === 'empty') {
      if (input === 'q' || key.return || key.escape) doExit()
    }
  })

  async function startResolve() {
    if (!config || pages.length === 0) return
    const page = pages[selected]!
    setRecommendation('')
    setView('resolving')

    const agent = createAxiomAgent(config)
    const content = await readPage(config.wikiDir, page.path)

    try {
      const result = await agent.generate([{
        role: 'user',
        content: `Review this contradiction on page "${page.path}" and recommend a resolution.\n\nPage content:\n${content.slice(0, 3000)}`,
      }])
      setRecommendation(result.text)
    } catch (err) {
      setRecommendation(`Could not get recommendation: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function applyResolution(resolution: string) {
    if (!config || pages.length === 0) return
    const page = pages[selected]!
    setView('applying')

    try {
      const content = await readPage(config.wikiDir, page.path)
      const updated = content.replace(/> ⚠️ Contradiction:.*$/m, resolution.trim() ? resolution.trim() : '')
      await writePage(config.wikiDir, page.path, updated.trim())

      const remaining = pages.filter((_, i) => i !== selected)
      setResolved((n) => n + 1)
      setPages(remaining)
      setSelected((s) => Math.min(s, Math.max(0, remaining.length - 1)))
      setRecommendation('')
      setStatusMsg(`✓ Resolved: ${page.path}`)
      setTimeout(() => setStatusMsg(''), 2000)
      setView(remaining.length === 0 ? 'done' : 'list')
    } catch (err) {
      setStatusMsg(`✗ ${err instanceof Error ? err.message : String(err)}`)
      setTimeout(() => setStatusMsg(''), 3000)
      setView('list')
    }
  }

  if (!config) {
    return (
      <Box padding={1}>
        <Text color="yellow">Not configured. Run <Text color="cyan">axiom-wiki init</Text> first.</Text>
      </Box>
    )
  }

  // ── Scanning ───────────────────────────────────────────────────────────────
  if (view === 'scanning') {
    return (
      <Box padding={1} flexDirection="column">
        <Text bold color="cyan">axiom review</Text>
        <Box marginTop={1}><Text color="gray">⠸ Scanning wiki for contradictions...</Text></Box>
      </Box>
    )
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (view === 'empty') {
    return (
      <Box padding={1} flexDirection="column">
        <Text bold color="cyan">axiom review</Text>
        <Box marginTop={1}><Text color="green">✓ No contradictions found. Wiki is consistent.</Text></Box>
        <Box marginTop={1}><Text color="gray">Press Enter to exit</Text></Box>
      </Box>
    )
  }

  // ── All resolved ───────────────────────────────────────────────────────────
  if (view === 'done') {
    return (
      <Box padding={1} flexDirection="column">
        <Text bold color="cyan">axiom review</Text>
        <Box marginTop={1}><Text color="green">✓ All contradictions resolved ({resolved} fixed).</Text></Box>
        <Box marginTop={1}><Text color="gray">Press Enter to exit</Text></Box>
      </Box>
    )
  }

  const currentPage = pages[selected]

  // ── Resolving — waiting for AI ─────────────────────────────────────────────
  if (view === 'resolving' && currentPage) {
    return (
      <Box padding={1} flexDirection="column">
        <Text bold color="cyan">Resolving: <Text color="white">{currentPage.path}</Text></Text>
        <Box marginTop={1} borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text color="yellow">{currentPage.block}</Text>
        </Box>

        {!recommendation ? (
          <Box marginTop={1}><Text color="gray">⠸ Getting AI recommendation...</Text></Box>
        ) : (
          <Box flexDirection="column">
            <Box marginTop={1} flexDirection="column">
              <Text bold>AI recommendation:</Text>
              <Box marginTop={1}>
                <Text>{recommendation.slice(0, 600)}{recommendation.length > 600 ? '...' : ''}</Text>
              </Box>
            </Box>
            <Box marginTop={1}>
              <Text bold>Apply this resolution? </Text>
              <Text color="gray">(Y/n/e=edit)</Text>
            </Box>
          </Box>
        )}
      </Box>
    )
  }

  // ── Edit custom resolution ─────────────────────────────────────────────────
  if (view === 'edit') {
    return (
      <Box padding={1} flexDirection="column">
        <Text bold>Enter custom resolution:</Text>
        <Text color="gray">(Leave empty to remove the ⚠️ block entirely)</Text>
        <Box marginTop={1}>
          <Text>{'> '}</Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={(val) => void applyResolution(val)}
          />
        </Box>
      </Box>
    )
  }

  // ── Applying ───────────────────────────────────────────────────────────────
  if (view === 'applying') {
    return (
      <Box padding={1}><Text color="gray">⠸ Applying resolution...</Text></Box>
    )
  }

  // ── List ───────────────────────────────────────────────────────────────────
  return (
    <Box padding={1} flexDirection="column">
      <Text bold color="cyan">Contradictions ({pages.length})</Text>
      {resolved > 0 && <Text color="green">{resolved} resolved this session</Text>}

      <Box marginTop={1} flexDirection="column">
        {pages.map((p, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Text color={i === selected ? 'cyan' : 'gray'}>
              {i === selected ? '▶ ' : '  '}
              <Text bold={i === selected} color={i === selected ? 'white' : undefined}>{p.path}</Text>
            </Text>
            {i === selected && (
              <Box marginLeft={4}>
                <Text color="yellow" dimColor>{p.block.slice(0, 80)}{p.block.length > 80 ? '…' : ''}</Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">↑↓ navigate   Enter resolve   q quit</Text>
      </Box>

      {statusMsg && (
        <Box marginTop={1}>
          <Text color={statusMsg.startsWith('✓') ? 'green' : 'red'}>{statusMsg}</Text>
        </Box>
      )}
    </Box>
  )
}
