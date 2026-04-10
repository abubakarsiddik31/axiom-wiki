import React, { useState, useEffect } from 'react'
import { Box, Text, useApp } from 'ink'
import SelectInput from 'ink-select-input'
import { getConfig, hasConfig } from '../../config/index.js'
import { PROVIDERS } from '../../config/models.js'
import { getStatus } from '../../core/wiki.js'
import { QueryScreen } from './query.js'
import { IngestScreen } from './ingest.js'
import { StatusScreen } from './status.js'
import { ModelScreen } from './model.js'
import { WatchScreen } from './watch.js'
import { ClipScreen } from './clip.js'
import { SourcesScreen } from './sources.js'

type Screen = 'home' | 'query' | 'ingest' | 'status' | 'model' | 'watch' | 'clip' | 'sources'

interface WikiStats {
  totalPages: number
  rawSourceCount: number
}

export function HomeScreen() {
  const { exit } = useApp()
  const config = getConfig()
  const [screen, setScreen] = useState<Screen>('home')
  const [stats, setStats] = useState<WikiStats | null>(null)

  useEffect(() => {
    if (!config) return
    getStatus(config.wikiDir, config.rawDir)
      .then((s) => setStats({ totalPages: s.totalPages, rawSourceCount: s.rawSourceCount }))
      .catch(() => {})
  }, [])

  if (!hasConfig() || !config) {
    return (
      <Box padding={1} flexDirection="column">
        <Box borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1} flexDirection="column">
          <Text bold color="cyan">Axiom Wiki</Text>
          <Text color="gray">The wiki that maintains itself.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="yellow">Run <Text color="cyan">axiom-wiki init</Text> to get started.</Text>
        </Box>
      </Box>
    )
  }

  if (screen === 'query') return <QueryScreen />
  if (screen === 'ingest') return <IngestScreen />
  if (screen === 'status') return <StatusScreen />
  if (screen === 'model') return <ModelScreen />
  if (screen === 'watch') return <WatchScreen />
  if (screen === 'clip') return <ClipScreen />
  if (screen === 'sources') return <SourcesScreen />

  const prov = PROVIDERS[config.provider]
  const modelLabel = prov.models.find((m) => m.id === config.model)?.label ?? config.model

  const items = [
    { label: 'Query wiki', value: 'query' },
    { label: 'Ingest sources', value: 'ingest' },
    { label: 'Watch mode (auto-ingest)', value: 'watch' },
    { label: 'Clip URL', value: 'clip' },
    { label: 'Manage sources', value: 'sources' },
    { label: 'Wiki status', value: 'status' },
    { label: 'Switch model', value: 'model' },
    { label: 'Exit', value: 'exit' },
  ]

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1} flexDirection="column">
        <Text bold color="cyan">Axiom Wiki</Text>
        <Text color="gray">The wiki that maintains itself.</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text>
          Provider: <Text color="cyan">{prov.label}</Text>
          {'  ·  '}
          <Text color="cyan">{modelLabel}</Text>
        </Text>
        <Text>
          Wiki:{'     '}
          <Text color="cyan">{config.wikiDir}/wiki/</Text>
          {stats ? (
            <Text color="gray">  ({stats.totalPages} pages · {stats.rawSourceCount} sources)</Text>
          ) : null}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray">{'─'.repeat(40)}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>What would you like to do?</Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === 'exit') { exit(); return }
              setScreen(item.value as Screen)
            }}
          />
        </Box>
      </Box>
    </Box>
  )
}
