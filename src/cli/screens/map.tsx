import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { getConfig } from '../../config/index.js'
import { createAxiomAgent } from '../../agent/index.js'
import { calcCost } from '../../core/usage.js'
import { updateIndex } from '../../core/wiki.js'
import { walkProject, findProjectRoot, gatherFilesForPaths, type ProjectSnapshot } from '../../core/mapper.js'

interface Props {
  onExit?: () => void
}

type MapState = 'walking' | 'planning' | 'confirming' | 'executing' | 'done' | 'error'

interface PagePlan {
  title: string
  category: string
  description: string
  paths: string[]
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatCost(cost: number | null): string {
  if (cost === null) return 'n/a'
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(3)}`
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function topLanguages(languages: Record<string, number>, n = 5): string {
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([ext, count]) => `${ext} (${count})`)
    .join(', ')
}

function parsePlan(text: string): PagePlan[] | null {
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return null
    return parsed.filter(
      (item: unknown): item is PagePlan =>
        typeof item === 'object' && item !== null &&
        typeof (item as PagePlan).title === 'string' &&
        typeof (item as PagePlan).category === 'string'
    ).map((item: PagePlan) => ({
      title: item.title,
      category: item.category || 'analyses',
      description: item.description || '',
      paths: Array.isArray(item.paths) ? item.paths : [],
    }))
  } catch {
    return null
  }
}

function fallbackPlan(_snapshot: ProjectSnapshot): PagePlan[] {
  return [{
    title: 'Codebase Overview',
    category: 'analyses',
    description: 'Overview of the project structure, tech stack, and key components.',
    paths: [],
  }]
}

export function MapScreen(_props: Props) {
  const config = getConfig()!

  const [mapState, setMapState] = useState<MapState>('walking')
  const [fileCount, setFileCount] = useState(0)
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null)
  const [plan, setPlan] = useState<PagePlan[]>([])
  const [planCost, setPlanCost] = useState<number | null>(null)
  const [planInputTokens, setPlanInputTokens] = useState(0)
  const [planOutputTokens, setPlanOutputTokens] = useState(0)
  const [currentPageIdx, setCurrentPageIdx] = useState(0)
  const [pagesCreated, setPagesCreated] = useState<string[]>([])
  const [totalCostUsd, setTotalCostUsd] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [spinnerTick, setSpinnerTick] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const startTime = useRef(Date.now())
  const projectRoot = useRef(findProjectRoot())

  const spin = SPINNER[spinnerTick % SPINNER.length]!

  useEffect(() => {
    const id = setInterval(() => setSpinnerTick((t) => t + 1), 100)
    return () => clearInterval(id)
  }, [])

  // Walk
  useEffect(() => {
    if (mapState !== 'walking') return
    walkProject(projectRoot.current, setFileCount)
      .then((snap) => {
        setSnapshot(snap)
        setFileCount(snap.totalFiles)
        setMapState('planning')
      })
      .catch((err: unknown) => {
        setErrorMessage(`Walk failed: ${err instanceof Error ? err.message : String(err)}`)
        setMapState('error')
      })
  }, [])

  // Plan
  useEffect(() => {
    if (mapState !== 'planning' || !snapshot) return

    const run = async () => {
      const agent = createAxiomAgent(config)

      const keyFileSection = snapshot.keyFiles
        .slice(0, 6)
        .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 3000)}\n\`\`\``)
        .join('\n\n')

      const langSummary = topLanguages(snapshot.languages)

      const prompt = `You are analyzing a software project to create a wiki map. Study the structure below and output a JSON array of wiki pages to create.

## Project Stats
- Root: ${snapshot.root}
- Files: ${snapshot.totalFiles} total (${snapshot.totalTextFiles} text files)
- Size: ${formatSize(snapshot.totalSizeBytes)}
- Approx words: ${snapshot.totalWords.toLocaleString()}
- Languages: ${langSummary}

## Directory Tree
\`\`\`
${snapshot.tree}
\`\`\`

${keyFileSection ? `## Key Files\n${keyFileSection}` : ''}

## Instructions
Output ONLY a valid JSON array. Do not use any tools. Do not write prose before or after the JSON.

Each element must have:
- "title": string — wiki page title
- "category": "entities" | "concepts" | "analyses" | "sources"
- "description": string — what this page covers
- "paths": string[] — relative dirs/files to analyze (e.g. ["src/core/", "README.md"]). Use [] for the overview page.

Create 4–8 pages. Always include an overview page. Create pages for major modules, architecture, and tech stack. Keep it focused on what's actually in this codebase.

Output the JSON array now:`

      try {
        const result = await agent.generate([{ role: 'user', content: prompt }])
        const usage = (result as any).usage ?? null
        const inputTokens = usage?.inputTokens ?? usage?.promptTokens ?? 0
        const outputTokens = usage?.outputTokens ?? usage?.completionTokens ?? 0
        const cost = calcCost(config.provider, config.model, inputTokens, outputTokens)

        setPlanInputTokens(inputTokens)
        setPlanOutputTokens(outputTokens)
        setPlanCost(cost)

        const parsed = parsePlan(result.text ?? '')
        setPlan(parsed && parsed.length > 0 ? parsed : fallbackPlan(snapshot))
        setMapState('confirming')
      } catch (err: unknown) {
        setErrorMessage(`Planning failed: ${err instanceof Error ? err.message : String(err)}`)
        setMapState('error')
      }
    }

    void run()
  }, [mapState, snapshot])

  // Execute
  useEffect(() => {
    if (mapState !== 'executing' || !snapshot) return

    const run = async () => {
      const agent = createAxiomAgent(config)
      let runningCost = 0

      for (let i = 0; i < plan.length; i++) {
        const page = plan[i]!
        setCurrentPageIdx(i)
        setLog((prev) => [...prev, `[${i + 1}/${plan.length}] Writing "${page.title}"...`])

        const gathered = gatherFilesForPaths(snapshot, page.paths)

        const fileSection = gathered.length > 0
          ? gathered.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
          : '(no specific files — write based on the overall project structure)'

        const slug = page.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

        const prompt = `Write a wiki page titled "${page.title}" for this codebase.

Category: ${page.category}
Description: ${page.description}
Save path: ${page.category}/${slug}.md

${fileSection}

Use the write_page tool to save the page. Include proper YAML frontmatter (title, summary, tags, category, updatedAt). Write thorough content with cross-references to other pages where relevant. Overwrite any existing page at this path.`

        try {
          const result = await agent.generate(
            [{ role: 'user', content: prompt }],
            {
              onStepFinish: (step: any) => {
                if (step?.toolResults?.length > 0) {
                  setLog((prev) => [...prev, `  ✓ Saved ${page.category}/${slug}.md`])
                }
              },
            } as any,
          )

          const usage = (result as any).usage ?? null
          const inputTokens = usage?.inputTokens ?? usage?.promptTokens ?? 0
          const outputTokens = usage?.outputTokens ?? usage?.completionTokens ?? 0
          const cost = calcCost(config.provider, config.model, inputTokens, outputTokens)

          if (cost !== null) runningCost += cost
          setTotalCostUsd(runningCost)
          setPagesCreated((prev) => [...prev, `${page.category}/${slug}.md`])
        } catch (err: unknown) {
          setLog((prev) => [...prev, `  ⚠ Failed: ${err instanceof Error ? err.message : String(err)}`])
        }
      }

      // Update index
      try {
        await updateIndex(config.wikiDir)
        setLog((prev) => [...prev, '✓ Index updated'])
      } catch { /* non-fatal */ }

      setMapState('done')
    }

    void run()
  }, [mapState])

  useInput((_, key) => {
    if (mapState === 'confirming' && key.return) {
      setMapState('executing')
    }
  })

  // ── Render ────────────────────────────────────────────────────────────────

  if (!config) {
    return <Box padding={1}><Text color="red">No config found. Run axiom-wiki init first.</Text></Box>
  }

  if (mapState === 'walking') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Mapping project...</Text>
        <Box marginTop={1}>
          <Text color="gray">{spin} Scanning {projectRoot.current}</Text>
        </Box>
        {fileCount > 0 && (
          <Text color="gray">  {fileCount} files found</Text>
        )}
      </Box>
    )
  }

  if (mapState === 'planning') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Analyzing structure...</Text>
        <Box marginTop={1}>
          <Text color="gray">{spin} Asking LLM to plan the wiki map</Text>
        </Box>
        {snapshot && (
          <Box marginTop={1} flexDirection="column">
            <Text color="gray">  {snapshot.totalFiles} files · {formatSize(snapshot.totalSizeBytes)} · ~{snapshot.totalWords.toLocaleString()} words</Text>
            <Text color="gray">  {topLanguages(snapshot.languages)}</Text>
          </Box>
        )}
      </Box>
    )
  }

  if (mapState === 'confirming') {
    const estimatedExecCost = planCost !== null ? planCost * plan.length * 2 : null

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="green">✓ Analysis complete — here's the plan:</Text>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Pages to create ({plan.length}):</Text>
          {plan.map((p, i) => (
            <Text key={i} color="gray">
              {'  '}{i + 1}. <Text color="white">[{p.category}]</Text> {p.title}
            </Text>
          ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Planning call:  <Text color="white">in={planInputTokens} out={planOutputTokens}  cost={formatCost(planCost)}</Text></Text>
          <Text color="gray">Estimated total: <Text color="white">~{formatCost(estimatedExecCost)}</Text> ({plan.length} pages × ~{formatCost(planCost)})</Text>
        </Box>

        <Box marginTop={1}>
          <Text color="gray">Press <Text color="white">Enter</Text> to proceed · Ctrl+C to cancel</Text>
        </Box>
      </Box>
    )
  }

  if (mapState === 'executing') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Writing wiki pages... <Text color="gray">({currentPageIdx + 1}/{plan.length})</Text></Text>
        <Box marginTop={1} flexDirection="column">
          {log.slice(-10).map((line, i) => (
            <Text key={i} color={line.startsWith('  ✓') ? 'green' : line.startsWith('  ⚠') ? 'yellow' : 'gray'}>
              {line}
            </Text>
          ))}
          <Text color="gray">{spin}</Text>
        </Box>
        {totalCostUsd > 0 && (
          <Text color="gray">Cost so far: {formatCost(totalCostUsd)}</Text>
        )}
      </Box>
    )
  }

  if (mapState === 'done') {
    const elapsed = Date.now() - startTime.current
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="green">✓ Wiki map complete</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>{pagesCreated.length} pages created</Text>
          <Text color="gray">Total cost:  {formatCost(totalCostUsd)}</Text>
          <Text color="gray">Total time:  {formatDuration(elapsed)}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {pagesCreated.map((p, i) => (
            <Text key={i} color="gray">  ✓ {p}</Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Start with: <Text color="cyan">axiom-wiki query "how does this codebase work?"</Text></Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Press <Text color="white">Ctrl+C</Text> to exit</Text>
        </Box>
      </Box>
    )
  }

  // error
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="red">✗ Map failed</Text>
      <Box marginTop={1}>
        <Text color="red">{errorMessage}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Press <Text color="white">Ctrl+C</Text> to exit</Text>
      </Box>
    </Box>
  )
}
