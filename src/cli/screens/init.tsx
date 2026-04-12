import React, { useState, useEffect } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import SelectInput from 'ink-select-input'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { setConfig, clearConfig, setLocalConfig, findLocalConfig, type ConfigScope } from '../../config/index.js'
import { PROVIDERS, listProviders, type ProviderId } from '../../config/models.js'
import { scaffoldWiki } from '../../core/wiki.js'
import { createAxiomAgent } from '../../agent/index.js'

// Steps: 0=welcome 1=scope 2=provider 3=apiKey(or ollamaUrl) 4=model 5=wikiDir 6=rawDir 7=scaffold 8=done
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

const SUPPORTED_EXTS = ['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.html', '.docx']

function expandTilde(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  if (p === '~') return os.homedir()
  return p
}

function detectContext() {
  let gitRoot: string | null = null
  try {
    gitRoot = execSync('git rev-parse --show-toplevel', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim()
  } catch {
    // not a git repo
  }

  const isHomedir = process.cwd() === os.homedir()
  const existingLocalConfig = findLocalConfig()

  return { gitRoot, isHomedir, existingLocalConfig }
}

export function InitScreen() {
  const { exit } = useApp()
  const [step, setStep] = useState<Step>(0)
  const [scope, setScope] = useState<ConfigScope | null>(null)
  const [context] = useState(detectContext)
  const [provider, setProvider] = useState<ProviderId | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')
  const [ollamaError, setOllamaError] = useState('')
  const [model, setModel] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [wikiDir, setWikiDir] = useState(path.join(os.homedir(), 'my-wiki'))
  const [rawDir, setRawDir] = useState('')
  const [log, setLog] = useState<string[]>([])

  useEffect(() => {
    if (scope === 'local') {
      setWikiDir(path.join(process.cwd(), '.axiom'))
      setRawDir(path.join(process.cwd(), '.axiom/raw'))
    } else if (scope === 'global') {
      setWikiDir(path.join(os.homedir(), 'my-wiki'))
      setRawDir(path.join(os.homedir(), 'my-wiki', 'raw'))
    }
  }, [scope])

  // Keep rawDir in sync with wikiDir while user edits it
  useEffect(() => {
    if (step < 6) setRawDir(path.join(expandTilde(wikiDir), 'raw'))
  }, [wikiDir, step])

  useInput((_, key) => {
    if (step === 0 && key.return) setStep(1)
    if (step === 8 && key.return) exit()
  })

  useEffect(() => {
    if (step !== 7) return

    const run = async () => {
      try {
        const expandedWiki = expandTilde(wikiDir)
        const expandedRaw = expandTilde(rawDir)
        const finalModel = model === '__custom__' ? customModel.trim() : model

        const configToSave = provider === 'ollama'
          ? { provider: provider!, apiKey: '', model: finalModel, wikiDir: expandedWiki, rawDir: expandedRaw, ollamaBaseUrl: ollamaUrl.trim() + '/api' }
          : { provider: provider!, apiKey, model: finalModel, wikiDir: expandedWiki, rawDir: expandedRaw }

        clearConfig(scope ?? 'global')

        if (scope === 'local') {
          const localConfigPath = path.join(process.cwd(), '.axiom/config.json')
          setLocalConfig(configToSave, localConfigPath)

          // Add .axiom/ to .gitignore (contains API key + generated content)
          const gitignorePath = path.join(context.gitRoot ?? process.cwd(), '.gitignore')
          const entry = '.axiom/'
          const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : ''
          if (!existing.split('\n').some((l) => l.trim() === entry)) {
            fs.writeFileSync(gitignorePath, existing + (existing.endsWith('\n') || !existing ? '' : '\n') + entry + '\n', 'utf-8')
            addLog('✓ Added .axiom/ to .gitignore')
          }
        } else {
          setConfig(configToSave)
        }
        addLog('✓ Config saved')

        await scaffoldWiki(expandedWiki)
        addLog('✓ Wiki structure created')

        const rawFiles = fs.existsSync(expandedRaw)
          ? fs.readdirSync(expandedRaw).filter((f: string) => {
              const ext = path.extname(f).toLowerCase()
              return SUPPORTED_EXTS.includes(ext) && fs.statSync(path.join(expandedRaw, f)).isFile()
            })
          : []

        if (rawFiles.length > 0) {
          addLog(`⠸ Processing ${rawFiles.length} existing file(s) in raw/...`)
          const config = { provider: provider!, apiKey, model: finalModel, wikiDir: expandedWiki, rawDir: expandedRaw }
          const agent = createAxiomAgent(config)

          for (const file of rawFiles) {
            const filepath = path.join(expandedRaw, file)
            addLog(`  → ingesting ${file}`)
            try {
              await agent.generate([{ role: 'user', content: `Ingest this source file into the wiki: ${filepath}` }])
            } catch {
              addLog(`  ⚠ Failed to ingest ${file}`)
            }
          }
        }

        addLog('✓ Done')
        setStep(8)
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
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box flexDirection="column">
          <Text color="cyan" bold>{'  █████╗ ██╗  ██╗██╗ ██████╗ ███╗   ███╗'}</Text>
          <Text color="cyan" bold>{'  ██╔══██╗╚██╗██╔╝██║██╔═══██╗████╗ ████║'}</Text>
          <Text color="cyan" bold>{'  ███████║ ╚███╔╝ ██║██║   ██║██╔████╔██║'}</Text>
          <Text color="cyan" bold>{'  ██╔══██║ ██╔██╗ ██║██║   ██║██║╚██╔╝██║'}</Text>
          <Text color="cyan" bold>{'  ██║  ██║██╔╝ ██╗██║╚██████╔╝██║ ╚═╝ ██║'}</Text>
          <Text color="cyan" bold>{'  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝'}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray" dimColor>{'  '}The wiki that maintains itself.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">{'  '}v0.2.0</Text>
        </Box>
        {context.existingLocalConfig ? (
          <Box marginTop={2} flexDirection="column">
            <Text color="yellow">  ⚠ Local wiki already configured here.</Text>
            <Text>  Continuing will let you reconfigure it.</Text>
          </Box>
        ) : (
          <Box marginTop={2}>
            <Text>  Let's set up your wiki. This takes about 2 minutes.</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color="gray">  Press <Text color="white">Enter</Text> to {context.existingLocalConfig ? 'reconfigure' : 'continue'} →</Text>
        </Box>
      </Box>
    )
  }

  if (step === 1) {
    const { gitRoot, isHomedir, existingLocalConfig } = context

    let contextMessage: string
    if (gitRoot) {
      contextMessage = `I see you're in a git repo at ${gitRoot}.`
    } else if (isHomedir) {
      contextMessage = `You're in your home directory.`
    } else {
      contextMessage = `You're in ${process.cwd()}.`
    }

    const items = [
      { label: `Local  — project wiki in ${process.cwd()}/.axiom/`, value: 'local' },
      { label: `Global — personal wiki in ${os.homedir()}/my-wiki/`, value: 'global' },
    ]

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Where should this wiki live?</Text>
        <Box marginTop={1}>
          <Text color="gray">{contextMessage}</Text>
        </Box>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              setScope(item.value as ConfigScope)
              setStep(2)
            }}
          />
        </Box>
        {existingLocalConfig && (
          <Box marginTop={1}>
            <Text color="yellow">⚠ Existing local config found at {existingLocalConfig} — selecting Local will overwrite it.</Text>
          </Box>
        )}
      </Box>
    )
  }

  if (step === 2) {
    const items = listProviders().map((p) => ({ label: p.label, value: p.id }))
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Choose your LLM provider:</Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              setProvider(item.value as ProviderId)
              setModel(PROVIDERS[item.value as ProviderId].models.find((m) => m.recommended)?.id ?? PROVIDERS[item.value as ProviderId].models[0]!.id)
              setStep(3)
            }}
          />
        </Box>
      </Box>
    )
  }

  if (step === 3) {
    const prov = PROVIDERS[provider!]

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
                  setStep(4)
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
            onSubmit={(val) => { if (val.trim()) setStep(4) }}
          />
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Press Enter to continue</Text>
        </Box>
      </Box>
    )
  }

  if (step === 4) {
    const models = [
      ...PROVIDERS[provider!].models.map((m) => ({ label: `${m.label}  ${m.desc}`, value: m.id })),
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
              onSubmit={(val) => { if (val.trim()) setStep(5) }}
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
              if (item.value !== '__custom__') setStep(5)
            }}
          />
        </Box>
      </Box>
    )
  }

  if (step === 5) {
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
                setStep(6)
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

  if (step === 6) {
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
              setStep(7)
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Drop your source files here (PDFs, markdown, etc.)</Text>
        </Box>
      </Box>
    )
  }

  if (step === 7) {
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

  // step === 8: success
  const expandedWiki = expandTilde(wikiDir)
  const expandedRaw = expandTilde(rawDir)
  const mcpConfig = JSON.stringify({ 'axiom-wiki': { command: 'axiom-wiki', args: ['mcp'] } }, null, 2)

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">
        {scope === 'local' ? '✓ Local project wiki is ready!' : '✓ Axiom Wiki is ready!'}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Your wiki:    <Text color="cyan">{expandedWiki}/wiki/</Text></Text>
        <Text>Raw sources:  <Text color="cyan">{expandedRaw}/</Text></Text>
        {scope === 'local' && (
          <Text color="gray">Config: <Text color="cyan">{process.cwd()}/.axiom/config.json</Text></Text>
        )}
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
      {scope === 'local' && (
        <Box marginTop={1}>
          <Text color="gray">Run <Text color="cyan">axiom-wiki</Text> from this directory to use this wiki.</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">Press <Text color="white">Enter</Text> to exit</Text>
      </Box>
    </Box>
  )
}
