import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import path from 'path'
import { getConfig } from '../../config/index.js'
import { createAxiomAgent } from '../../agent/index.js'
import { calcCost, appendUsageLog } from '../../core/usage.js'
import { updateIndex, appendLog } from '../../core/wiki.js'
import {
  walkProject, findProjectRoot, gatherFilesForPaths,
  buildProjectSummary, buildCompactSummary, topLanguages,
  type ProjectSnapshot,
} from '../../core/mapper.js'
import {
  loadMapState, saveMapState, getGitHeadHash, getGitChangedFiles,
  analyzeSync, groupChangedFilesByDir,
  type MapState, type MapPageEntry, type SyncAnalysis,
} from '../../core/sync.js'

interface Props {
  onExit?: () => void
}

type SyncScreenState = 'loading' | 'scanning' | 'confirming' | 'executing' | 'done' | 'error'

const SPINNER = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F']

function formatCost(cost: number | null): string {
  if (cost === null) return 'n/a'
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(3)}`
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function SyncScreen({ onExit }: Props) {
  const config = getConfig()!
  const mountedRef = useRef(true)

  const [screenState, setScreenState] = useState<SyncScreenState>('loading')
  const [mapState, setMapState] = useState<MapState | null>(null)
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null)
  const [analysis, setAnalysis] = useState<SyncAnalysis | null>(null)
  const [currentPageIdx, setCurrentPageIdx] = useState(0)
  const [pagesUpdated, setPagesUpdated] = useState<string[]>([])
  const [pagesFailed, setPagesFailed] = useState(0)
  const [totalCostUsd, setTotalCostUsd] = useState(0)
  const [totalInputTokens, setTotalInputTokens] = useState(0)
  const [totalOutputTokens, setTotalOutputTokens] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [spinnerTick, setSpinnerTick] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const [upToDate, setUpToDate] = useState(false)
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

  // Loading: read map state
  useEffect(() => {
    if (screenState !== 'loading') return
    const state = loadMapState(config.wikiDir)
    if (!state) {
      setErrorMessage('No map state found. Run /autowiki first to analyze the project.')
      setScreenState('error')
      return
    }
    setMapState(state)
    setScreenState('scanning')
  }, [])

  // Scanning: walk project + git diff
  useEffect(() => {
    if (screenState !== 'scanning' || !mapState) return

    const run = async () => {
      try {
        const snap = await walkProject(projectRoot.current, (count) => {
          if (mountedRef.current) setLog((prev) => {
            const last = prev[prev.length - 1]
            if (last?.startsWith('  Scanning')) return [...prev.slice(0, -1), `  Scanning... ${count} files`]
            return [...prev, `  Scanning... ${count} files`]
          })
        })
        if (!mountedRef.current) return
        setSnapshot(snap)

        let changedFiles: string[]
        if (mapState.gitCommitHash) {
          changedFiles = getGitChangedFiles(projectRoot.current, mapState.gitCommitHash)
          setLog((prev) => [...prev, `  ${changedFiles.length} files changed since last sync`])
        } else {
          changedFiles = snap.files.map((f) => f.relPath)
          setLog((prev) => [...prev, `  No git history — treating all ${changedFiles.length} files as changed`])
        }

        const result = analyzeSync(mapState, changedFiles, snap)
        if (!mountedRef.current) return
        setAnalysis(result)

        if (result.affectedPages.length === 0 && result.uncoveredDirs.length === 0) {
          setUpToDate(true)
          setScreenState('done')
        } else {
          setScreenState('confirming')
        }
      } catch (err: unknown) {
        if (!mountedRef.current) return
        setErrorMessage(`Scan failed: ${err instanceof Error ? err.message : String(err)}`)
        setScreenState('error')
      }
    }

    void run()
  }, [screenState, mapState])

  // Execute: re-generate affected pages
  useEffect(() => {
    if (screenState !== 'executing' || !snapshot || !analysis || !mapState) return

    const run = async () => {
      const agent = createAxiomAgent(config)
      let runningCost = 0
      let runningInputTokens = 0
      let runningOutputTokens = 0
      let failed = 0
      const today = new Date().toISOString().slice(0, 10)
      const pages = analysis.affectedPages

      const compactSummary = buildCompactSummary(snapshot)
      const allPagesListing = mapState.pages.map((p) =>
        `- [[${p.category}/${p.slug}]] — ${p.title}`
      ).join('\n')

      for (let i = 0; i < pages.length; i++) {
        if (!mountedRef.current) return

        const page = pages[i]!
        setCurrentPageIdx(i)
        setLog((prev) => [...prev, `[${i + 1}/${pages.length}] Updating "${page.title}"...`])

        const isOverview = page.paths.length === 0
        let fileSection: string
        if (isOverview) {
          fileSection = `## Project Context\n${buildProjectSummary(snapshot)}`
        } else {
          const gathered = gatherFilesForPaths(snapshot, page.paths)
          fileSection = gathered.length > 0
            ? gathered.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
            : '(no matching files found for the specified paths)'
        }

        const prompt = `Update the wiki page titled "${page.title}" for this codebase. The codebase has changed since this page was last written — regenerate it with current, accurate content.

${!isOverview ? `## Project context\n${compactSummary}\n` : ''}Category: ${page.category}
Description: ${page.description}
Save path: wiki/pages/${page.category}/${page.slug}.md

## All pages in this wiki (for cross-references)
${allPagesListing}

${fileSection}

Use the write_page tool to save the page at path "wiki/pages/${page.category}/${page.slug}.md".

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
          const result = await agent.generate(
            [{ role: 'user', content: prompt }],
            {
              onStepFinish: (step: any) => {
                try {
                  if (step?.toolResults?.length > 0) {
                    if (mountedRef.current) {
                      setLog((prev) => [...prev, `  saved ${page.category}/${page.slug}.md`])
                    }
                  }
                } catch { /* never crash the agent loop */ }
              },
            } as any,
          )
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
          setPagesUpdated((prev) => [...prev, `${page.category}/${page.slug}.md`])

          try {
            appendUsageLog(config.wikiDir, {
              timestamp: new Date().toISOString(),
              operation: 'sync',
              source: page.slug,
              provider: config.provider,
              model: config.model,
              inputTokens,
              outputTokens,
              costUsd: cost,
            })
          } catch { /* non-fatal */ }
        } catch (err: unknown) {
          failed++
          if (mountedRef.current) {
            setPagesFailed(failed)
            setLog((prev) => [...prev, `  failed: ${err instanceof Error ? err.message : String(err)}`])
          }
        }
      }

      if (!mountedRef.current) return

      // Update index, log, and map state
      try {
        await updateIndex(config.wikiDir)
        setLog((prev) => [...prev, 'Index updated'])
      } catch { /* non-fatal */ }

      try {
        await appendLog(
          config.wikiDir,
          `sync: updated ${pages.length - failed} pages`,
          'sync',
        )
      } catch { /* non-fatal */ }

      try {
        const updatedState: MapState = {
          ...mapState,
          lastSyncAt: new Date().toISOString(),
          gitCommitHash: getGitHeadHash(projectRoot.current),
        }
        saveMapState(config.wikiDir, updatedState)
      } catch { /* non-fatal */ }

      setScreenState('done')
    }

    void run()
  }, [screenState])

  useInput((_, key) => {
    if (screenState === 'confirming' && key.return) {
      setScreenState('executing')
    }
    if (screenState === 'done' && onExit && key.return) {
      onExit()
    }
    if (screenState === 'error' && onExit && key.return) {
      onExit()
    }
  })

  // ── Render ────────────────────────────────────────────────────────────────

  if (!config) {
    return <Box padding={1}><Text color="red">No config found. Run axiom-wiki init first.</Text></Box>
  }

  if (screenState === 'loading') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="gray">{spin} Loading map state...</Text>
      </Box>
    )
  }

  if (screenState === 'scanning') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Checking for changes...</Text>
        <Box marginTop={1} flexDirection="column">
          {log.slice(-5).map((line, i) => (
            <Text key={i} color="gray">{line}</Text>
          ))}
          <Text color="gray">{spin}</Text>
        </Box>
      </Box>
    )
  }

  if (screenState === 'confirming' && analysis) {
    const changedDirs = groupChangedFilesByDir(analysis.changedFiles)
    const estimatedCost = totalCostUsd > 0
      ? totalCostUsd
      : (analysis.affectedPages.length * 0.003)

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="green">Changes detected since last sync:</Text>

        <Box marginTop={1} flexDirection="column">
          <Text color="gray">  {analysis.changedFiles.length} files changed:</Text>
          {changedDirs.slice(0, 6).map((d, i) => (
            <Text key={i} color="gray">    {d.dir}/  {d.count} files</Text>
          ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Pages to update ({analysis.affectedPages.length} of {mapState!.pages.length}):</Text>
          {analysis.affectedPages.map((p, i) => (
            <Text key={i} color="gray">
              {'  '}{i + 1}. <Text color="white">[{p.category}]</Text> {p.title}
              {p.paths.length === 0 && <Text color="gray" dimColor> (always refreshed)</Text>}
            </Text>
          ))}
        </Box>

        {analysis.unchangedPages.length > 0 && (
          <Box marginTop={1}>
            <Text color="gray" dimColor>  Unchanged: {analysis.unchangedPages.map((p) => p.title).join(', ')}</Text>
          </Box>
        )}

        {analysis.stalePages.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow">  Stale pages (source paths removed):</Text>
            {analysis.stalePages.map((p, i) => (
              <Text key={i} color="yellow">    {p.title} ({p.paths.join(', ')})</Text>
            ))}
          </Box>
        )}

        {analysis.uncoveredDirs.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text color="cyan">  New directories not covered by any page:</Text>
            {analysis.uncoveredDirs.map((d, i) => (
              <Text key={i} color="cyan">    {d}/</Text>
            ))}
            <Text color="gray" dimColor>  Run /autowiki to add pages for these.</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color="gray">Estimated cost: <Text color="white">~{formatCost(estimatedCost)}</Text></Text>
        </Box>

        <Box marginTop={1}>
          <Text color="gray">Press <Text color="white">Enter</Text> to proceed · Ctrl+C to cancel</Text>
        </Box>
      </Box>
    )
  }

  if (screenState === 'executing') {
    const total = analysis?.affectedPages.length ?? 0
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Updating wiki pages... <Text color="gray">({currentPageIdx + 1}/{total})</Text></Text>
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

  if (screenState === 'done') {
    if (upToDate) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color="green">Wiki is up to date</Text>
          <Text color="gray">No changes detected since last sync.</Text>
          <Box marginTop={1}>
            <Text color="gray">Press <Text color="white">{onExit ? 'Enter' : 'Ctrl+C'}</Text> to {onExit ? 'go back' : 'exit'}</Text>
          </Box>
        </Box>
      )
    }

    const elapsed = Date.now() - startTime.current
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={pagesFailed > 0 ? 'yellow' : 'green'}>
          Sync complete{pagesFailed > 0 ? ` (${pagesFailed} failed)` : ''}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>{pagesUpdated.length} pages updated</Text>
          <Text color="gray">Tokens: in={totalInputTokens} out={totalOutputTokens}</Text>
          <Text color="gray">Total cost:  {formatCost(totalCostUsd)}</Text>
          <Text color="gray">Total time:  {formatDuration(elapsed)}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {pagesUpdated.map((p, i) => (
            <Text key={i} color="gray">  {p}</Text>
          ))}
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
      <Text bold color="red">Sync failed</Text>
      <Box marginTop={1}>
        <Text color="red">{errorMessage}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Press <Text color="white">{onExit ? 'Enter' : 'Ctrl+C'}</Text> to {onExit ? 'go back' : 'exit'}</Text>
      </Box>
    </Box>
  )
}
