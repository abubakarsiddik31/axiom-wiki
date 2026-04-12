import React from 'react'
import { Box, Text } from 'ink'

export interface SlashCommand {
  name: string       // e.g. 'ingest'
  args?: string      // e.g. '[file]'
  desc: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'ingest',   args: '[file|url]', desc: 'Ingest a file, URL, or scan raw/' },
  { name: 'autowiki',                     desc: 'Auto-generate wiki from a project folder' },
  { name: 'sync',                         desc: 'Update wiki pages for codebase changes' },
  { name: 'watch',                        desc: 'Watch raw/ and auto-ingest new files' },
  { name: 'clip',     args: '[url]',      desc: 'Clip a URL to raw/ without ingesting' },
  { name: 'sources',                      desc: 'Browse and manage ingested sources' },
  { name: 'review',                       desc: 'Review and resolve contradictions' },
  { name: 'graph',                        desc: 'Visualize the wiki page graph' },
  { name: 'status',                       desc: 'Show wiki statistics' },
  { name: 'model',                        desc: 'Switch provider or model' },
  { name: 'lint',                         desc: 'Wiki health check' },
  { name: 'help',                         desc: 'Show all commands' },
]

interface Props {
  selectedIndex: number      // controlled from parent
  onSelect: (cmd: SlashCommand) => void
  matches: SlashCommand[]
}

export function SlashMenu({ selectedIndex, matches }: Props) {
  if (matches.length === 0) return null

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginBottom={1}
    >
      {matches.map((cmd, i) => {
        const active = i === selectedIndex
        const label = `/${cmd.name}${cmd.args ? ' ' + cmd.args : ''}`
        return (
          <Box key={cmd.name}>
            <Text color={active ? 'cyan' : 'white'} bold={active}>
              {active ? '▶ ' : '  '}{label.padEnd(20)}
            </Text>
            <Text color={active ? 'white' : 'gray'} dimColor={!active}>{cmd.desc}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

/** Filter commands by current input */
export function filterCommands(input: string): SlashCommand[] {
  const query = input.slice(1).toLowerCase()
  return SLASH_COMMANDS.filter((c) =>
    c.name.startsWith(query) || c.desc.toLowerCase().includes(query)
  )
}

// Hidden aliases — old names that still work but don't appear in the menu
const COMMAND_ALIASES: Record<string, string> = { map: 'autowiki' }

/** Parse "/ingest notes.md" → { command: 'ingest', arg: 'notes.md' } */
export function parseSlash(input: string): { command: string; arg: string } | null {
  if (!input.startsWith('/')) return null
  const [raw, ...rest] = input.slice(1).trim().split(/\s+/)
  let command = raw?.toLowerCase() ?? ''
  // Resolve aliases
  if (COMMAND_ALIASES[command]) command = COMMAND_ALIASES[command]
  if (!SLASH_COMMANDS.find((c) => c.name === command)) return null
  return { command, arg: rest.join(' ') }
}
