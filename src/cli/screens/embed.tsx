import React, { useState, useEffect } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import SelectInput from 'ink-select-input'
import TextInput from 'ink-text-input'
import { getConfig, setConfig, type AxiomConfig } from '../../config/index.js'
import { reindexWiki } from '../../core/indexing.js'
import { getOrama } from '../../core/search/orama-store.js'
import path from 'path'
import fs from 'fs'

interface Props {
  setup?: boolean
  reindex?: boolean
  status?: boolean
  onExit?: () => void
}

type Step = 'menu' | 'provider' | 'apiKey' | 'model' | 'reindexing' | 'status' | 'done'

export function EmbedScreen({ setup, reindex, status, onExit }: Props) {
  const { exit } = useApp()
  const doExit = onExit ?? exit
  const config = getConfig()

  const [step, setStep] = useState<Step>(reindex ? 'reindexing' : status ? 'status' : setup ? 'provider' : 'menu')
  const [provider, setProvider] = useState<'google' | 'openai' | 'ollama' | 'none'>(config?.embeddings?.provider ?? 'none')
  const [apiKey, setApiKey] = useState(config?.embeddings?.apiKey ?? '')
  const [model, setModel] = useState(config?.embeddings?.model ?? '')
  const [reindexCount, setReindexCount] = useState(0)
  const [isReindexing, setIsReindexing] = useState(false)
  const [oramaStatus, setOramaStatus] = useState<{ totalPages: number; lastSyncAt: string | null } | null>(null)

  useInput((_input, key) => {
    if (key.escape) { doExit() }
    if (step === 'done' && key.return) { doExit() }
  })

  useEffect(() => {
    if (step === 'reindexing' && !isReindexing) {
      const run = async () => {
        if (!config) return
        setIsReindexing(true)
        const result = await reindexWiki(config)
        setReindexCount(result.count)
        setIsReindexing(false)
        setStep('done')
      }
      void run()
    }
  }, [step, isReindexing, config])

  useEffect(() => {
    if (step === 'status' && !oramaStatus) {
      const run = async () => {
        if (!config) return
        try {
          const db = await getOrama(config)
          // Orama 3 doesn't have a simple way to get count without searching or internal access
          // but we can do a match-all search
          const results = await db.search({ limit: 0 })
          setOramaStatus({
            totalPages: results.count,
            lastSyncAt: config.embeddings?.provider !== 'none' ? 'Active' : 'Disabled'
          })
        } catch {
          setOramaStatus({ totalPages: 0, lastSyncAt: 'Not found' })
        }
      }
      void run()
    }
  }, [step, oramaStatus, config])

  if (!config) {
    return (
      <Box padding={1}>
        <Text color="yellow">No configuration found. Run <Text color="cyan">axiom-wiki init</Text> first.</Text>
      </Box>
    )
  }

  if (step === 'menu') {
    const items = [
      { label: 'Setup Embedding Provider', value: 'provider' },
      { label: 'Re-index all pages', value: 'reindexing' },
      { label: 'Show status', value: 'status' },
      { label: 'Exit', value: 'exit' },
    ]
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold underline>Semantic Search Management</Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === 'exit') doExit()
              else setStep(item.value as Step)
            }}
          />
        </Box>
      </Box>
    )
  }

  if (step === 'provider') {
    const items = [
      { label: 'Google Gemini (Recommended)', value: 'google' },
      { label: 'OpenAI', value: 'openai' },
      { label: 'Ollama (Local)', value: 'ollama' },
      { label: 'Disable Semantic Search', value: 'none' },
    ]
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Choose an embedding provider:</Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              const p = item.value as any
              setProvider(p)
              if (p === 'none') {
                setConfig({ embeddings: { provider: 'none' } })
                setStep('done')
              } else if (p === 'ollama') {
                setStep('model')
              } else {
                setStep('apiKey')
              }
            }}
          />
        </Box>
      </Box>
    )
  }

  if (step === 'apiKey') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Enter API Key for {provider}:</Text>
        <Text color="gray">(Press Enter to use main API key if applicable)</Text>
        <Box marginTop={1}>
          <Text>{'> '}</Text>
          <TextInput
            value={apiKey}
            onChange={setApiKey}
            mask="•"
            onSubmit={(val) => {
              setApiKey(val.trim())
              setStep('model')
            }}
          />
        </Box>
      </Box>
    )
  }

  if (step === 'model') {
    const defaultModels = {
      google: 'text-embedding-004',
      openai: 'text-embedding-3-small',
      ollama: 'nomic-embed-text',
      none: '',
    }
    const def = defaultModels[provider]
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Enter Model ID:</Text>
        <Text color="gray">(Press Enter for default: {def})</Text>
        <Box marginTop={1}>
          <Text>{'> '}</Text>
          <TextInput
            value={model}
            placeholder={def}
            onChange={setModel}
            onSubmit={(val) => {
              const m = val.trim() || def
              const dimensions = provider === 'openai' ? 1536 : 768
              setConfig({
                embeddings: {
                  provider,
                  apiKey: apiKey || undefined,
                  model: m,
                  dimensions,
                }
              })
              setStep('reindexing')
            }}
          />
        </Box>
      </Box>
    )
  }

  if (step === 'reindexing') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Semantic Indexing in progress...</Text>
        <Text color="gray">This may take a few minutes depending on wiki size and provider.</Text>
        <Box marginTop={1}>
          <Text>Indexing pages...</Text>
        </Box>
      </Box>
    )
  }

  if (step === 'status') {
    const emb = config.embeddings
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold underline>Semantic Search Status</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>  Enabled    : {emb?.provider !== 'none' ? <Text color="green">Yes</Text> : <Text color="red">No</Text>}</Text>
          <Text>  Provider   : <Text color="cyan">{emb?.provider ?? 'none'}</Text></Text>
          <Text>  Model      : <Text color="cyan">{emb?.model ?? 'N/A'}</Text></Text>
          <Text>  Index Size : <Text color="cyan">{oramaStatus?.totalPages ?? 0} pages</Text></Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Press Esc to return</Text>
        </Box>
      </Box>
    )
  }

  if (step === 'done') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="green">✓ Semantic Search configured successfully!</Text>
        <Box marginTop={1}>
          <Text>Indexed <Text bold>{reindexCount}</Text> pages.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Press Enter to exit</Text>
        </Box>
      </Box>
    )
  }

  return null
}
