import React, { useState, useEffect } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import { getConfig } from '../../config/index.js'
import { createAxiomAgent } from '../../agent/index.js'
import { clipUrl, type ClipResult } from '../../core/clip.js'
import { buildIngestMessage, contextLimitMessage } from '../../core/files.js'
import { updateIndex, appendLog, snapshotWiki, diffWiki } from '../../core/wiki.js'
import { calcCost, appendUsageLog } from '../../core/usage.js'
import { loadState, saveState, recordIngest } from '../../core/state.js'
import { acquireLock, releaseLock } from '../../core/lock.js'

interface Props {
  url?: string
  onExit?: () => void
}

type Step = 'input' | 'clipping' | 'confirm-ingest' | 'ingesting' | 'done' | 'error'

interface IngestState {
  liveLines: Array<{ text: string; color?: string }>
  changes: Array<{ path: string; type: 'created' | 'modified' }>
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null } | null
  done: boolean
  error: string | null
}

export function ClipScreen({ url: initialUrl, onExit }: Props) {
  const { exit } = useApp()
  const doExit = onExit ?? exit
  const config = getConfig()

  const [step, setStep] = useState<Step>(initialUrl ? 'clipping' : 'input')
  const [urlInput, setUrlInput] = useState(initialUrl ?? '')
  const [clipResult, setClipResult] = useState<ClipResult | null>(null)
  const [clipError, setClipError] = useState('')
  const [spinnerTick, setSpinnerTick] = useState(0)
  const [ingest, setIngest] = useState<IngestState>({
    liveLines: [],
    changes: [],
    usage: null,
    done: false,
    error: null,
  })
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

  useEffect(() => {
    if (step !== 'ingesting') return
    const id = setInterval(() => setSpinnerTick((t) => t + 1), 100)
    return () => clearInterval(id)
  }, [step])

  // Clip the URL once we have it
  useEffect(() => {
    if (step !== 'clipping' || !urlInput || !config) return
    void (async () => {
      try {
        const result = await clipUrl(urlInput, config.rawDir)
        setClipResult(result)
        setStep('confirm-ingest')
      } catch (err) {
        setClipError(err instanceof Error ? err.message : String(err))
        setStep('error')
      }
    })()
  }, [step])

  // Ingest after confirmation
  useEffect(() => {
    if (step !== 'ingesting' || !clipResult || !config) return
    void (async () => {
      // Acquire compilation lock
      if (!acquireLock(config.wikiDir)) {
        setIngest({ liveLines: [], changes: [], usage: null, done: true, error: 'Another ingest is running. Try again later.' })
        return
      }

      const agent = createAxiomAgent(config)
      const before = snapshotWiki(config.wikiDir)
      const lines: Array<{ text: string; color?: string }> = []

      const pushLine = (entry: { text: string; color?: string }) => {
        lines.push(entry)
        setIngest((prev) => ({ ...prev, liveLines: [...prev.liveLines, entry].slice(-20) }))
      }

      try {
        const message = await buildIngestMessage(clipResult.filepath, false, '', config)
        const result = await agent.generate([message], {
          onStepFinish: (s: any) => {
            try {
              for (const call of s.toolCalls ?? []) {
                const toolName = call.toolName ?? call.payload?.toolName ?? 'tool'
                const args = JSON.stringify(call.args ?? call.payload?.args ?? {})
                pushLine({
                  text: `⚙ ${toolName}(${args.slice(0, 80)}${args.length > 80 ? '…' : ''})`,
                  color: 'yellow',
                })
              }
              for (const res of s.toolResults ?? []) {
                const r = res.result ?? res.payload?.result
                if (r && typeof r === 'string' && r.length < 120) {
                  pushLine({ text: `  → ${r}`, color: 'gray' })
                }
              }
            } catch { /* never crash the agent loop */ }
          },
        })

        await updateIndex(config.wikiDir)
        await appendLog(config.wikiDir, clipResult.filename, 'ingest')

        // Record source state for incremental compilation
        const pageRe = /wiki\/pages\/[\w/-]+\.md/g
        const pagesFound: string[] = []
        let pm: RegExpExecArray | null
        while ((pm = pageRe.exec(result.text ?? '')) !== null) {
          if (!pagesFound.includes(pm[0])) pagesFound.push(pm[0])
        }
        const state = loadState(config.wikiDir)
        recordIngest(state, clipResult.filename, clipResult.filepath, pagesFound)
        saveState(config.wikiDir, state)

        const usage = (result as any).usage ?? null
        const inputTokens: number = usage?.inputTokens ?? usage?.promptTokens ?? 0
        const outputTokens: number = usage?.outputTokens ?? usage?.completionTokens ?? 0
        const costUsd = calcCost(config.provider, config.model, inputTokens, outputTokens)

        appendUsageLog(config.wikiDir, {
          timestamp: new Date().toISOString(),
          operation: 'ingest',
          source: clipResult.filename,
          provider: config.provider,
          model: config.model,
          inputTokens,
          outputTokens,
          costUsd,
        })

        const changes = diffWiki(before, config.wikiDir)
        releaseLock(config.wikiDir)
        setIngest({ liveLines: lines, changes, usage: { inputTokens, outputTokens, costUsd }, done: true, error: null })
      } catch (err) {
        const friendly = contextLimitMessage(err)
        const changes = diffWiki(before, config.wikiDir)
        releaseLock(config.wikiDir)
        setIngest({
          liveLines: lines,
          changes,
          usage: null,
          done: true,
          error: friendly ?? (err instanceof Error ? err.message : String(err)),
        })
      }
    })()
  }, [step])

  useInput((input, key) => {
    if (key.escape) { doExit(); return }
    if (step === 'confirm-ingest') {
      if (input === 'y' || input === 'Y' || key.return) setStep('ingesting')
      else if (input === 'n' || input === 'N') setStep('done')
    }
    if ((step === 'done' || step === 'error') && (key.return || input === 'q')) doExit()
    if (step === 'ingesting' && ingest.done && (key.return || input === 'q')) doExit()
  })

  if (!config) {
    return (
      <Box padding={1}>
        <Text color="yellow">Not configured. Run <Text color="cyan">axiom-wiki init</Text> first.</Text>
      </Box>
    )
  }

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
            onSubmit={(val) => { if (val.trim()) { setUrlInput(val.trim()); setStep('clipping') } }}
          />
        </Box>
      </Box>
    )
  }

  if (step === 'clipping') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">axiom clip</Text>
        <Box marginTop={1}>
          <Text color="gray">⠸ Clipping </Text><Text>{urlInput}</Text><Text color="gray">…</Text>
        </Box>
      </Box>
    )
  }

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
          <Text bold>Ingest now? </Text><Text color="gray">(Y/n)</Text>
        </Box>
      </Box>
    )
  }

  if (step === 'ingesting') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">axiom clip → ingest</Text>
        {clipResult && (
          <Box marginTop={1}>
            <Text bold color="cyan">{clipResult.filename}</Text>
          </Box>
        )}

        {/* Spinner + live tool calls */}
        {!ingest.done && (
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            {ingest.liveLines.length === 0 && (
              <Text color="yellow">{spinnerFrames[spinnerTick % spinnerFrames.length]} Calling LLM…</Text>
            )}
            {ingest.liveLines.length > 0 && (
              <Text color="gray" dimColor>{spinnerFrames[spinnerTick % spinnerFrames.length]} working…</Text>
            )}
            {ingest.liveLines.slice(-16).map((line, i) => (
              <Text key={i} color={(line.color as any) ?? 'gray'} dimColor={!line.color}>{line.text}</Text>
            ))}
          </Box>
        )}

        {/* Result */}
        {ingest.done && (
          <Box flexDirection="column" marginTop={1}>
            {ingest.error ? (
              <Text color="red">✗ {ingest.error}</Text>
            ) : (
              <Text color="green" bold>✓ Ingested</Text>
            )}

            {ingest.usage && (
              <Text color="gray" dimColor>
                {' '}in={ingest.usage.inputTokens} out={ingest.usage.outputTokens}
                {ingest.usage.costUsd !== null ? `  $${ingest.usage.costUsd.toFixed(4)}` : ''}
              </Text>
            )}

            {ingest.changes.length > 0 && (
              <Box flexDirection="column" marginLeft={2} marginTop={1}>
                {ingest.changes.map((c, i) => (
                  <Text key={i} color={c.type === 'created' ? 'green' : 'blue'}>
                    {c.type === 'created' ? '+ ' : '~ '}{c.path}
                  </Text>
                ))}
              </Box>
            )}

            <Box marginTop={1}>
              <Text color="gray">Press Enter to exit</Text>
            </Box>
          </Box>
        )}
      </Box>
    )
  }

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

  if (step === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">✗ Failed to clip URL:</Text>
        <Box marginTop={1}><Text color="red">{clipError}</Text></Box>
        <Box marginTop={1}>
          <Text color="gray">Try a different URL or save the file manually to <Text color="cyan">{config.rawDir}</Text></Text>
        </Box>
      </Box>
    )
  }

  return null
}
