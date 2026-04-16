import fs from 'fs'
import path from 'path'
import { Agent } from '@mastra/core/agent'
import { resolveModel } from '../agent/index.js'
import { pageCoversFile, markPageVerified, getGitHeadHash, type MapPageEntry, type MapState } from './sync.js'
import { readPage, writePage, updateIndex, updateMOC, appendLog } from './wiki.js'
import type { AxiomConfig } from '../config/index.js'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export interface Tier2Options {
  maxCostUsd?: number
  maxPages?: number
  onLog?: (msg: string) => void
}

export interface Tier2Result {
  pagesUpdated: string[]
  pagesSkipped: string[]
  costUsd: number
  inputTokens: number
  outputTokens: number
}

export async function applyTier2Updates(
  config: AxiomConfig,
  wikiDir: string,
  affectedPages: MapPageEntry[],
  changedFiles: string[],
  projectRoot: string,
  mapState: MapState,
  opts?: Tier2Options,
): Promise<Tier2Result> {
  const maxCost = opts?.maxCostUsd ?? 0.50
  const maxPages = opts?.maxPages ?? 5
  const log = opts?.onLog ?? (() => {})

  const result: Tier2Result = {
    pagesUpdated: [],
    pagesSkipped: [],
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  }

  // Sort by lowest confidence first
  const sorted = [...affectedPages].sort((a, b) => (a._confidence ?? 1) - (b._confidence ?? 1))
  const toProcess = sorted.slice(0, maxPages)
  const skipped = sorted.slice(maxPages)
  result.pagesSkipped = skipped.map((p) => p.slug)

  const model = resolveModel(config)

  // Create a minimal tool for the agent to return updated content
  const return_updated_page = createTool({
    id: 'return_updated_page',
    description: 'Return the updated wiki page content',
    inputSchema: z.object({
      content: z.string().describe('The full updated markdown page content including frontmatter'),
    }),
    execute: async (input) => input.content,
  })

  for (const page of toProcess) {
    if (result.costUsd >= maxCost) {
      result.pagesSkipped.push(page.slug)
      log(`Cost limit reached ($${result.costUsd.toFixed(4)} >= $${maxCost}), skipping ${page.slug}`)
      continue
    }

    log(`Updating wiki page: ${page.slug}`)

    // Read existing wiki page
    const pagePath = `wiki/pages/${page.category}/${page.slug}.md`
    let existingContent: string
    try {
      existingContent = await readPage(wikiDir, pagePath)
    } catch {
      result.pagesSkipped.push(page.slug)
      continue
    }

    // Read changed files that this page covers
    const relevantFiles = changedFiles.filter((f) => pageCoversFile(page, f))
    const fileContents: Array<{ path: string; content: string }> = []

    for (const filePath of relevantFiles) {
      const abs = path.join(projectRoot, filePath)
      try {
        if (!fs.existsSync(abs)) continue
        const stat = fs.statSync(abs)
        if (stat.size > 100_000) continue
        const content = fs.readFileSync(abs, 'utf-8')
        fileContents.push({ path: filePath, content })
      } catch {
        // Skip unreadable files
      }
    }

    if (fileContents.length === 0) {
      result.pagesSkipped.push(page.slug)
      continue
    }

    // Build focused prompt
    const filesBlock = fileContents
      .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 20_000)}\n\`\`\``)
      .join('\n\n')

    const prompt = `You are updating a wiki page for a software project. The source code has changed and the wiki page may be stale.

## Current Wiki Page
\`\`\`markdown
${existingContent}
\`\`\`

## Changed Source Files
${filesBlock}

## Instructions
- Update ONLY what is stale or inaccurate based on the changed files
- Preserve the existing structure, frontmatter, and any content that is still accurate
- Update the \`updatedAt\` field in frontmatter to today's date
- Call return_updated_page with the full updated markdown page content
- If nothing needs changing, call return_updated_page with the page exactly as-is`

    try {
      const agent = new Agent({
        id: 'axiom-tier2-sync',
        name: 'axiom-tier2-sync',
        instructions: 'You update wiki pages to reflect code changes. Be precise and minimal in your updates.',
        model,
        tools: { return_updated_page },
      })

      const response = await agent.generate([{ role: 'user', content: prompt }])

      const updatedContent = extractUpdatedContent(response)
      if (updatedContent && updatedContent !== existingContent) {
        await writePage(wikiDir, pagePath, updatedContent)
        result.pagesUpdated.push(page.slug)
      }

      const commitHash = getGitHeadHash(projectRoot) ?? ''
      markPageVerified(mapState, page.slug, commitHash)

      // Track usage from response
      const usage = (response as any).usage
      const iterInput = usage?.promptTokens ?? usage?.input_tokens ?? 0
      const iterOutput = usage?.completionTokens ?? usage?.output_tokens ?? 0
      result.inputTokens += iterInput
      result.outputTokens += iterOutput
      // Rough cost estimate per iteration (Gemini Flash pricing)
      result.costUsd += (iterInput * 0.000000075) + (iterOutput * 0.0000003)
    } catch (err) {
      log(`Failed to update ${page.slug}: ${err instanceof Error ? err.message : String(err)}`)
      result.pagesSkipped.push(page.slug)
    }
  }

  // Post-update maintenance — wrapped in try/catch so partial results are still returned
  if (result.pagesUpdated.length > 0) {
    try {
      await updateIndex(wikiDir)
      await updateMOC(wikiDir)
      await appendLog(wikiDir, `incremental-sync: updated ${result.pagesUpdated.join(', ')}`, 'sync')
    } catch (err) {
      log(`Post-update maintenance failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return result
}

function extractUpdatedContent(response: any): string | null {
  // Check tool results first — the agent may have called return_updated_page
  const toolResults = response.toolResults ?? response.tool_results
  if (Array.isArray(toolResults)) {
    for (const tr of toolResults) {
      const content = tr?.result ?? tr?.content
      if (typeof content === 'string' && content.includes('---')) {
        return content.trim()
      }
    }
  }

  // Fall back to text response
  const text = response.text ?? ''
  if (!text) return null

  // If wrapped in markdown code fence, extract
  const fenceMatch = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/m)
  if (fenceMatch) return fenceMatch[1].trim()

  // Only accept text that looks like a wiki page (has frontmatter)
  if (text.startsWith('---')) return text.trim()

  return null
}
