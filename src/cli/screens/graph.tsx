import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import SelectInput from 'ink-select-input'
import { getConfig, hasConfig } from '../../config/index.js'
import { buildGraph, type WikiGraph, type GraphNode } from '../../core/graph.js'

function Header({ children }: { children: React.ReactNode }) {
  return (
    <Box marginBottom={1}>
      <Text bold color="magenta">{children}</Text>
    </Box>
  )
}

interface Props {
  onExit?: () => void
}

type Column = 'categories' | 'nodes' | 'details'

export function GraphScreen({ onExit }: Props) {
  const { exit } = useApp()
  const doExit = onExit ?? exit
  const config = useMemo(() => getConfig(), [])
  
  const [graph, setGraph] = useState<WikiGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  // Navigation State
  const [activeColumn, setActiveColumn] = useState<Column>('categories')
  const [selectedCategory, setSelectedCategory] = useState<string>('entities')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  // ── Data Fetching ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!config) return
    try {
      const g = buildGraph(config.wikiDir)
      setGraph(g)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // ── Derived Data ───────────────────────────────────────────────────────────
  const categories = useMemo(() => {
    if (!graph) return []
    const baseCats = Array.from(new Set(Array.from(graph.nodes.values()).map(n => n.category)))
      .filter(c => c && c !== 'unknown')
      .sort()
    
    return [
      ...baseCats.map(c => ({ label: c, value: c })),
      { label: '⚠️ Orphans', value: '!orphans' },
      { label: '✗ Dead Links', value: '!dead' }
    ]
  }, [graph])

  const nodesInSelection = useMemo(() => {
    if (!graph) return []
    let filtered: GraphNode[] = []
    
    if (selectedCategory === '!orphans') {
      filtered = graph.orphans.map(id => graph.nodes.get(id)!).filter(Boolean)
    } else if (selectedCategory === '!dead') {
      const deadTargets = Array.from(new Set(graph.deadLinks.map(l => l.to)))
      filtered = deadTargets.map(id => graph.nodes.get(id)!).filter(Boolean)
    } else {
      filtered = Array.from(graph.nodes.values()).filter(n => n.category === selectedCategory && n.exists)
    }
    
    return filtered.sort((a, b) => a.id.localeCompare(b.id))
  }, [graph, selectedCategory])

  const nodeItems = useMemo(() => {
    return nodesInSelection.map(n => ({ label: n.id, value: n.id }))
  }, [nodesInSelection])

  const selectedNode = graph?.nodes.get(selectedNodeId ?? '')
  const neighborhood = useMemo(() => {
    if (!graph || !selectedNodeId) return { inbound: [], outbound: [] }
    return {
      inbound: graph.edges.filter(e => e.to === selectedNodeId).map(e => e.from),
      outbound: graph.edges.filter(e => e.from === selectedNodeId).map(e => e.to)
    }
  }, [graph, selectedNodeId])

  const detailItems = useMemo(() => {
    const items = []
    for (const id of neighborhood.outbound) {
      const exists = graph?.nodes.get(id)?.exists
      items.push({ label: `→ [[ ${id} ]]${exists ? '' : ' (Dead)'}`, value: id, type: 'out' })
    }
    for (const id of neighborhood.inbound) {
      items.push({ label: `← [[ ${id} ]]`, value: id, type: 'in' })
    }
    return items
  }, [neighborhood, graph])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCategorySelect = useCallback((item: { value: string }) => {
    setSelectedCategory(item.value)
    setActiveColumn('nodes')
  }, [])

  const handleNodeSelect = useCallback((item: { value: string }) => {
    setSelectedNodeId(item.value)
    setActiveColumn('details')
  }, [])

  const handleDrillDown = useCallback((item: { value: string }) => {
    const node = graph?.nodes.get(item.value)
    if (node) {
      setSelectedCategory(node.category)
      setSelectedNodeId(node.id)
      setActiveColumn('details')
    }
  }, [graph])

  useInput((input, key) => {
    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) {
      doExit()
    }

    if (key.leftArrow) {
      if (activeColumn === 'nodes') setActiveColumn('categories')
      if (activeColumn === 'details') setActiveColumn('nodes')
    }
    if (key.rightArrow) {
      if (activeColumn === 'categories') setActiveColumn('nodes')
      if (activeColumn === 'nodes' && selectedNodeId) setActiveColumn('details')
    }
  })

  // ── Render ────────────────────────────────────────────────────────────────
  if (!hasConfig() || !config) return <Box padding={1}><Text color="yellow">Not configured.</Text></Box>
  if (error) return <Box padding={1}><Text color="red">Error: {error}</Text></Box>
  if (!graph) return <Box padding={1}><Text color="gray">Analyzing wiki graph...</Text></Box>

  return (
    <Box flexDirection="column" padding={1} height={24}>
      <Header>Axiom Wiki — Graph Explorer</Header>

      <Box flexDirection="row" flexGrow={1}>
        {/* Column 1: Categories */}
        <Box flexDirection="column" width="20%" borderStyle="round" borderColor={activeColumn === 'categories' ? 'magenta' : 'gray'} paddingX={1}>
          <Text bold color={activeColumn === 'categories' ? 'magenta' : 'white'}>Category</Text>
          <Box marginTop={1}>
            {activeColumn === 'categories' ? (
              <SelectInput items={categories} onSelect={handleCategorySelect} />
            ) : (
              <Box flexDirection="column">
                {categories.map(c => (
                  <Text key={c.value} color={selectedCategory === c.value ? 'cyan' : 'gray'}>
                    {selectedCategory === c.value ? '▶ ' : '  '}{c.label}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        </Box>

        {/* Column 2: Nodes */}
        <Box flexDirection="column" width="30%" borderStyle="round" borderColor={activeColumn === 'nodes' ? 'magenta' : 'gray'} paddingX={1} marginLeft={1}>
          <Text bold color={activeColumn === 'nodes' ? 'magenta' : 'white'}>Pages</Text>
          <Box marginTop={1}>
            {activeColumn === 'nodes' ? (
              <SelectInput items={nodeItems} onSelect={handleNodeSelect} limit={12} />
            ) : (
              <Box flexDirection="column">
                {nodeItems.length === 0 ? <Text color="gray" dimColor>  (none)</Text> : 
                  nodeItems.slice(0, 12).map(n => (
                    <Text key={n.value} color={selectedNodeId === n.value ? 'cyan' : 'gray'} wrap="truncate-end">
                      {selectedNodeId === n.value ? '▶ ' : '  '}{n.label}
                    </Text>
                  ))
                }
                {nodeItems.length > 12 && <Text color="gray" dimColor>  ...</Text>}
              </Box>
            )}
          </Box>
        </Box>

        {/* Column 3: Neighborhood & Details */}
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={activeColumn === 'details' ? 'magenta' : 'gray'} paddingX={1} marginLeft={1}>
          <Text bold color={activeColumn === 'details' ? 'magenta' : 'cyan'}>
            {selectedNode?.title || selectedNodeId || 'Select a node'}
          </Text>
          {selectedNode && (
            <React.Fragment>
              <Box marginBottom={1}>
                <Text color="gray" dimColor italic>{selectedNode.path}</Text>
              </Box>
              
              <Text bold color="white" underline>Connections (Select to Drill Down)</Text>
              <Box marginTop={1}>
                {detailItems.length === 0 ? (
                  <Text color="gray" dimColor italic>No connections found.</Text>
                ) : (
                  activeColumn === 'details' ? (
                    <SelectInput items={detailItems} onSelect={handleDrillDown} limit={8} />
                  ) : (
                    <Box flexDirection="column">
                      {detailItems.slice(0, 8).map((item, i) => (
                        <Text key={i} color="gray" wrap="truncate-end">  {item.label}</Text>
                      ))}
                      {detailItems.length > 8 && <Text color="gray" dimColor>  ...</Text>}
                    </Box>
                  )
                )}
              </Box>
            </React.Fragment>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box marginTop={1} justifyContent="space-between">
        <Box>
          <Text color="gray">Nodes: {graph.nodes.size} | Edges: {graph.edges.length} | </Text>
          <Text color="yellow">Orphans: {graph.orphans.length}</Text>
          <Text color="gray"> | </Text>
          <Text color="red">Dead: {graph.deadLinks.length}</Text>
        </Box>
        <Text color="gray">Arrows to Navigate · Enter select/drill · q exit</Text>
      </Box>
    </Box>
  )
}
