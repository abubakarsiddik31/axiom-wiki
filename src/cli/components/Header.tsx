import React from 'react'
import { Box, Text } from 'ink'
import { PROVIDERS } from '../../config/models.js'
import type { AxiomConfig } from '../../config/index.js'

interface Props {
  config: AxiomConfig
  totalPages?: number
  subtitle?: string
}

export function Header({ config, totalPages, subtitle }: Props) {
  const prov = PROVIDERS[config.provider]
  const modelLabel = prov?.models.find((m) => m.id === config.model)?.label ?? config.model

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="cyan">axiom</Text>
        <Text color="white" bold> wiki</Text>
        <Text color="gray">  ·  </Text>
        <Text color="gray">{prov?.label ?? config.provider}</Text>
        <Text color="gray"> / </Text>
        <Text color="white">{modelLabel}</Text>
        {totalPages !== undefined && (
          <Text color="gray">{'  ·  '}{totalPages} pages</Text>
        )}
      </Box>
      {subtitle && (
        <Text color="gray" dimColor>{subtitle}</Text>
      )}
      <Text color="gray" dimColor>{'─'.repeat(56)}</Text>
    </Box>
  )
}
