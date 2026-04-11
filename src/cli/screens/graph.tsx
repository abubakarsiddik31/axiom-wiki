import React, { useState, useEffect } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { getConfig, hasConfig } from '../../config/index.js'
import { buildGraph, type WikiGraph } from '../../core/graph.js'

function Header({ children }: { children: React.ReactNode }) {
  return (
    <Box marginBottom={1}>
      <Text bold color="magenta">{children}</Text>
    </Box>
  )
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold underline>{title}</Text>
      <Box marginLeft={2} flexDirection="column">
        {children}
      </Box>
    </Box>
  )
}

interface Props {
  onExit?: () => void
}

export function GraphScreen({ onExit }: Props) {
  const { exit } = useApp()
  const doExit = onExit ?? exit
  const config = getConfig()
  const [graph, setGraph] = useState<WikiGraph | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!config) return
    try {
      const g = buildGraph(config.wikiDir)
      setGraph(g)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [config])

  useInput((input, key) => {
    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) {
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

  if (error) {
    return (
      <Box padding={1}>
        <Text color="red">Error: {error}</Text>
      </Box>
    )
  }

  if (!graph) {
    return (
      <Box padding={1}>
        <Text color="gray">Analyzing wiki graph...</Text>
      </Box>
    )
  }

  const deadLinkTargets = Array.from(new Set(graph.deadLinks.map(l => l.to)))

  return (
    <Box flexDirection="column" padding={1}>
      <Header>Axiom Wiki — Graph Analysis</Header>

      <Box flexDirection="row" marginBottom={1}>
        <Box borderStyle="round" paddingX={2} marginRight={2}>
          <Text color="cyan">Nodes: {graph.nodes.size}</Text>
        </Box>
        <Box borderStyle="round" paddingX={2} marginRight={2}>
          <Text color="green">Edges: {graph.edges.length}</Text>
        </Box>
        <Box borderStyle="round" paddingX={2} borderColor={graph.orphans.length > 0 ? 'yellow' : 'gray'}>
          <Text color={graph.orphans.length > 0 ? 'yellow' : 'gray'}>Orphans: {graph.orphans.length}</Text>
        </Box>
        <Box borderStyle="round" paddingX={2} marginLeft={2} borderColor={deadLinkTargets.length > 0 ? 'red' : 'gray'}>
          <Text color={deadLinkTargets.length > 0 ? 'red' : 'gray'}>Dead Links: {deadLinkTargets.length}</Text>
        </Box>
      </Box>

      <Section title="Issue Report">
        {graph.orphans.length === 0 && deadLinkTargets.length === 0 ? (
          <Text color="green">✓ No graph issues found. Wiki is well-interlinked!</Text>
        ) : (
          <React.Fragment>
            {graph.orphans.length > 0 && (
              <Box flexDirection="column" marginBottom={1}>
                <Text color="yellow">⚠️ Orphans ({graph.orphans.length}):</Text>
                {graph.orphans.slice(0, 5).map(id => (
                  <Text key={id} color="gray">  - {id}</Text>
                ))}
                {graph.orphans.length > 5 && <Text color="gray">  ... and {graph.orphans.length - 5} more</Text>}
              </Box>
            )}
            {deadLinkTargets.length > 0 && (
              <Box flexDirection="column">
                <Text color="red">✗ Dead Links ({deadLinkTargets.length}):</Text>
                {deadLinkTargets.slice(0, 5).map(id => (
                  <Text key={id} color="gray">  - {id} (referenced by {graph.deadLinks.filter(l => l.to === id).length} pages)</Text>
                ))}
                {deadLinkTargets.length > 5 && <Text color="gray">  ... and {deadLinkTargets.length - 5} more</Text>}
              </Box>
            )}
          </React.Fragment>
        )}
      </Section>

      <Section title="Visual Preview (Subset)">
        <Box flexDirection="column">
          {Array.from(graph.nodes.keys()).slice(0, 10).map(nodeId => {
            const outEdges = graph.edges.filter(e => e.from === nodeId)
            return (
              <Box key={nodeId} flexDirection="column">
                <Text color="cyan">○ {nodeId}</Text>
                {outEdges.slice(0, 3).map((edge, idx) => (
                  <Text key={idx} color="gray">  {idx === outEdges.length - 1 ? '└─' : '├─'} [[{edge.to}]]</Text>
                ))}
                {outEdges.length > 3 && <Text color="gray">  └─ ... ({outEdges.length - 3} more)</Text>}
              </Box>
            )
          })}
        </Box>
      </Section>

      <Box marginTop={1}>
        <Text color="gray">Press <Text color="cyan">q</Text> or <Text color="cyan">Esc</Text> to exit.</Text>
      </Box>
    </Box>
  )
}
