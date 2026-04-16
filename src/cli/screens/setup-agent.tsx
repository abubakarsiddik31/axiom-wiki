import React, { useState, useEffect } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import fs from 'fs'
import path from 'path'
import { getConfig } from '../../config/index.js'
import { getAgentTemplates } from '../../templates/agent-instructions.js'
import { deriveProjectRoot } from '../../core/sync.js'

type Phase = 'selecting' | 'applying' | 'done'

interface ApplyResult {
  agent: string
  filename: string
  action: 'created' | 'appended' | 'skipped'
}

const SECTION_MARKER = '## Axiom Wiki Integration'

export function SetupAgentScreen() {
  const { exit } = useApp()
  const config = getConfig()
  const templates = getAgentTemplates()
  const [phase, setPhase] = useState<Phase>('selecting')
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<ApplyResult[]>([])

  const projectRoot = config
    ? deriveProjectRoot(config.wikiDir) ?? process.cwd()
    : process.cwd()

  useInput((input, key) => {
    if (phase !== 'selecting') return

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1))
    } else if (key.downArrow) {
      setCursor((c) => Math.min(templates.length - 1, c + 1))
    } else if (input === ' ') {
      setSelected((prev) => {
        const next = new Set(prev)
        const agent = templates[cursor].agent
        if (next.has(agent)) next.delete(agent)
        else next.add(agent)
        return next
      })
    } else if (key.return) {
      if (selected.size === 0) {
        exit()
        return
      }
      setPhase('applying')
    } else if (key.escape) {
      exit()
    }
  })

  useEffect(() => {
    if (phase !== 'applying') return

    const applyResults: ApplyResult[] = []

    for (const template of templates) {
      if (!selected.has(template.agent)) continue

      const filePath = path.join(projectRoot, template.filename)
      const exists = fs.existsSync(filePath)

      if (exists) {
        const content = fs.readFileSync(filePath, 'utf-8')
        if (content.includes(SECTION_MARKER)) {
          applyResults.push({ agent: template.agent, filename: template.filename, action: 'skipped' })
          continue
        }
        // Append to existing file
        fs.appendFileSync(filePath, '\n\n' + template.instructions)
        applyResults.push({ agent: template.agent, filename: template.filename, action: 'appended' })
      } else {
        // Create new file
        fs.writeFileSync(filePath, template.instructions)
        applyResults.push({ agent: template.agent, filename: template.filename, action: 'created' })
      }
    }

    setResults(applyResults)
    setPhase('done')
    setTimeout(exit, 200)
  }, [phase])

  if (phase === 'selecting') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Axiom Wiki — Setup Agent Instructions</Text>
        <Text color="gray">Select which AI agents you work with (Space to toggle, Enter to apply):</Text>
        <Box marginTop={1} flexDirection="column">
          {templates.map((t, i) => {
            const isSelected = selected.has(t.agent)
            const isCursor = i === cursor
            const filePath = path.join(projectRoot, t.filename)
            const exists = fs.existsSync(filePath)
            const hasInstructions = exists && fs.readFileSync(filePath, 'utf-8').includes(SECTION_MARKER)

            return (
              <Box key={t.agent}>
                <Text color={isCursor ? 'cyan' : undefined}>
                  {isCursor ? '>' : ' '} [{isSelected ? 'x' : ' '}] {t.displayName}
                  <Text color="gray"> ({t.filename})</Text>
                  {hasInstructions && <Text color="yellow"> (already configured)</Text>}
                  {exists && !hasInstructions && <Text color="green"> (will append)</Text>}
                  {!exists && <Text color="blue"> (will create)</Text>}
                </Text>
              </Box>
            )
          })}
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Esc to cancel</Text>
        </Box>
      </Box>
    )
  }

  if (phase === 'applying') {
    return (
      <Box padding={1}>
        <Text color="gray">Applying...</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Done!</Text>
      <Box marginTop={1} flexDirection="column">
        {results.map((r) => (
          <Box key={r.agent}>
            <Text>
              {r.action === 'created' && <Text color="green">Created</Text>}
              {r.action === 'appended' && <Text color="cyan">Appended to</Text>}
              {r.action === 'skipped' && <Text color="yellow">Already configured in</Text>}
              {' '}{r.filename}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
