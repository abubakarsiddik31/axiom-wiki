import React, { useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import SelectInput from 'ink-select-input'
import { getConfig, setConfig } from '../../config/index.js'
import { PROVIDERS, listProviders, type ProviderId } from '../../config/models.js'

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

  // Snapshot of original values for the diff
  const [origProvider] = useState(existing?.provider ?? null)
  const [origModel] = useState(existing?.model ?? null)

  // Must be called unconditionally before any early returns
  useInput((_input, key) => {
    if (key.escape) { doExit(); return }
    if (step === 4 && key.return) { doExit() }
  })

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
                if (val === 'model-only') { setProvider(existing.provider); setStep(3) }
                if (val === 'key-only') { setProvider(existing.provider); setStep(2) }
              }}
            />
          </Box>
        </Box>
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
              // Reset model to default for new provider
              void PROVIDERS[newProvider].models.find((m) => m.recommended) // reset sentinel
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

  // ── Step 2: API key ───────────────────────────────────────────────────────
  if (step === 2) {
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
              // Save config
              if (action === 'model-only') {
                setConfig({ model: item.value })
              } else {
                setConfig({ provider, apiKey, model: item.value })
              }
              setStep(4)
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
