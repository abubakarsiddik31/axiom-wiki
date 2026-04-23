import React, { useState, useEffect } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { getConfig, hasConfig } from '../../config/index.js'
import { PROVIDERS } from '../../config/models.js'
import { getStatus, type WikiStatus } from '../../core/wiki.js'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Box width={16}>
        <Text>{label}</Text>
      </Box>
      <Text color="cyan">{value}</Text>
    </Box>
  )
}

interface Props {
  onExit?: () => void
}

export function StatusScreen({ onExit }: Props) {
  const { exit } = useApp()
  const doExit = onExit ?? exit
  const isInteractive = !!onExit
  const config = getConfig()
  const [status, setStatus] = useState<WikiStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!config) return
    getStatus(config)
      .then((s) => { 
        setStatus(s)
        if (!isInteractive) {
          setTimeout(doExit, 100)
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
        if (!isInteractive) {
          setTimeout(doExit, 100)
        }
      })
  }, [config, isInteractive, doExit])

  useInput((_input, key) => {
    if (isInteractive && (key.escape || key.return)) {
      doExit()
    }
  })

  if (!hasConfig() || !config) {
    return (
      <Box padding={1}>
        <Text color="yellow">Not configured. Run <Text color="cyan">axiom-wiki init</Text> first.</Text>
      </Box>
    )
  }

  const divider = <Text color="gray">{'─'.repeat(40)}</Text>
  const prov = PROVIDERS[config.provider]
  const modelLabel = prov.models.find((m) => m.id === config.model)?.label ?? config.model

  if (error) {
    return (
      <Box padding={1}>
        <Text color="red">Error: {error}</Text>
      </Box>
    )
  }

  if (!status) {
    return (
      <Box padding={1}>
        <Text color="gray">Loading...</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Axiom Wiki — Status</Text>
      <Box marginTop={1}>{divider}</Box>

      <Box marginTop={1} flexDirection="column">
        <Row label="Provider" value={`${prov.label} · ${modelLabel}`} />
        <Row label="Embeddings" value={status.semanticHealth?.status !== 'disabled' 
          ? `${status.semanticHealth?.provider} (${status.semanticHealth?.model}) [${status.semanticHealth?.status}]` 
          : 'Disabled'} />
        <Row label="Wiki" value={`${config.wikiDir}/wiki/`} />
        <Row label="Raw" value={config.rawDir} />
      </Box>

      <Box marginTop={1}>{divider}</Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Pages</Text>
        <Box marginLeft={2} flexDirection="column">
          <Row label="Total" value={String(status.totalPages)} />
          <Row label="Entities" value={String(status.pagesByCategory['entities'] ?? 0)} />
          <Row label="Concepts" value={String(status.pagesByCategory['concepts'] ?? 0)} />
          <Row label="Sources" value={String(status.pagesByCategory['sources'] ?? 0)} />
          <Row label="Analyses" value={String(status.pagesByCategory['analyses'] ?? 0)} />
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Sources</Text>
        <Box marginLeft={2} flexDirection="column">
          <Row label="Raw files" value={String(status.rawSourceCount)} />
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Size</Text>
        <Box marginLeft={2} flexDirection="column">
          <Row label="Wiki" value={formatBytes(status.wikiSizeBytes)} />
        </Box>
      </Box>

      <Box marginTop={1}>{divider}</Box>

      <Box marginTop={1} flexDirection="column">
        <Row label="Last ingest" value={status.lastIngest ?? '—'} />
        <Row label="Last query" value={status.lastQuery ?? '—'} />
        <Row label="Last lint" value={status.lastLint ?? '—'} />
      </Box>

      <Box marginTop={1}>{divider}</Box>

      <Box marginTop={1}>
        <Text color="gray">Tip: Run <Text color="cyan">axiom-wiki lint</Text> to check wiki health.</Text>
      </Box>

      {isInteractive && (
        <Box marginTop={1}>
          <Text color="gray">Press Esc or Enter to return</Text>
        </Box>
      )}

      {status.semanticHealth?.status === 'disabled' && (
        <Box marginTop={1}>
          <Text color="yellow">Tip: Run <Text color="cyan">axiom-wiki embed --setup</Text> to enable semantic search.</Text>
        </Box>
      )}
    </Box>
  )
}
