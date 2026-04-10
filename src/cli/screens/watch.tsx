import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import path from 'path'
import { getConfig } from '../../config/index.js'
import { createAxiomAgent } from '../../agent/index.js'
import { startWatcher, loadIgnorePatterns } from '../../core/watcher.js'
import type { FSWatcher } from 'chokidar'

interface WatchLogEntry {
  time: string
  filename: string
  status: 'detected' | 'ingesting' | 'done' | 'error'
  pageCount?: number
  error?: string
}

function nowTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

function extractPageCount(output: string): number {
  const m = output.match(/(\d+)\s+pages?\s+(created|updated)/i)
  return m ? parseInt(m[1]!, 10) : 0
}

export function WatchScreen() {
  const { exit } = useApp()
  const config = getConfig()
  const [log, setLog] = useState<WatchLogEntry[]>([])
  const watcherRef = useRef<FSWatcher | null>(null)

  useInput((input) => {
    if (input === 'q') {
      watcherRef.current?.close()
      exit()
    }
  })

  function upsertEntry(filename: string, update: Partial<WatchLogEntry>) {
    setLog((prev) => {
      let idx = -1
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i]!.filename === filename) { idx = i; break }
      }
      if (idx === -1) {
        const entry: WatchLogEntry = { time: nowTime(), filename, status: 'detected', ...update }
        return [...prev, entry].slice(-50)
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

    const watcher = startWatcher(
      config.rawDir,
      async (filepath: string) => {
        const filename = path.basename(filepath)
        upsertEntry(filename, { status: 'ingesting', time: nowTime() })

        let output = ''
        try {
          const stream = await agent.stream([{
            role: 'user',
            content: `Ingest this source file into the wiki: ${filepath}`,
          }])
          for await (const chunk of stream.textStream) {
            output += chunk
          }
          const pageCount = extractPageCount(output)
          upsertEntry(filename, { status: 'done', pageCount })
        } catch (err) {
          upsertEntry(filename, { status: 'error', error: err instanceof Error ? err.message : String(err) })
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
            <Box key={i}>
              <Text color="gray">[{entry.time}] </Text>
              {entry.status === 'detected' && (
                <Text>Detected: <Text color="cyan">{entry.filename}</Text></Text>
              )}
              {entry.status === 'ingesting' && (
                <Text color="yellow">⠸ Ingesting <Text color="cyan">{entry.filename}</Text>...</Text>
              )}
              {entry.status === 'done' && (
                <Text color="green">✓ <Text color="cyan">{entry.filename}</Text>
                  {entry.pageCount ? ` → ${entry.pageCount} pages` : ' → done'}
                </Text>
              )}
              {entry.status === 'error' && (
                <Text color="red">✗ <Text color="cyan">{entry.filename}</Text>: {entry.error}</Text>
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
