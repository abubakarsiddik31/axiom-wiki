import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import path from 'path'
import fs from 'fs'
import { getConfig } from '../../config/index.js'
import { createAxiomAgent } from '../../agent/index.js'

const SUPPORTED_EXTS = ['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.html', '.docx']

interface Props {
  file?: string
}

type Status = 'running' | 'done' | 'error'

interface FileResult {
  filename: string
  lines: Array<{ text: string; color?: string }>
  status: Status
}

function getIngestedFromLog(logPath: string): Set<string> {
  const ingested = new Set<string>()
  if (!fs.existsSync(logPath)) return ingested
  const log = fs.readFileSync(logPath, 'utf-8')
  for (const line of log.split('\n')) {
    const m = line.match(/^## \[\d{4}-\d{2}-\d{2}\] ingest \| (.+)$/)
    if (m?.[1]) ingested.add(m[1].trim())
  }
  return ingested
}

function detectColor(line: string): string | undefined {
  if (line.startsWith('✓') || line.toLowerCase().includes('created')) return 'green'
  if (line.toLowerCase().includes('updated')) return 'blue'
  if (line.includes('⚠') || line.toLowerCase().includes('contradiction')) return 'yellow'
  if (line.startsWith('✗') || line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) return 'red'
  return undefined
}

export function IngestScreen({ file }: Props) {
  const [results, setResults] = useState<FileResult[]>([])
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [streamLine, setStreamLine] = useState('')
  const [finalStatus, setFinalStatus] = useState<'idle' | 'done' | 'no-files'>('idle')

  const config = getConfig()

  useEffect(() => {
    if (!config) return

    const run = async () => {
      const agent = createAxiomAgent(config)
      const { wikiDir, rawDir } = config
      const logPath = path.join(wikiDir, 'wiki/log.md')

      let filesToProcess: string[] = []

      if (file) {
        // Single file mode
        const abs = path.resolve(file)
        if (!fs.existsSync(abs)) {
          addResult(file, [{ text: `✗ File not found: ${abs}`, color: 'red' }], 'error')
          setFinalStatus('done')
          return
        }
        const ext = path.extname(abs).toLowerCase()
        if (!SUPPORTED_EXTS.includes(ext)) {
          addResult(file, [{ text: `✗ Unsupported file type: ${ext}`, color: 'red' }], 'error')
          setFinalStatus('done')
          return
        }
        filesToProcess = [abs]
      } else {
        // Batch mode — scan raw/ for unprocessed files
        const ingested = getIngestedFromLog(logPath)
        const allRaw = fs.existsSync(rawDir)
          ? fs.readdirSync(rawDir).filter((f: string) => {
              const ext = path.extname(f).toLowerCase()
              return SUPPORTED_EXTS.includes(ext) && fs.statSync(path.join(rawDir, f)).isFile()
            })
          : []
        filesToProcess = allRaw
          .filter((f: string) => !ingested.has(f))
          .map((f: string) => path.join(rawDir, f))

        if (filesToProcess.length === 0) {
          setFinalStatus('no-files')
          return
        }
      }

      // Process files sequentially
      for (const filepath of filesToProcess) {
        const filename = path.basename(filepath)
        setCurrentFile(filename)
        setStreamLine('')

        const lines: Array<{ text: string; color?: string }> = []

        try {
          const stream = await agent.stream([{
            role: 'user',
            content: `Ingest this source file into the wiki: ${filepath}`,
          }])

          let buffer = ''
          for await (const chunk of stream.textStream) {
            buffer += chunk
            setStreamLine(buffer.slice(-120))

            // Extract completed lines from buffer
            const newlineIdx = buffer.lastIndexOf('\n')
            if (newlineIdx > 0) {
              const completed = buffer.slice(0, newlineIdx).split('\n')
              buffer = buffer.slice(newlineIdx + 1)
              for (const l of completed) {
                if (l.trim()) {
                  lines.push({ text: l.trim(), color: detectColor(l) })
                }
              }
            }
          }

          if (buffer.trim()) lines.push({ text: buffer.trim(), color: detectColor(buffer) })
          lines.push({ text: '✓ Done', color: 'green' })
          addResult(filename, lines, 'done')
        } catch (err: unknown) {
          lines.push({ text: `✗ ${err instanceof Error ? err.message : String(err)}`, color: 'red' })
          addResult(filename, lines, 'error')
        }

        setCurrentFile(null)
        setStreamLine('')
      }

      setFinalStatus('done')
    }

    void run()
  }, [])

  function addResult(filename: string, lines: FileResult['lines'], status: Status) {
    setResults((prev) => [...prev, { filename, lines, status }])
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!config) {
    return (
      <Box padding={1}>
        <Text color="yellow">Not configured. Run <Text color="cyan">axiom-wiki init</Text> first.</Text>
      </Box>
    )
  }

  if (finalStatus === 'no-files') {
    return (
      <Box padding={1}>
        <Text color="gray">No new files found in <Text color="cyan">{config.rawDir}</Text></Text>
        <Box marginTop={1}>
          <Text color="gray">Drop source files there, then run <Text color="cyan">axiom-wiki ingest</Text> again.</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Axiom Wiki — Ingest</Text>

      {results.map((result, i) => (
        <Box key={i} flexDirection="column" marginTop={1}>
          <Text bold>Processing: <Text color="cyan">{result.filename}</Text></Text>
          <Box marginTop={1} flexDirection="column">
            {result.lines.map((line, j) => (
              <Text key={j} color={line.color as any}>{line.text}</Text>
            ))}
          </Box>
        </Box>
      ))}

      {currentFile && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Processing: <Text color="cyan">{currentFile}</Text></Text>
          <Box marginTop={1}>
            <Text color="gray">⠸ Agent thinking...</Text>
          </Box>
          {streamLine ? (
            <Box marginTop={1}>
              <Text color="gray" dimColor>{streamLine}</Text>
            </Box>
          ) : null}
        </Box>
      )}

      {finalStatus === 'done' && !currentFile && (
        <Box marginTop={1}>
          <Text color="green" bold>
            ✓ Ingest complete — {results.filter(r => r.status === 'done').length} succeeded,{' '}
            {results.filter(r => r.status === 'error').length} failed
          </Text>
        </Box>
      )}

      {finalStatus === 'idle' && !currentFile && results.length === 0 && (
        <Box marginTop={1}>
          <Text color="gray">Starting...</Text>
        </Box>
      )}
    </Box>
  )
}
