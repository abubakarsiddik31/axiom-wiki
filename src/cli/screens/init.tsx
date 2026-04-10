import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import SelectInput from 'ink-select-input'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { setConfig, clearConfig } from '../../config/index.js'
import { PROVIDERS, listProviders, type ProviderId } from '../../config/models.js'
import { scaffoldWiki } from '../../core/wiki.js'
import { createAxiomAgent } from '../../agent/index.js'
import { readSourceFile } from '../../core/files.js'

// Steps: 0=welcome 1=provider 2=apiKey(or ollamaUrl) 3=model 4=wikiDir 5=rawDir 6=scaffold 7=done
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

const SUPPORTED_EXTS = ['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.html', '.docx']

function expandTilde(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  if (p === '~') return os.homedir()
  return p
}

export function InitScreen() {
  const [step, setStep] = useState<Step>(0)
  const [provider, setProvider] = useState<ProviderId | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')
  const [ollamaError, setOllamaError] = useState('')
  const [model, setModel] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [wikiDir, setWikiDir] = useState(path.join(os.homedir(), 'my-wiki'))
  const [rawDir, setRawDir] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [done, setDone] = useState(false)

  // Set rawDir default whenever wikiDir changes
  useEffect(() => {
    if (step < 5) setRawDir(path.join(expandTilde(wikiDir), 'raw'))
  }, [wikiDir, step])

  // Step 0: welcome — press Enter to proceed
  useInput((_, key) => {
    if (step === 0 && key.return) setStep(1)
  })

  // Step 6: scaffold + ingest
  useEffect(() => {
    if (step !== 6) return

    const run = async () => {
      try {
        const expandedWiki = expandTilde(wikiDir)
        const expandedRaw = expandTilde(rawDir)

        clearConfig()
        const finalModel = model === '__custom__' ? customModel.trim() : model
        const configToSave = provider === 'ollama'
          ? { provider: provider!, apiKey: '', model: finalModel, wikiDir: expandedWiki, rawDir: expandedRaw, ollamaBaseUrl: ollamaUrl.trim() + '/api' }
          : { provider: provider!, apiKey, model: finalModel, wikiDir: expandedWiki, rawDir: expandedRaw }
        setConfig(configToSave)
        addLog('✓ Config saved')

        await scaffoldWiki(expandedWiki)
        addLog('✓ Wiki structure created')

        // Ingest existing raw files
        const rawFiles = fs.existsSync(expandedRaw)
          ? fs.readdirSync(expandedRaw).filter((f: string) => {
              const ext = path.extname(f).toLowerCase()
              return SUPPORTED_EXTS.includes(ext) && fs.statSync(path.join(expandedRaw, f)).isFile()
            })
          : []

        if (rawFiles.length > 0) {
          addLog(`⠸ Processing ${rawFiles.length} existing file(s) in raw/...`)
          const config = { provider: provider!, apiKey, model, wikiDir: expandedWiki, rawDir: expandedRaw }
          const agent = createAxiomAgent(config)

          for (const file of rawFiles) {
            const filepath = path.join(expandedRaw, file)
            addLog(`  → ingesting ${file}`)
            try {
              await agent.generate([{
                role: 'user',
                content: `Ingest this source file into the wiki: ${filepath}`,
              }])
            } catch {
              addLog(`  ⚠ Failed to ingest ${file}`)
            }
          }
        }

        addLog('✓ Done')
        setDone(true)
        setStep(7)
      } catch (err: unknown) {
        addLog(`✗ Error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    void run()
  }, [step])

  function addLog(line: string) {
    setLog((prev) => [...prev, line])
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (step === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box flexDirection="column" borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1}>
          <Text bold color="cyan">Axiom Wiki</Text>
          <Text color="gray">The wiki that maintains itself.</Text>
        </Box>
        <Box marginTop={1}>
          <Text>Let's set up your wiki. This takes about 2 minutes.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Press Enter to continue →</Text>
        </Box>
      </Box>
    )
  }

  if (step === 1) {
    const items = listProviders().map((p) => ({
      label: `${p.label}`,
      value: p.id,
    }))
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Choose your LLM provider:</Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              setProvider(item.value as ProviderId)
              setModel(PROVIDERS[item.value as ProviderId].models.find((m) => m.recommended)?.id ?? PROVIDERS[item.value as ProviderId].models[0]!.id)
              setStep(2)
            }}
          />
        </Box>
      </Box>
    )
  }

  if (step === 2) {
    const prov = PROVIDERS[provider!]

    // Ollama: show base URL input + connectivity check
    if (provider === 'ollama') {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold>Ollama base URL:</Text>
          <Text color="gray">(Press Enter for default: http://localhost:11434)</Text>
          <Box marginTop={1}>
            <Text>{'> '}</Text>
            <TextInput
              value={ollamaUrl}
              onChange={(v) => { setOllamaUrl(v); setOllamaError('') }}
              onSubmit={async (val) => {
                const url = (val.trim() || 'http://localhost:11434').replace(/\/+$/, '')
                setOllamaUrl(url)
                setOllamaError('')
                try {
                  const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) })
                  if (!res.ok) throw new Error(`HTTP ${res.status}`)
                  setStep(3)
                } catch {
                  setOllamaError(`Could not connect to Ollama at ${url}\nIs Ollama running? Try: ollama serve`)
                }
              }}
            />
          </Box>
          {ollamaError && (
            <Box marginTop={1} flexDirection="column">
              <Text color="red">✗ {ollamaError}</Text>
              <Text color="gray">Press Enter to retry, or go back with Ctrl+C.</Text>
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>{prov.keyLabel}</Text>
        <Text color="gray">(from {prov.keyUrl})</Text>
        <Box marginTop={1}>
          <Text>{'> '}</Text>
          <TextInput
            value={apiKey}
            onChange={setApiKey}
            mask="•"
            onSubmit={(val) => {
              if (val.trim()) setStep(3)
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Press Enter to continue</Text>
        </Box>
      </Box>
    )
  }

  if (step === 3) {
    const models = [
      ...PROVIDERS[provider!].models.map((m) => ({
        label: `${m.label}  ${m.desc}`,
        value: m.id,
      })),
      { label: '[ Enter custom model name ]', value: '__custom__' },
    ]

    if (model === '__custom__') {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold>Enter model name:</Text>
          <Box marginTop={1}>
            <Text>{'> '}</Text>
            <TextInput
              value={customModel}
              onChange={setCustomModel}
              onSubmit={(val) => { if (val.trim()) setStep(4) }}
            />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Choose a model:</Text>
        <Box marginTop={1}>
          <SelectInput
            items={models}
            onSelect={(item) => {
              setModel(item.value)
              if (item.value !== '__custom__') setStep(4)
            }}
          />
        </Box>
      </Box>
    )
  }

  if (step === 4) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Wiki directory:</Text>
        <Box marginTop={1}>
          <Text>{'> '}</Text>
          <TextInput
            value={wikiDir}
            onChange={setWikiDir}
            onSubmit={(val) => {
              if (val.trim()) {
                setWikiDir(val.trim())
                setStep(5)
              }
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text color="gray">This is where your wiki pages will be stored.</Text>
        </Box>
      </Box>
    )
  }

  if (step === 5) {
    const defaultRaw = path.join(expandTilde(wikiDir), 'raw')
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Raw sources folder:</Text>
        <Box marginTop={1}>
          <Text>{'> '}</Text>
          <TextInput
            value={rawDir || defaultRaw}
            onChange={setRawDir}
            onSubmit={(val) => {
              setRawDir(val.trim() || defaultRaw)
              setStep(6)
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Drop your source files here (PDFs, markdown, etc.)</Text>
        </Box>
      </Box>
    )
  }

  if (step === 6) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Setting up your wiki...</Text>
        <Box marginTop={1} flexDirection="column">
          {log.map((line, i) => (
            <Text key={i} color={line.startsWith('✓') ? 'green' : line.startsWith('✗') ? 'red' : line.startsWith('⚠') ? 'yellow' : 'white'}>
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    )
  }

  // step === 7: success
  const expandedWiki = expandTilde(wikiDir)
  const expandedRaw = expandTilde(rawDir)
  const mcpConfig = JSON.stringify({ 'axiom-wiki': { command: 'axiom-wiki', args: ['mcp'] } }, null, 2)

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">✓ Axiom Wiki is ready!</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Your wiki:    <Text color="cyan">{expandedWiki}/wiki/</Text></Text>
        <Text>Raw sources:  <Text color="cyan">{expandedRaw}/</Text></Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Add to Claude Code MCP config (.claude/mcp_settings.json):</Text>
        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="yellow">{mcpConfig}</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Run <Text color="cyan">axiom-wiki --help</Text> to see all commands.</Text>
      </Box>
    </Box>
  )
}
