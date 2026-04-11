import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import path from 'path'
import { getConfig } from '../../config/index.js'
import { createAxiomAgent } from '../../agent/index.js'
import { startWatcher, loadIgnorePatterns } from '../../core/watcher.js'
import { buildIngestMessage, contextLimitMessage } from '../../core/files.js'
import { updateIndex, appendLog, snapshotWiki, diffWiki } from '../../core/wiki.js'
import { getIngestedFromLog } from '../../core/sources.js'
import { calcCost, appendUsageLog } from '../../core/usage.js'
import type { FSWatcher } from 'chokidar'

interface WatchLogEntry {
  time: string
  filename: string
  status: 'ingesting' | 'done' | 'error'
  pageCount?: number
  costUsd?: number | null
  error?: string
}

function nowTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

function extractPageCount(text: string): number {
  const m = text.match(/(\d+)\s+pages?\s+(created|updated)/i)
  return m ? parseInt(m[1]!, 10) : 0
}

interface Props {
  onExit?: () => void
}

export function WatchScreen({ onExit }: Props) {
  const { exit } = useApp()
  const doExit = onExit ?? exit
  const config = getConfig()
  const [log, setLog] = useState<WatchLogEntry[]>([])
  const watcherRef = useRef<FSWatcher | null>(null)

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      watcherRef.current?.close()
      doExit()
    }
  })

  function upsertEntry(filename: string, update: Partial<WatchLogEntry>) {
    setLog((prev) => {
      let idx = -1
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i]!.filename === filename) { idx = i; break }
      }
      if (idx === -1) {
        return [...prev, { time: nowTime(), filename, status: 'ingesting' as const, ...update }].slice(-50)
      }
      const next = [...prev]
      next[idx] = { ...next[idx]!, ...update } as WatchLogEntry
      return next
    })
  }

  useEffect(() => {
    if (!config) return

    const agent = createAxiomAgent(config)
    const patterns = loadIgnorePatterns(config.rawDir)
    const logPath = path.join(config.wikiDir, 'wiki/log.md')

    const watcher = startWatcher(
      config.rawDir,
      async (filepath: string) => {
        const filename = path.basename(filepath)

        // Skip already-ingested files
        const ingested = getIngestedFromLog(logPath)
        if (ingested.has(filename)) return

        upsertEntry(filename, { status: 'ingesting', time: nowTime() })
        const before = snapshotWiki(config.wikiDir)

        try {
          const message = await buildIngestMessage(filepath, false, '', config)
          const result = await agent.generate([message])

          await updateIndex(config.wikiDir)
          await appendLog(config.wikiDir, filename, 'ingest')

          const usage = (result as any).usage ?? null
          const inputTokens: number = usage?.inputTokens ?? usage?.promptTokens ?? 0
          const outputTokens: number = usage?.outputTokens ?? usage?.completionTokens ?? 0
          const costUsd = calcCost(config.provider, config.model, inputTokens, outputTokens)

          appendUsageLog(config.wikiDir, {
            timestamp: new Date().toISOString(),
            operation: 'ingest',
            source: filename,
            provider: config.provider,
            model: config.model,
            inputTokens,
            outputTokens,
            costUsd,
          })

          const changes = diffWiki(before, config.wikiDir)
          const pageCount = changes.filter((c) => c.type === 'created').length || extractPageCount(result.text ?? '')
          upsertEntry(filename, { status: 'done', pageCount, costUsd })
        } catch (err) {
          const friendly = contextLimitMessage(err)
          upsertEntry(filename, {
            status: 'error',
            error: friendly ?? (err instanceof Error ? err.message : String(err)),
          })
        }
      },
      { ignore: patterns },
    )

    watcherRef.current = watcher
    return () => { watcher.close() }
  }, [])

  if (!config) {
    return (
      <Box padding={1}>
        <Text color="yellow">Not configured. Run <Text color="cyan">axiom-wiki init</Text> first.</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={2} paddingY={0}>
        <Text bold color="cyan">axiom watch</Text>
        <Text color="gray">Monitoring: <Text color="white">{config.rawDir}</Text></Text>
        <Text color="gray">Press <Text color="white">q</Text> to stop</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {log.length === 0 ? (
          <Text color="gray">Watching for new files...</Text>
        ) : (
          log.map((entry, i) => (
            <Box key={i} flexDirection="column">
              <Box>
                <Text color="gray">[{entry.time}] </Text>
                {entry.status === 'ingesting' && (
                  <Text color="yellow">⠸ Ingesting <Text color="cyan">{entry.filename}</Text>…</Text>
                )}
                {entry.status === 'done' && (
                  <Text color="green">✓ <Text color="cyan">{entry.filename}</Text>
                    {entry.pageCount ? ` → ${entry.pageCount} pages` : ' → done'}
                    {entry.costUsd != null ? <Text color="gray"> ${entry.costUsd.toFixed(4)}</Text> : null}
                  </Text>
                )}
                {entry.status === 'error' && (
                  <Text color="red">✗ <Text color="cyan">{entry.filename}</Text></Text>
                )}
              </Box>
              {entry.status === 'error' && entry.error && (
                <Text color="red" dimColor>  {entry.error}</Text>
              )}
            </Box>
          ))
        )}
      </Box>

      {log.some((e) => e.status !== 'ingesting') && (
        <Box marginTop={1}>
          <Text color="gray">Watching for new files...</Text>
        </Box>
      )}
    </Box>
  )
}
