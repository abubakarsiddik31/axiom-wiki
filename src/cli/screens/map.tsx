import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import path from 'path'
import { getConfig } from '../../config/index.js'
import { createAxiomAgent } from '../../agent/index.js'
import { calcCost, appendUsageLog } from '../../core/usage.js'
import { updateIndex, appendLog } from '../../core/wiki.js'
import { walkProject, findProjectRoot, gatherFilesForPaths, buildProjectSummary, buildCompactSummary, topLanguages, type ProjectSnapshot } from '../../core/mapper.js'
import { saveMapState, getGitHeadHash, type MapState } from '../../core/sync.js'
import { withRetry, classifyError, friendlyErrorMessage } from '../../core/retry.js'
import { getContextWindow, estimateTokens } from '../../config/models.js'

interface Props {
  onExit?: () => void
}

type MapScreenState = 'walking' | 'planning' | 'confirming' | 'executing' | 'done' | 'error'

const VALID_CATEGORIES = new Set(['entities', 'concepts', 'analyses', 'sources'])

interface PagePlan {
  title: string
  category: string
  description: string
  paths: string[]
}

const SPINNER = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F']

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
      category: VALID_CATEGORIES.has(item.category) ? item.category : 'analyses',
      description: item.description || '',
      paths: Array.isArray(item.paths) ? item.paths : [],
    }))
  } catch {
    return null
  }
}

function fallbackPlan(): PagePlan[] {
  return [{
    title: 'Codebase Overview',
    category: 'analyses',
    description: 'Overview of the project structure, tech stack, and key components.',
    paths: [],
  }]
}

function buildPageSlugs(plan: PagePlan[]): string[] {
  const seen = new Map<string, number>()
  return plan.map((p) => {
    let slug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!slug) slug = 'page'
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    return count > 0 ? `${slug}-${count}` : slug
  })
}

export function MapScreen({ onExit }: Props) {
  const config = getConfig()!
  const mountedRef = useRef(true)

  const [mapState, setMapState] = useState<MapScreenState>('walking')
  const [fileCount, setFileCount] = useState(0)
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null)
  const [plan, setPlan] = useState<PagePlan[]>([])
  const [planCost, setPlanCost] = useState<number | null>(null)
  const [planInputTokens, setPlanInputTokens] = useState(0)
  const [planOutputTokens, setPlanOutputTokens] = useState(0)
  const [currentPageIdx, setCurrentPageIdx] = useState(0)
  const [pagesCreated, setPagesCreated] = useState<string[]>([])
  const [pagesFailed, setPagesFailed] = useState(0)
  const [totalCostUsd, setTotalCostUsd] = useState(0)
  const [totalInputTokens, setTotalInputTokens] = useState(0)
  const [totalOutputTokens, setTotalOutputTokens] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [spinnerTick, setSpinnerTick] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const [usedFallback, setUsedFallback] = useState(false)
  const [failedPages, setFailedPages] = useState<Array<{ title: string; reason: string }>>([])
  const startTime = useRef(Date.now())
  const projectRoot = useRef(findProjectRoot())

  const spin = SPINNER[spinnerTick % SPINNER.length]!

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const id = setInterval(() => setSpinnerTick((t) => t + 1), 100)
    return () => clearInterval(id)
  }, [])

  // Walk
  useEffect(() => {
    if (mapState !== 'walking') return
    walkProject(projectRoot.current, (count) => {
      if (mountedRef.current) setFileCount(count)
    })
      .then((snap) => {
        if (!mountedRef.current) return
        setSnapshot(snap)
        setFileCount(snap.totalFiles)
        setMapState('planning')
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return
        setErrorMessage(`Walk failed: ${err instanceof Error ? err.message : String(err)}`)
        setMapState('error')
      })
  }, [])

  // Plan
  useEffect(() => {
    if (mapState !== 'planning' || !snapshot) return

    const run = async () => {
      const agent = createAxiomAgent(config)
      const projectSummary = buildProjectSummary(snapshot)

      const prompt = `You are analyzing a software project to create a wiki map. Study the structure below and output a JSON array of wiki pages to create.

${projectSummary}

## Instructions
Output ONLY a valid JSON array. Do not use any tools. Do not write prose before or after the JSON.

Each element must have:
- "title": string — wiki page title
- "category": "entities" | "concepts" | "analyses" (use "analyses" for overviews and architecture; "entities" for modules and components; "concepts" for patterns and tech stack)
- "description": string — 1-2 sentences about what this page should cover
- "paths": string[] — relative dirs/files to analyze (e.g. ["src/core/", "README.md"]). Use [] for the overview page ONLY.

Rules:
- Create 4-8 pages. Always include one overview page (category "analyses", paths []).
- Every non-overview page MUST have at least one path in "paths".
- Paths should use trailing "/" for directories (e.g. "src/core/" not "src/core").
- Focus on what's actually in this codebase — no generic pages.

Output the JSON array now:`

      try {
        const result = await withRetry(() => agent.generate([{ role: 'user', content: prompt }]))
        if (!mountedRef.current) return

        const usage = (result as any).usage ?? null
        const inputTokens = usage?.inputTokens ?? usage?.promptTokens ?? 0
        const outputTokens = usage?.outputTokens ?? usage?.completionTokens ?? 0
        const cost = calcCost(config.provider, config.model, inputTokens, outputTokens)

        setPlanInputTokens(inputTokens)
        setPlanOutputTokens(outputTokens)
        setPlanCost(cost)

        const parsed = parsePlan(result.text ?? '')
        if (parsed && parsed.length > 0) {
          setPlan(parsed)
        } else {
          setPlan(fallbackPlan())
          setUsedFallback(true)
          setLog((prev) => [...prev, 'LLM returned invalid plan JSON, using fallback plan'])
        }
        setMapState('confirming')
      } catch (err: unknown) {
        if (!mountedRef.current) return
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
      let runningInputTokens = 0
      let runningOutputTokens = 0
      let failed = 0
      const slugs = buildPageSlugs(plan)
      const today = new Date().toISOString().slice(0, 10)

      const compactSummary = buildCompactSummary(snapshot)

      const allPagesListing = plan.map((p, j) =>
        `- [[${p.category}/${slugs[j]}]] — ${p.title}`
      ).join('\n')

      for (let i = 0; i < plan.length; i++) {
        if (!mountedRef.current) return

        const page = plan[i]!
        const slug = slugs[i]!
        setCurrentPageIdx(i)
        setLog((prev) => [...prev, `[${i + 1}/${plan.length}] Writing "${page.title}"...`])

        const isOverview = page.paths.length === 0

        // Calculate available token budget for file content
        const contextWindow = getContextWindow(config.provider, config.model)
        const systemPromptTokens = 3000
        const templateTokens = 500
        const compactSummaryTokens = estimateTokens(compactSummary)
        const listingTokens = estimateTokens(allPagesListing)
        const responseReserve = 4000
        const availableTokens = contextWindow - systemPromptTokens - templateTokens - compactSummaryTokens - listingTokens - responseReserve
        const maxContentBytes = Math.max(4096, Math.floor(availableTokens * 3.5))

        let fileSection: string
        if (isOverview) {
          fileSection = `## Project Context\n${buildProjectSummary(snapshot)}`
        } else {
          const gathered = gatherFilesForPaths(snapshot, page.paths, maxContentBytes)
          fileSection = gathered.length > 0
            ? gathered.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
            : '(no matching files found for the specified paths)'
        }

        const prompt = `Write a wiki page titled "${page.title}" for this codebase.

${!isOverview ? `## Project context\n${compactSummary}\n` : ''}Category: ${page.category}
Description: ${page.description}
Save path: wiki/pages/${page.category}/${slug}.md

## All pages in this wiki (for cross-references)
${allPagesListing}

${fileSection}

Use the write_page tool to save the page at path "wiki/pages/${page.category}/${slug}.md".

Include YAML frontmatter:
---
title: "${page.title}"
summary: "<one-sentence description>"
tags: [<relevant tags>]
category: ${page.category}
updatedAt: "${today}"
---

Write thorough, accurate content based on the actual code shown above. For cross-references to other wiki pages, use the [[category/slug]] syntax matching the paths listed above. Do not invent content that isn't supported by the code.`

        try {
          const stepFinish = (step: any) => {
            try {
              if (step?.toolResults?.length > 0) {
                if (mountedRef.current) {
                  setLog((prev) => [...prev, `  saved ${page.category}/${slug}.md`])
                }
              }
            } catch { /* never crash the agent loop */ }
          }
          const result = await withRetry(() => agent.generate(
            [{ role: 'user', content: prompt }],
            { onStepFinish: stepFinish } as any,
          ))
          if (!mountedRef.current) return

          const usage = (result as any).usage ?? null
          const inputTokens = usage?.inputTokens ?? usage?.promptTokens ?? 0
          const outputTokens = usage?.outputTokens ?? usage?.completionTokens ?? 0
          const cost = calcCost(config.provider, config.model, inputTokens, outputTokens)

          if (cost !== null) runningCost += cost
          runningInputTokens += inputTokens
          runningOutputTokens += outputTokens
          setTotalCostUsd(runningCost)
          setTotalInputTokens(runningInputTokens)
          setTotalOutputTokens(runningOutputTokens)
          setPagesCreated((prev) => [...prev, `${page.category}/${slug}.md`])

          try {
            appendUsageLog(config.wikiDir, {
              timestamp: new Date().toISOString(),
              operation: 'map',
              source: slug,
              provider: config.provider,
              model: config.model,
              inputTokens,
              outputTokens,
              costUsd: cost,
            })
          } catch { /* non-fatal */ }
        } catch (err: unknown) {
          const errorClass = classifyError(err)

          // Context limit: retry once with halved content budget
          if (errorClass === 'context_limit' && !isOverview) {
            try {
              const halvedBytes = Math.max(2048, Math.floor(maxContentBytes / 2))
              const gathered = gatherFilesForPaths(snapshot, page.paths, halvedBytes)
              const reducedFileSection = gathered.length > 0
                ? gathered.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
                : '(no matching files found for the specified paths)'
              const reducedPrompt = prompt.replace(fileSection, reducedFileSection)
              setLog((prev) => [...prev, `  context limit — retrying with reduced content...`])
              const stepFinish2 = (step: any) => {
                try {
                  if (step?.toolResults?.length > 0 && mountedRef.current) {
                    setLog((prev) => [...prev, `  saved ${page.category}/${slug}.md`])
                  }
                } catch { /* never crash */ }
              }
              const retryResult = await withRetry(() => agent.generate(
                [{ role: 'user', content: reducedPrompt }],
                { onStepFinish: stepFinish2 } as any,
              ))
              if (!mountedRef.current) return

              const retryUsage = (retryResult as any).usage ?? null
              const retryIn = retryUsage?.inputTokens ?? retryUsage?.promptTokens ?? 0
              const retryOut = retryUsage?.outputTokens ?? retryUsage?.completionTokens ?? 0
              const retryCost = calcCost(config.provider, config.model, retryIn, retryOut)
              if (retryCost !== null) runningCost += retryCost
              runningInputTokens += retryIn
              runningOutputTokens += retryOut
              setTotalCostUsd(runningCost)
              setTotalInputTokens(runningInputTokens)
              setTotalOutputTokens(runningOutputTokens)
              setPagesCreated((prev) => [...prev, `${page.category}/${slug}.md`])
              // Skip the failure path below
              continue
            } catch {
              // Retry also failed — fall through to failure handling
            }
          }

          // Auth/billing: abort entire loop
          if (errorClass === 'auth' || errorClass === 'billing') {
            failed++
            const reason = friendlyErrorMessage(errorClass)
            if (mountedRef.current) {
              setPagesFailed(failed)
              setFailedPages((prev) => [...prev, { title: page.title, reason }])
              setLog((prev) => [...prev, `  failed: ${reason}`, 'Aborting — fix your API key or billing to continue.'])
            }
            break
          }

          failed++
          const reason = errorClass !== 'unknown'
            ? friendlyErrorMessage(errorClass)
            : (err instanceof Error ? err.message : String(err))
          if (mountedRef.current) {
            setPagesFailed(failed)
            setFailedPages((prev) => [...prev, { title: page.title, reason }])
            setLog((prev) => [...prev, `  failed: ${reason}`])
          }
        }
      }

      if (!mountedRef.current) return

      // Update index and log
      try {
        await updateIndex(config.wikiDir)
        setLog((prev) => [...prev, 'Index updated'])
      } catch { /* non-fatal */ }

      try {
        await appendLog(
          config.wikiDir,
          `map: created ${plan.length - failed} pages from project at ${path.basename(projectRoot.current)}`,
          'map',
        )
      } catch { /* non-fatal */ }

      try {
        const mapStateData: MapState = {
          version: 1 as const,
          createdAt: new Date().toISOString(),
          lastSyncAt: new Date().toISOString(),
          gitCommitHash: getGitHeadHash(projectRoot.current),
          pages: plan.map((p, idx) => ({
            slug: slugs[idx]!,
            title: p.title,
            category: p.category,
            description: p.description,
            paths: p.paths,
          })),
        }
        saveMapState(config.wikiDir, mapStateData)
      } catch { /* non-fatal */ }

      setMapState('done')
    }

    void run()
  }, [mapState])

  useInput((_, key) => {
    if (mapState === 'confirming' && key.return) {
      setMapState('executing')
    }
    if (mapState === 'done' && onExit && key.return) {
      onExit()
    }
    if (mapState === 'error' && onExit && key.return) {
      onExit()
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
    const estimatedExecCost = planCost !== null ? planCost * plan.length * 3 : null

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="green">Analysis complete — here's the plan:</Text>
        {usedFallback && (
          <Text color="yellow">⚠ LLM returned invalid plan — using fallback. Cancel and retry for a better plan.</Text>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text bold>Pages to create ({plan.length}):</Text>
          {plan.map((p, i) => (
            <Text key={i} color="gray">
              {'  '}{i + 1}. <Text color="white">[{p.category}]</Text> {p.title}
              {p.paths.length > 0 && <Text color="gray" dimColor> ({p.paths.join(', ')})</Text>}
            </Text>
          ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Planning: in={planInputTokens} out={planOutputTokens} cost={formatCost(planCost)}</Text>
          <Text color="gray">Estimated total: <Text color="white">~{formatCost(estimatedExecCost)}</Text></Text>
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
            <Text key={i} color={line.startsWith('  saved') ? 'green' : line.startsWith('  failed') ? 'yellow' : 'gray'}>
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
    const grandTotalCost = totalCostUsd + (planCost ?? 0)
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={pagesFailed > 0 ? 'yellow' : 'green'}>
          Wiki map complete{pagesFailed > 0 ? ` (${pagesFailed} failed)` : ''}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>{pagesCreated.length} pages created</Text>
          <Text color="gray">Tokens: in={totalInputTokens + planInputTokens} out={totalOutputTokens + planOutputTokens}</Text>
          <Text color="gray">Total cost:  {formatCost(grandTotalCost)}</Text>
          <Text color="gray">Total time:  {formatDuration(elapsed)}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {pagesCreated.map((p, i) => (
            <Text key={i} color="green">  + {p}</Text>
          ))}
          {failedPages.map((p, i) => (
            <Text key={`f-${i}`} color="red">  ✗ {p.title}: {p.reason}</Text>
          ))}
        </Box>
        {failedPages.length > 0 && (
          <Box marginTop={1}>
            <Text color="yellow" dimColor>Run <Text color="cyan">axiom-wiki autowiki</Text> again to retry failed pages.</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color="gray">Start with: <Text color="cyan">axiom-wiki query "how does this codebase work?"</Text></Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Press <Text color="white">{onExit ? 'Enter' : 'Ctrl+C'}</Text> to {onExit ? 'go back' : 'exit'}</Text>
        </Box>
      </Box>
    )
  }

  // error
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="red">Map failed</Text>
      <Box marginTop={1}>
        <Text color="red">{errorMessage}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Press <Text color="white">{onExit ? 'Enter' : 'Ctrl+C'}</Text> to {onExit ? 'go back' : 'exit'}</Text>
      </Box>
    </Box>
  )
}
