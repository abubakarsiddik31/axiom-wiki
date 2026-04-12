import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { getConfig } from '../../config/index.js'
import { walkProject, findProjectRoot, topLanguages, type ProjectSnapshot } from '../../core/mapper.js'
import { runAutowiki, type AutowikiBatchResult } from '../../core/autowiki.js'

interface Props {
  onExit?: () => void
}

type MapScreenState = 'walking' | 'confirming' | 'executing' | 'done' | 'error'

const SPINNER = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F']

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatCost(cost: number | null): string {
  if (cost === null) return 'n/a'
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(3)}`
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export function MapScreen({ onExit }: Props) {
  const config = getConfig()!
  const mountedRef = useRef(true)

  const [screenState, setScreenState] = useState<MapScreenState>('walking')
  const [fileCount, setFileCount] = useState(0)
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null)
  const [currentBatch, setCurrentBatch] = useState(0)
  const [pagesCreated, setPagesCreated] = useState<string[]>([])
  const [totalCostUsd, setTotalCostUsd] = useState(0)
  const [totalInputTokens, setTotalInputTokens] = useState(0)
  const [totalOutputTokens, setTotalOutputTokens] = useState(0)
  const [totalBatches, setTotalBatches] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [abortReason, setAbortReason] = useState('')
  const [spinnerTick, setSpinnerTick] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const startTime = useRef(Date.now())
  const projectRoot = useRef(findProjectRoot())

  const spin = SPINNER[spinnerTick % SPINNER.length]!

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const id = setInterval(() => setSpinnerTick((t) => t + 1), 100)
    return () => clearInterval(id)
  }, [])

  // Walk project
  useEffect(() => {
    if (screenState !== 'walking') return
    walkProject(projectRoot.current, (count) => {
      if (mountedRef.current) setFileCount(count)
    })
      .then((snap) => {
        if (!mountedRef.current) return
        setSnapshot(snap)
        setFileCount(snap.totalFiles)
        setScreenState('confirming')
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return
        setErrorMessage(`Walk failed: ${err instanceof Error ? err.message : String(err)}`)
        setScreenState('error')
      })
  }, [])

  // Execute autowiki
  useEffect(() => {
    if (screenState !== 'executing' || !snapshot) return

    const run = async () => {
      try {
        const result = await runAutowiki(config, projectRoot.current, snapshot, {
          maxBatches: 10,
          maxCostUsd: 5.0,
          onBatchStart: (batch) => {
            if (mountedRef.current) {
              setCurrentBatch(batch)
              setLog((prev) => [...prev, `--- Batch ${batch} ---`])
            }
          },
          onBatchEnd: (_batch, batchResult: AutowikiBatchResult) => {
            if (!mountedRef.current) return
            for (const p of batchResult.pagesWritten) {
              setPagesCreated((prev) => prev.includes(p) ? prev : [...prev, p])
            }
            if (batchResult.costUsd !== null) {
              setTotalCostUsd((prev) => prev + batchResult.costUsd!)
            }
            setTotalInputTokens((prev) => prev + batchResult.inputTokens)
            setTotalOutputTokens((prev) => prev + batchResult.outputTokens)
            if (batchResult.error) {
              setLog((prev) => [...prev, `  error: ${batchResult.error}`])
            }
          },
          onToolCall: (toolName, args) => {
            if (!mountedRef.current) return
            const shortArgs = args.length > 80 ? args.slice(0, 80) + '...' : args
            setLog((prev) => [...prev, `  ${toolName}(${shortArgs})`].slice(-30))
          },
          onLog: (msg) => {
            if (mountedRef.current) setLog((prev) => [...prev, msg])
          },
        })

        if (!mountedRef.current) return
        setTotalBatches(result.batches)
        setTotalCostUsd(result.totalCostUsd)
        setTotalInputTokens(result.totalInputTokens)
        setTotalOutputTokens(result.totalOutputTokens)
        setPagesCreated(result.pagesWritten)
        if (result.abortReason) setAbortReason(result.abortReason)
        setScreenState('done')
      } catch (err: unknown) {
        if (!mountedRef.current) return
        setErrorMessage(err instanceof Error ? err.message : String(err))
        setScreenState('error')
      }
    }

    void run()
  }, [screenState, snapshot])

  useInput((_, key) => {
    if (screenState === 'confirming' && key.return) {
      setScreenState('executing')
    }
    if (screenState === 'done' && onExit && key.return) {
      onExit()
    }
    if (screenState === 'error' && onExit && key.return) {
      onExit()
    }
  })

  // ── Render ────────────────────────────────────────────────────────────────

  if (!config) {
    return <Box padding={1}><Text color="red">No config found. Run axiom-wiki init first.</Text></Box>
  }

  if (screenState === 'walking') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Scanning project...</Text>
        <Box marginTop={1}>
          <Text color="gray">{spin} Scanning {projectRoot.current}</Text>
        </Box>
        {fileCount > 0 && (
          <Text color="gray">  {fileCount} files found</Text>
        )}
      </Box>
    )
  }

  if (screenState === 'confirming' && snapshot) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="green">Project scanned</Text>

        <Box marginTop={1} flexDirection="column">
          <Text color="gray">  {snapshot.totalFiles} files · {formatSize(snapshot.totalSizeBytes)} · ~{snapshot.totalWords.toLocaleString()} words</Text>
          <Text color="gray">  {topLanguages(snapshot.languages)}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text>The agent will explore this codebase and build a wiki autonomously.</Text>
          <Text color="gray">It will survey the project structure, read key files, and create</Text>
          <Text color="gray">wiki pages in batches (up to 10 batches, max $5.00).</Text>
        </Box>

        <Box marginTop={1}>
          <Text color="gray">Press <Text color="white">Enter</Text> to proceed · Ctrl+C to cancel</Text>
        </Box>
      </Box>
    )
  }

  if (screenState === 'executing') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Building wiki... <Text color="gray">(batch {currentBatch}, {pagesCreated.length} pages)</Text></Text>
        <Box marginTop={1} flexDirection="column">
          {log.slice(-12).map((line, i) => (
            <Text key={i} color={
              line.startsWith('---') ? 'cyan'
              : line.startsWith('  write_page') ? 'green'
              : line.startsWith('  error') ? 'red'
              : 'gray'
            } dimColor={!line.startsWith('---')}>
              {line}
            </Text>
          ))}
          <Text color="gray">{spin}</Text>
        </Box>
        {totalCostUsd > 0 && (
          <Text color="gray">Cost so far: {formatCost(totalCostUsd)}</Text>
        )}
      </Box>
    )
  }

  if (screenState === 'done') {
    const elapsed = Date.now() - startTime.current
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={abortReason ? 'yellow' : 'green'}>
          Wiki complete{abortReason ? ` (stopped: ${abortReason})` : ''}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>{pagesCreated.length} pages created in {totalBatches} batch{totalBatches !== 1 ? 'es' : ''}</Text>
          <Text color="gray">Tokens: in={totalInputTokens} out={totalOutputTokens}</Text>
          <Text color="gray">Total cost:  {formatCost(totalCostUsd)}</Text>
          <Text color="gray">Total time:  {formatDuration(elapsed)}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {pagesCreated.map((p, i) => (
            <Text key={i} color="green">  + {p}</Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Start with: <Text color="cyan">axiom-wiki query "how does this codebase work?"</Text></Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Press <Text color="white">{onExit ? 'Enter' : 'Ctrl+C'}</Text> to {onExit ? 'go back' : 'exit'}</Text>
        </Box>
      </Box>
    )
  }

  // error
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="red">Autowiki failed</Text>
      <Box marginTop={1}>
        <Text color="red">{errorMessage}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Press <Text color="white">{onExit ? 'Enter' : 'Ctrl+C'}</Text> to {onExit ? 'go back' : 'exit'}</Text>
      </Box>
    </Box>
  )
}
