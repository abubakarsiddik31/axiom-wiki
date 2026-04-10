import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import path from 'path'
import fs from 'fs'
import { getConfig } from '../../config/index.js'
import { createAxiomAgent } from '../../agent/index.js'
import { INTERACTIVE_INGEST_PREFIX } from '../../agent/prompts.js'
import { getSource } from '../../core/sources.js'

const SUPPORTED_EXTS = ['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.html', '.docx']

interface Props {
  file?: string
  interactive?: boolean
}

type Status = 'running' | 'done' | 'error'
type IngestStep = 'idle' | 'interactive-reply' | 'interactive-confirm' | 'running' | 'done' | 'no-files'

interface FileResult {
  filename: string
  lines: Array<{ text: string; color?: string }>
  pagesCreated: string[]
  status: Status
}

function getIngestedFromLog(logPath: string): Set<string> {
  const ingested = new Set<string>()
  if (!fs.existsSync(logPath)) return ingested
  const log = fs.readFileSync(logPath, 'utf-8')
  for (const line of log.split('\n')) {
    const m = line.match(/^## \[\d{4}-\d{2}-\d{2}\] (?:ingest|reingest) \| (.+?)(?:\s+\(|$)/)
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

function extractPages(text: string): string[] {
  const pages: string[] = []
  // Match paths like wiki/pages/entities/foo.md or pages/concepts/bar.md
  const re = /wiki\/pages\/[\w/-]+\.md/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!pages.includes(m[0])) pages.push(m[0])
  }
  return pages
}

export function IngestScreen({ file, interactive = false }: Props) {
  const config = getConfig()

  const [step, setStep] = useState<IngestStep>('idle')
  const [interactiveResponse, setInteractiveResponse] = useState('')
  const [interactivePrompt, setInteractivePrompt] = useState('')
  const [interactiveInput, setInteractiveInput] = useState('')
  const [confirmInput, setConfirmInput] = useState('')

  const [results, setResults] = useState<FileResult[]>([])
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [streamLine, setStreamLine] = useState('')
  const [currentPages, setCurrentPages] = useState<string[]>([])
  const [isReingest, setIsReingest] = useState(false)

  // Kick off once config is available
  useEffect(() => {
    if (!config || step !== 'idle') return
    void startIngest()
  }, [config])

  async function startIngest() {
    if (!config) return
    const agent = createAxiomAgent(config)
    const { wikiDir, rawDir } = config
    const logPath = path.join(wikiDir, 'wiki/log.md')

    // Resolve file list
    let filesToProcess: string[] = []
    if (file) {
      const abs = path.resolve(file)
      if (!fs.existsSync(abs)) {
        addResult(file, [{ text: `✗ File not found: ${abs}`, color: 'red' }], [], 'error')
        setStep('done'); return
      }
      const ext = path.extname(abs).toLowerCase()
      if (!SUPPORTED_EXTS.includes(ext)) {
        addResult(file, [{ text: `✗ Unsupported file type: ${ext}`, color: 'red' }], [], 'error')
        setStep('done'); return
      }
      filesToProcess = [abs]
    } else {
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

      if (filesToProcess.length === 0) { setStep('no-files'); return }
    }

    // Process files sequentially
    for (const filepath of filesToProcess) {
      const filename = path.basename(filepath)
      setCurrentFile(filename)
      setStreamLine('')
      setCurrentPages([])

      // Detect re-ingest
      let reingest = false
      try {
        await getSource(config.wikiDir, filename)
        reingest = true
      } catch { /* no existing summary page — fresh ingest */ }
      setIsReingest(reingest)

      // Interactive mode: first pass — get topics
      if (interactive) {
        const firstGoal = `${INTERACTIVE_INGEST_PREFIX}\n\nRead this source file and present the key topics you found: ${filepath}`
        const firstResult = await agent.generate([{ role: 'user', content: firstGoal }])
        setInteractivePrompt(firstResult.text)
        setStep('interactive-reply')
        // Pause here — useInput will call continueInteractive()
        return
      }

      await runIngest(agent, filepath, filename, reingest, '')
    }

    setCurrentFile(null)
    setStep('done')
  }

  async function continueInteractive(userInput: string) {
    if (!config || !currentFile) return
    const agent = createAxiomAgent(config)
    const filepath = file ? path.resolve(file) : path.join(config.rawDir, currentFile)

    setInteractiveResponse(userInput)
    setStep('running')

    const goal = buildGoal(filepath, isReingest, userInput)
    const lines: Array<{ text: string; color?: string }> = []
    const pagesFound: string[] = []

    try {
      const stream = await agent.stream([{ role: 'user', content: goal }])
      let buffer = ''
      let allOutput = ''

      for await (const chunk of stream.textStream) {
        buffer += chunk
        allOutput += chunk
        setStreamLine(buffer.slice(-120))

        const newlineIdx = buffer.lastIndexOf('\n')
        if (newlineIdx > 0) {
          const completed = buffer.slice(0, newlineIdx).split('\n')
          buffer = buffer.slice(newlineIdx + 1)
          for (const l of completed) {
            if (l.trim()) lines.push({ text: l.trim(), color: detectColor(l) })
          }
          const newPages = extractPages(allOutput)
          setCurrentPages(newPages)
          pagesFound.splice(0, pagesFound.length, ...newPages)
        }
      }

      if (buffer.trim()) lines.push({ text: buffer.trim(), color: detectColor(buffer) })

      // Interactive confirm step
      setInteractivePrompt(`Created ${pagesFound.length} pages.\n${pagesFound.slice(0, 8).map(p => `  · ${p}`).join('\n')}`)
      setStep('interactive-confirm')
    } catch (err: unknown) {
      lines.push({ text: `✗ ${err instanceof Error ? err.message : String(err)}`, color: 'red' })
      addResult(currentFile!, lines, pagesFound, 'error')
      setCurrentFile(null)
      setStep('done')
    }
  }

  async function finaliseInteractive() {
    if (!config || !currentFile) return
    const agent = createAxiomAgent(config)

    setStep('running')
    try {
      await agent.generate([{ role: 'user', content: 'Please update the wiki index and append the log entry now.' }])
    } catch { /* best effort */ }

    addResult(currentFile, [], currentPages, 'done')
    setCurrentFile(null)
    setStep('done')
  }

  async function runIngest(
    agent: ReturnType<typeof createAxiomAgent>,
    filepath: string,
    filename: string,
    reingest: boolean,
    userContext: string,
  ) {
    const lines: Array<{ text: string; color?: string }> = []
    const pagesFound: string[] = []

    try {
      const stream = await agent.stream([{ role: 'user', content: buildGoal(filepath, reingest, userContext) }])
      let buffer = ''
      let allOutput = ''

      for await (const chunk of stream.textStream) {
        buffer += chunk
        allOutput += chunk
        setStreamLine(buffer.slice(-120))

        const newlineIdx = buffer.lastIndexOf('\n')
        if (newlineIdx > 0) {
          const completed = buffer.slice(0, newlineIdx).split('\n')
          buffer = buffer.slice(newlineIdx + 1)
          for (const l of completed) {
            if (l.trim()) lines.push({ text: l.trim(), color: detectColor(l) })
          }
          const newPages = extractPages(allOutput)
          setCurrentPages(newPages)
          pagesFound.splice(0, pagesFound.length, ...newPages)
        }
      }

      if (buffer.trim()) lines.push({ text: buffer.trim(), color: detectColor(buffer) })
      addResult(filename, lines, pagesFound, 'done')
    } catch (err: unknown) {
      lines.push({ text: `✗ ${err instanceof Error ? err.message : String(err)}`, color: 'red' })
      addResult(filename, lines, pagesFound, 'error')
    }
  }

  function buildGoal(filepath: string, reingest: boolean, userContext: string): string {
    const base = reingest
      ? `Re-ingest this source file into the wiki (diff against existing pages): ${filepath}`
      : `Ingest this source file into the wiki: ${filepath}`
    return userContext ? `${base}\n\nUser instructions: ${userContext}` : base
  }

  function addResult(filename: string, lines: FileResult['lines'], pagesCreated: string[], status: Status) {
    setResults((prev) => [...prev, { filename, lines, pagesCreated, status }])
  }

  useInput((input, key) => {
    if (step === 'interactive-reply' && key.return && interactiveInput.trim() !== undefined) {
      // handled by TextInput onSubmit
    }
    if (step === 'interactive-confirm') {
      if (input === 'y' || input === 'Y' || key.return) void finaliseInteractive()
      if (input === 'n' || input === 'N') { setCurrentFile(null); setStep('done') }
    }
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!config) {
    return (
      <Box padding={1}>
        <Text color="yellow">Not configured. Run <Text color="cyan">axiom-wiki init</Text> first.</Text>
      </Box>
    )
  }

  if (step === 'no-files') {
    return (
      <Box padding={1} flexDirection="column">
        <Text color="gray">No new files found in <Text color="cyan">{config.rawDir}</Text></Text>
        <Box marginTop={1}>
          <Text color="gray">Drop source files there, then run <Text color="cyan">axiom-wiki ingest</Text> again.</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Axiom Wiki — Ingest{interactive ? <Text color="cyan"> [interactive]</Text> : null}</Text>

      {/* Completed results */}
      {results.map((result, i) => (
        <Box key={i} flexDirection="column" marginTop={1}>
          <Text bold>
            <Text color={result.status === 'done' ? 'green' : 'red'}>
              {result.status === 'done' ? '✓' : '✗'}
            </Text>
            {' '}{result.filename}
            {result.pagesCreated.length > 0 && (
              <Text color="gray"> ({result.pagesCreated.length} pages)</Text>
            )}
          </Text>
        </Box>
      ))}

      {/* Active file */}
      {currentFile && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            {isReingest && <Text color="yellow">[RE-INGEST] </Text>}
            <Text bold>Processing: <Text color="cyan">{currentFile}</Text></Text>
          </Box>

          {/* Pages as they appear */}
          {currentPages.length > 0 && (
            <Box flexDirection="column" marginTop={1} marginLeft={2}>
              <Text color="gray">Pages written:</Text>
              {currentPages.map((p, i) => (
                <Text key={i} color="green">  ✓ {p}</Text>
              ))}
            </Box>
          )}

          {step === 'running' && streamLine && (
            <Box marginTop={1}>
              <Text color="gray" dimColor>{streamLine.slice(-100)}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Interactive: show topics, wait for user input */}
      {step === 'interactive-reply' && (
        <Box flexDirection="column" marginTop={1}>
          <Box borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="column">
            <Text color="cyan">Agent found:</Text>
            <Text>{interactivePrompt.slice(0, 400)}</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text bold>Any focus areas, things to skip, or framing to apply?</Text>
            <Text color="gray">(Press Enter to proceed with defaults)</Text>
            <Box marginTop={1}>
              <Text>{'> '}</Text>
              <TextInput
                value={interactiveInput}
                onChange={setInteractiveInput}
                onSubmit={(val) => {
                  void continueInteractive(val.trim())
                }}
              />
            </Box>
          </Box>
        </Box>
      )}

      {/* Interactive: confirm before updating index */}
      {step === 'interactive-confirm' && (
        <Box flexDirection="column" marginTop={1}>
          <Box borderStyle="single" borderColor="green" paddingX={1}>
            <Text>{interactivePrompt}</Text>
          </Box>
          <Box marginTop={1}>
            <Text bold>Anything to add or change before I update the index? </Text>
            <Text color="gray">(Enter to confirm / n to skip)</Text>
          </Box>
        </Box>
      )}

      {step === 'done' && !currentFile && (
        <Box marginTop={1}>
          <Text color="green" bold>
            ✓ Ingest complete — {results.filter(r => r.status === 'done').length} succeeded,{' '}
            {results.filter(r => r.status === 'error').length} failed
          </Text>
        </Box>
      )}

      {step === 'idle' && !currentFile && results.length === 0 && (
        <Box marginTop={1}>
          <Text color="gray">Starting...</Text>
        </Box>
      )}
    </Box>
  )
}
