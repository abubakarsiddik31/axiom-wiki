import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { getConfig } from '../../config/index.js'
import { walkProject, findProjectRoot, type ProjectSnapshot } from '../../core/mapper.js'
import {
  loadMapState, getGitChangedFiles,
  groupChangedFilesByDir, type MapState,
} from '../../core/sync.js'
import { runSync, type AutowikiBatchResult } from '../../core/autowiki.js'

interface Props {
  onExit?: () => void
}

type SyncScreenState = 'loading' | 'scanning' | 'confirming' | 'executing' | 'done' | 'error'

const SPINNER = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F']

function formatCost(cost: number | null): string {
  if (cost === null) return 'n/a'
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(3)}`
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export function SyncScreen({ onExit }: Props) {
  const config = getConfig()!
  const mountedRef = useRef(true)

  const [screenState, setScreenState] = useState<SyncScreenState>('loading')
  const [mapState, setMapState] = useState<MapState | null>(null)
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null)
  const [changedFiles, setChangedFiles] = useState<string[]>([])
  const [pagesUpdated, setPagesUpdated] = useState<string[]>([])
  const [totalCostUsd, setTotalCostUsd] = useState(0)
  const [totalInputTokens, setTotalInputTokens] = useState(0)
  const [totalOutputTokens, setTotalOutputTokens] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [spinnerTick, setSpinnerTick] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const [upToDate, setUpToDate] = useState(false)
  const [abortReason, setAbortReason] = useState('')
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

  // Loading: read map state
  useEffect(() => {
    if (screenState !== 'loading') return
    const state = loadMapState(config.wikiDir)
    if (!state) {
      setErrorMessage('No map state found. Run /autowiki first to analyze the project.')
      setScreenState('error')
      return
    }
    setMapState(state)
    setScreenState('scanning')
  }, [])

  // Scanning: walk project + git diff
  useEffect(() => {
    if (screenState !== 'scanning' || !mapState) return

    const run = async () => {
      try {
        const snap = await walkProject(projectRoot.current, (count) => {
          if (mountedRef.current) {
            setLog((prev) => {
              const last = prev[prev.length - 1]
              if (last?.startsWith('  Scanning')) return [...prev.slice(0, -1), `  Scanning... ${count} files`]
              return [...prev, `  Scanning... ${count} files`]
            })
          }
        })
        if (!mountedRef.current) return
        setSnapshot(snap)

        let changed: string[]
        if (mapState.gitCommitHash) {
          changed = getGitChangedFiles(projectRoot.current, mapState.gitCommitHash)
          setLog((prev) => [...prev, `  ${changed.length} files changed since last sync`])
        } else {
          changed = snap.files.map((f) => f.relPath)
          setLog((prev) => [...prev, `  No git history — treating all ${changed.length} files as changed`])
        }

        setChangedFiles(changed)

        if (changed.length === 0) {
          setUpToDate(true)
          setScreenState('done')
        } else {
          setScreenState('confirming')
        }
      } catch (err: unknown) {
        if (!mountedRef.current) return
        setErrorMessage(`Scan failed: ${err instanceof Error ? err.message : String(err)}`)
        setScreenState('error')
      }
    }

    void run()
  }, [screenState, mapState])

  // Execute sync
  useEffect(() => {
    if (screenState !== 'executing' || !snapshot || !mapState) return

    const run = async () => {
      try {
        const result = await runSync(
          config,
          projectRoot.current,
          snapshot,
          changedFiles,
          mapState,
          {
            maxBatches: 3,
            onBatchStart: (batch) => {
              if (mountedRef.current) setLog((prev) => [...prev, `--- Batch ${batch} ---`])
            },
            onBatchEnd: (_batch, batchResult: AutowikiBatchResult) => {
              if (!mountedRef.current) return
              for (const p of batchResult.pagesWritten) {
                setPagesUpdated((prev) => prev.includes(p) ? prev : [...prev, p])
              }
              if (batchResult.costUsd !== null) {
                setTotalCostUsd((prev) => prev + batchResult.costUsd!)
              }
              setTotalInputTokens((prev) => prev + batchResult.inputTokens)
              setTotalOutputTokens((prev) => prev + batchResult.outputTokens)
            },
            onToolCall: (toolName, args) => {
              if (!mountedRef.current) return
              const shortArgs = args.length > 80 ? args.slice(0, 80) + '...' : args
              setLog((prev) => [...prev, `  ${toolName}(${shortArgs})`].slice(-30))
            },
            onLog: (msg) => {
              if (mountedRef.current) setLog((prev) => [...prev, msg])
            },
          },
        )

        if (!mountedRef.current) return
        setTotalCostUsd(result.totalCostUsd)
        setTotalInputTokens(result.totalInputTokens)
        setTotalOutputTokens(result.totalOutputTokens)
        setPagesUpdated(result.pagesWritten)
        if (result.abortReason) setAbortReason(result.abortReason)
        setScreenState('done')
      } catch (err: unknown) {
        if (!mountedRef.current) return
        setErrorMessage(err instanceof Error ? err.message : String(err))
        setScreenState('error')
      }
    }

    void run()
  }, [screenState])

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

  if (screenState === 'loading') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="gray">{spin} Loading map state...</Text>
      </Box>
    )
  }

  if (screenState === 'scanning') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Checking for changes...</Text>
        <Box marginTop={1} flexDirection="column">
          {log.slice(-5).map((line, i) => (
            <Text key={i} color="gray">{line}</Text>
          ))}
          <Text color="gray">{spin}</Text>
        </Box>
      </Box>
    )
  }

  if (screenState === 'confirming') {
    const changedDirs = groupChangedFilesByDir(changedFiles)

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="green">Changes detected since last sync:</Text>

        <Box marginTop={1} flexDirection="column">
          <Text color="gray">  {changedFiles.length} files changed:</Text>
          {changedDirs.slice(0, 6).map((d, i) => (
            <Text key={i} color="gray">    {d.dir}/  {d.count} files</Text>
          ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text>The agent will read existing wiki pages and the changed code,</Text>
          <Text>then update stale pages and create new ones as needed.</Text>
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
        <Text bold color="cyan">Syncing wiki... <Text color="gray">({pagesUpdated.length} pages updated)</Text></Text>
        <Box marginTop={1} flexDirection="column">
          {log.slice(-10).map((line, i) => (
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
    if (upToDate) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color="green">Wiki is up to date</Text>
          <Text color="gray">No changes detected since last sync.</Text>
          <Box marginTop={1}>
            <Text color="gray">Press <Text color="white">{onExit ? 'Enter' : 'Ctrl+C'}</Text> to {onExit ? 'go back' : 'exit'}</Text>
          </Box>
        </Box>
      )
    }

    const elapsed = Date.now() - startTime.current
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={abortReason ? 'yellow' : 'green'}>
          Sync complete{abortReason ? ` (${abortReason})` : ''}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>{pagesUpdated.length} pages updated</Text>
          <Text color="gray">Tokens: in={totalInputTokens} out={totalOutputTokens}</Text>
          <Text color="gray">Total cost:  {formatCost(totalCostUsd)}</Text>
          <Text color="gray">Total time:  {formatDuration(elapsed)}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {pagesUpdated.map((p, i) => (
            <Text key={i} color="gray">  ~ {p}</Text>
          ))}
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
      <Text bold color="red">Sync failed</Text>
      <Box marginTop={1}>
        <Text color="red">{errorMessage}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Press <Text color="white">{onExit ? 'Enter' : 'Ctrl+C'}</Text> to {onExit ? 'go back' : 'exit'}</Text>
      </Box>
    </Box>
  )
}
