import React, { useState, useEffect } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import SelectInput from 'ink-select-input'
import { getConfig, setConfig } from '../../config/index.js'
import { PROVIDERS, listProviders, type ProviderId } from '../../config/models.js'
import { fetchOllamaModels, ollamaModelsToSelectItems, pullOllamaModel, formatPullProgress, OLLAMA_SUGGESTED_MODELS, stripOllamaApiSuffix, type OllamaModel } from '../../core/ollama.js'

type Action = 'full' | 'model-only' | 'key-only' | 'cancel'
type Step = 0 | 1 | 2 | 3 | 4

interface Props {
  onExit?: () => void
}

export function ModelScreen({ onExit }: Props) {
  const { exit } = useApp()
  const doExit = onExit ?? exit
  const existing = getConfig()

  const [step, setStep] = useState<Step>(0)
  const [action, setAction] = useState<Action | null>(null)
  const [provider, setProvider] = useState<ProviderId>(existing?.provider ?? 'google')
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '')
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [ollamaStatus, setOllamaStatus] = useState<'ok' | 'no-models' | 'unreachable' | null>(null)
  const [ollamaUrl, setOllamaUrl] = useState(existing?.ollamaBaseUrl ? stripOllamaApiSuffix(existing.ollamaBaseUrl) : 'http://localhost:11434')
  const [ollamaError, setOllamaError] = useState('')
  const [ollamaLoading, setOllamaLoading] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pullProgress, setPullProgress] = useState('')
  const [pullError, setPullError] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)

  // Snapshot of original values for the diff
  const [origProvider] = useState(existing?.provider ?? null)
  const [origModel] = useState(existing?.model ?? null)

  // Must be called unconditionally before any early returns
  useInput((_input, key) => {
    if (key.escape) { doExit(); return }
    if (step === 4 && key.return) { doExit() }
  })

  // Fetch Ollama models when doing "model-only" change with Ollama provider
  useEffect(() => {
    if (!ollamaLoading) return
    const run = async () => {
      const result = await fetchOllamaModels(ollamaUrl)
      setOllamaStatus(result.status)
      setOllamaModels(result.models)
      setOllamaLoading(false)
      setStep(3)
    }
    void run()
  }, [ollamaLoading])

  if (!existing) {
    return (
      <Box padding={1}>
        <Text color="yellow">No configuration found. Run <Text color="cyan">axiom-wiki init</Text> first.</Text>
      </Box>
    )
  }

  // ── Step 0: show current config + menu ───────────────────────────────────
  if (step === 0) {
    const prov = PROVIDERS[existing.provider]
    const mod = prov.models.find((m) => m.id === existing.model)

    const items = [
      { label: 'Change provider + model', value: 'full' },
      { label: `Change model only (keep ${prov.label})`, value: 'model-only' },
      { label: 'Update API key', value: 'key-only' },
      { label: 'Cancel', value: 'cancel' },
    ]

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Current model configuration:</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>  Provider : <Text color="cyan">{prov.label}</Text></Text>
          <Text>  Model    : <Text color="cyan">{mod?.label ?? existing.model}</Text></Text>
          <Text>  API Key  : <Text color="gray">••••••••••••••• (set)</Text></Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>What would you like to change?</Text>
          <Box marginTop={1}>
            <SelectInput
              items={items}
              onSelect={(item) => {
                const val = item.value as Action
                setAction(val)
                if (val === 'cancel') { doExit(); return }
                if (val === 'full') { setProvider(existing.provider); setStep(1) }
                if (val === 'model-only') {
                  setProvider(existing.provider)
                  if (existing.provider === 'ollama') {
                    setOllamaLoading(true)
                  } else {
                    setStep(3)
                  }
                }
                if (val === 'key-only') { setProvider(existing.provider); setStep(2) }
              }}
            />
          </Box>
        </Box>
      </Box>
    )
  }

  // ── Loading: fetching Ollama models ──────────────────────────────────────
  if (ollamaLoading) {
    return (
      <Box padding={1}>
        <Text>Checking Ollama for available models...</Text>
      </Box>
    )
  }

  // ── Step 1: select provider ───────────────────────────────────────────────
  if (step === 1) {
    const items = listProviders().map((p) => ({ label: p.label, value: p.id }))
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Choose your LLM provider:</Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              const newProvider = item.value as ProviderId
              setProvider(newProvider)
              // If provider changed, must re-enter key
              if (newProvider !== existing.provider) {
                setApiKey('')
              }
              setStep(2)
            }}
          />
        </Box>
      </Box>
    )
  }

  // ── Step 2: API key (or Ollama URL) ──────────────────────────────────────
  if (step === 2) {
    if (provider === 'ollama') {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold>Ollama base URL:</Text>
          <Text color="gray">(Press Enter for default: {ollamaUrl})</Text>
          <Box marginTop={1}>
            <Text>{'> '}</Text>
            <TextInput
              value={ollamaUrl}
              onChange={(v) => { setOllamaUrl(v); setOllamaError('') }}
              onSubmit={async (val) => {
                const url = (val.trim() || 'http://localhost:11434').replace(/\/+$/, '')
                setOllamaUrl(url)
                setOllamaError('')
                const result = await fetchOllamaModels(url)
                setOllamaStatus(result.status)
                if (result.status === 'unreachable') {
                  setOllamaError(`Could not connect to Ollama at ${url}\nIs Ollama installed? Visit https://ollama.com\nIs it running? Try: ollama serve`)
                  return
                }
                setOllamaModels(result.models)
                setStep(3)
              }}
            />
          </Box>
          {ollamaError && (
            <Box marginTop={1} flexDirection="column">
              <Text color="red">✗ {ollamaError}</Text>
              <Text color="gray">Press Enter to retry, or Esc to go back.</Text>
            </Box>
          )}
        </Box>
      )
    }

    const prov = PROVIDERS[provider]
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
              if (val.trim()) {
                setApiKey(val.trim())
                // key-only → save and go to confirm
                if (action === 'key-only') {
                  setConfig({ apiKey: val.trim() })
                  setStep(4)
                } else {
                  setStep(3)
                }
              }
            }}
          />
        </Box>
      </Box>
    )
  }

  // ── Step 3: select model ──────────────────────────────────────────────────
  if (step === 3) {
    const saveModel = (modelId: string) => {
      if (provider === 'ollama') {
        const ollamaBaseUrl = ollamaUrl.replace(/\/+$/, '') + '/v1'
        if (action === 'model-only') {
          setConfig({ model: modelId, ollamaBaseUrl })
        } else {
          setConfig({ provider, apiKey: '', model: modelId, ollamaBaseUrl })
        }
      } else if (action === 'model-only') {
        setConfig({ model: modelId })
      } else {
        setConfig({ provider, apiKey, model: modelId })
      }
      setStep(4)
    }

    const selectOllamaModel = async (modelName: string) => {
      const isLocal = ollamaModels.some((m) => m.name === modelName || m.name === `${modelName}:latest`)
      if (isLocal) {
        saveModel(modelName)
        return
      }
      setPulling(true)
      setPullProgress(`Pulling ${modelName}...`)
      setPullError('')
      const result = await pullOllamaModel(ollamaUrl, modelName, (p) => {
        setPullProgress(formatPullProgress(p))
      })
      setPulling(false)
      if (!result.ok) {
        setPullError(`Failed to pull ${modelName}: ${result.error}`)
        return
      }
      const refreshed = await fetchOllamaModels(ollamaUrl)
      setOllamaStatus(refreshed.status)
      setOllamaModels(refreshed.models)
      saveModel(modelName)
    }

    // Show pulling progress
    if (pulling) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold>Pulling model...</Text>
          <Box marginTop={1}>
            <Text>{pullProgress}</Text>
          </Box>
        </Box>
      )
    }

    // Custom model name input (Ollama)
    if (provider === 'ollama' && showCustomInput) {
        return (
          <Box flexDirection="column" padding={1}>
            <Text bold>Enter model name:</Text>
            <Text color="gray">The model will be pulled automatically if not already available.</Text>
            <Box marginTop={1}>
              <Text>{'> '}</Text>
              <TextInput
                value={customModel}
                onChange={setCustomModel}
                onSubmit={async (val) => {
                  if (!val.trim()) return
                  await selectOllamaModel(val.trim())
                }}
              />
            </Box>
            {pullError && (
              <Box marginTop={1}>
                <Text color="red">✗ {pullError}</Text>
              </Box>
            )}
          </Box>
        )
    }

    // Ollama: show locally available models or suggestions
    if (provider === 'ollama') {
      if (ollamaStatus === 'no-models' || ollamaStatus === 'unreachable') {
        const suggestedItems = OLLAMA_SUGGESTED_MODELS.map((s) => ({
          label: `${s.name}  ${s.desc}`,
          value: s.name,
        }))
        const items = [
          ...suggestedItems,
          { label: '[ Enter custom model name ]', value: '__custom__' },
        ]
        return (
          <Box flexDirection="column" padding={1}>
            <Text bold color="yellow">
              {ollamaStatus === 'unreachable' ? 'Could not connect to Ollama.' : 'No models found on your Ollama instance.'}
            </Text>
            <Text>Select a model to pull it automatically:</Text>
            <Box marginTop={1}>
              <SelectInput
                items={items}
                onSelect={async (item) => {
                  if (item.value === '__custom__') { setCustomModel(''); setShowCustomInput(true); return }
                  await selectOllamaModel(item.value)
                }}
              />
            </Box>
            {pullError && (
              <Box marginTop={1}>
                <Text color="red">✗ {pullError}</Text>
              </Box>
            )}
          </Box>
        )
      }

      // Has local models
      const localModels = [
        ...ollamaModelsToSelectItems(ollamaModels).map((m) => ({
          ...m,
          label: m.value === existing.model ? `${m.label}  (current)` : m.label,
        })),
        { label: '[ Enter custom model name ]', value: '__custom__' },
      ]
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold>Choose a model <Text color="gray">(locally available)</Text>:</Text>
          <Box marginTop={1}>
            <SelectInput
              items={localModels}
              onSelect={(item) => {
                if (item.value === '__custom__') { setCustomModel(''); setShowCustomInput(true); return }
                saveModel(item.value)
              }}
            />
          </Box>
        </Box>
      )
    }

    // Non-Ollama: hardcoded list
    const models = PROVIDERS[provider].models.map((m) => ({
      label: `${m.label}  —  ${m.desc}${m.id === existing.model ? '  (current)' : ''}`,
      value: m.id,
    }))
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Choose a model for {PROVIDERS[provider].label}:</Text>
        <Box marginTop={1}>
          <SelectInput
            items={models}
            onSelect={(item) => {
              saveModel(item.value)
            }}
          />
        </Box>
      </Box>
    )
  }

  // ── Step 4: confirm ───────────────────────────────────────────────────────
  const newCfg = getConfig()
  const newProvLabel = newCfg ? PROVIDERS[newCfg.provider].label : '?'
  const newModLabel = newCfg ? (PROVIDERS[newCfg.provider].models.find((m) => m.id === newCfg.model)?.label ?? newCfg.model) : '?'
  const origProvLabel = origProvider ? PROVIDERS[origProvider].label : '?'
  const origModLabel = origProvider && origModel ? (PROVIDERS[origProvider].models.find((m) => m.id === origModel)?.label ?? origModel) : '?'

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">✓ Configuration updated:</Text>
      <Box marginTop={1} flexDirection="column">
        {action !== 'model-only' && (
          <Text>  Provider : <Text color="gray">{origProvLabel}</Text>  →  <Text color="cyan">{newProvLabel}</Text></Text>
        )}
        {action !== 'key-only' && (
          <Text>  Model    : <Text color="gray">{origModLabel}</Text>  →  <Text color="cyan">{newModLabel}</Text></Text>
        )}
        {(action === 'full' || action === 'key-only') && (
          <Text>  API Key  : <Text color="cyan">updated</Text></Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Changes saved. Run <Text color="cyan">axiom-wiki query</Text> to test.</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Press Enter to continue</Text>
      </Box>
    </Box>
  )
}
