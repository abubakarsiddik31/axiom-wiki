import React, { useState, useEffect } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import { getConfig } from '../../config/index.js'
import { createAxiomAgent } from '../../agent/index.js'
import { clipUrl, type ClipResult } from '../../core/clip.js'

interface Props {
  url?: string
  onExit?: () => void
}

type Step = 'input' | 'clipping' | 'confirm-ingest' | 'ingesting' | 'done' | 'error'

export function ClipScreen({ url: initialUrl, onExit }: Props) {
  const { exit } = useApp()
  const doExit = onExit ?? exit
  const config = getConfig()

  const [step, setStep] = useState<Step>(initialUrl ? 'clipping' : 'input')
  const [urlInput, setUrlInput] = useState(initialUrl ?? '')
  const [clipResult, setClipResult] = useState<ClipResult | null>(null)
  const [error, setError] = useState('')
  const [ingestLines, setIngestLines] = useState<Array<{ text: string; color?: string }>>([])
  const [ingestDone, setIngestDone] = useState(false)

  // Clip the URL once we have it
  useEffect(() => {
    if (step !== 'clipping' || !urlInput || !config) return

    const run = async () => {
      try {
        const result = await clipUrl(urlInput, config.rawDir)
        setClipResult(result)
        setStep('confirm-ingest')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setStep('error')
      }
    }
    void run()
  }, [step])

  // Ingest after confirmation
  useEffect(() => {
    if (step !== 'ingesting' || !clipResult || !config) return

    const run = async () => {
      const agent = createAxiomAgent(config)
      try {
        const stream = await agent.stream([{
          role: 'user',
          content: `Ingest this source file into the wiki: ${clipResult.filepath}`,
        }])

        let buffer = ''
        for await (const chunk of stream.textStream) {
          buffer += chunk
          const newlineIdx = buffer.lastIndexOf('\n')
          if (newlineIdx > 0) {
            const lines = buffer.slice(0, newlineIdx).split('\n').filter((l) => l.trim())
            buffer = buffer.slice(newlineIdx + 1)
            for (const l of lines) {
              setIngestLines((prev) => [...prev, { text: l, color: lineColor(l) }])
            }
          }
        }
        if (buffer.trim()) {
          setIngestLines((prev) => [...prev, { text: buffer.trim(), color: lineColor(buffer) }])
        }
        setIngestLines((prev) => [...prev, { text: '✓ Done', color: 'green' }])
      } catch (err) {
        setIngestLines((prev) => [...prev, {
          text: `✗ ${err instanceof Error ? err.message : String(err)}`,
          color: 'red',
        }])
      }
      setIngestDone(true)
    }
    void run()
  }, [step])

  useInput((input, key) => {
    if (key.escape) { doExit(); return }
    if (step === 'confirm-ingest') {
      if (input === 'y' || input === 'Y' || key.return) {
        setStep('ingesting')
      } else if (input === 'n' || input === 'N') {
        setStep('done')
      }
    }
    if ((step === 'done' || step === 'error') && (key.return || input === 'q')) {
      doExit()
    }
    if (ingestDone && (key.return || input === 'q')) {
      doExit()
    }
  })

  if (!config) {
    return (
      <Box padding={1}>
        <Text color="yellow">Not configured. Run <Text color="cyan">axiom-wiki init</Text> first.</Text>
      </Box>
    )
  }

  // ── URL input ──────────────────────────────────────────────────────────────
  if (step === 'input') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">axiom clip</Text>
        <Box marginTop={1}>
          <Text bold>Paste a URL to clip:</Text>
        </Box>
        <Box marginTop={1}>
          <Text>{'> '}</Text>
          <TextInput
            value={urlInput}
            onChange={setUrlInput}
            onSubmit={(val) => {
              if (val.trim()) {
                setUrlInput(val.trim())
                setStep('clipping')
              }
            }}
          />
        </Box>
      </Box>
    )
  }

  // ── Clipping ───────────────────────────────────────────────────────────────
  if (step === 'clipping') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">axiom clip</Text>
        <Box marginTop={1}>
          <Text color="gray">⠸ Clipping </Text>
          <Text>{urlInput}</Text>
          <Text color="gray">...</Text>
        </Box>
      </Box>
    )
  }

  // ── Confirm ingest ─────────────────────────────────────────────────────────
  if (step === 'confirm-ingest' && clipResult) {
    const sizeKb = (clipResult.sizeBytes / 1024).toFixed(1)
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">axiom clip</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="green">✓ Saved: <Text color="cyan">{clipResult.filename}</Text>
            <Text color="gray"> ({sizeKb} KB · {clipResult.type})</Text>
          </Text>
          <Text color="gray">Title: {clipResult.title}</Text>
        </Box>
        <Box marginTop={1}>
          <Text bold>Ingest now? </Text>
          <Text color="gray">(Y/n)</Text>
        </Box>
      </Box>
    )
  }

  // ── Ingesting ──────────────────────────────────────────────────────────────
  if (step === 'ingesting') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">axiom clip → ingest</Text>
        <Box marginTop={1} flexDirection="column">
          {ingestLines.map((line, i) => (
            <Text key={i} color={line.color as any}>{line.text}</Text>
          ))}
          {!ingestDone && (
            <Text color="gray">⠸ Agent working...</Text>
          )}
          {ingestDone && (
            <Box marginTop={1}>
              <Text color="gray">Press Enter to exit</Text>
            </Box>
          )}
        </Box>
      </Box>
    )
  }

  // ── Done (no ingest) ───────────────────────────────────────────────────────
  if (step === 'done' && clipResult) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green">✓ Saved to <Text color="cyan">{clipResult.filename}</Text></Text>
        <Box marginTop={1}>
          <Text color="gray">Run <Text color="cyan">axiom-wiki ingest</Text> to process it later.</Text>
        </Box>
      </Box>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (step === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">✗ Failed to clip URL:</Text>
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Try a different URL or save the file manually to <Text color="cyan">{config.rawDir}</Text></Text>
        </Box>
      </Box>
    )
  }

  return null
}

function lineColor(line: string): string | undefined {
  if (line.startsWith('✓') || line.toLowerCase().includes('created')) return 'green'
  if (line.toLowerCase().includes('updated')) return 'blue'
  if (line.includes('⚠') || line.toLowerCase().includes('contradiction')) return 'yellow'
  if (line.startsWith('✗') || line.toLowerCase().includes('error')) return 'red'
  return undefined
}
