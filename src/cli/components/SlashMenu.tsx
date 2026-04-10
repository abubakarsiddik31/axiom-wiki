import React from 'react'
import { Box, Text } from 'ink'

export interface SlashCommand {
  name: string       // e.g. 'ingest'
  args?: string      // e.g. '[file]'
  desc: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'ingest',   args: '[file]', desc: 'Ingest a source file into the wiki' },
  { name: 'watch',                    desc: 'Watch raw/ and auto-ingest new files' },
  { name: 'clip',     args: '[url]',  desc: 'Clip a URL and save it to raw/' },
  { name: 'sources',                  desc: 'Browse and manage ingested sources' },
  { name: 'review',                   desc: 'Review and resolve contradictions' },
  { name: 'status',                   desc: 'Show wiki statistics' },
  { name: 'model',                    desc: 'Switch provider or model' },
  { name: 'lint',                     desc: 'Wiki health check' },
  { name: 'help',                     desc: 'Show all commands' },
]

interface Props {
  input: string   // current text input (starts with '/')
}

export function SlashMenu({ input }: Props) {
  const query = input.slice(1).toLowerCase()
  const matches = SLASH_COMMANDS.filter((c) =>
    c.name.startsWith(query) || c.desc.toLowerCase().includes(query)
  )

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
        const isTop = i === 0
        const label = `/${cmd.name}${cmd.args ? ' ' + cmd.args : ''}`
        return (
          <Box key={cmd.name}>
            <Text color={isTop ? 'cyan' : 'white'} bold={isTop}>
              {label.padEnd(20)}
            </Text>
            <Text color="gray" dimColor>{cmd.desc}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

/** Parse "/ingest notes.md" → { command: 'ingest', arg: 'notes.md' } */
export function parseSlash(input: string): { command: string; arg: string } | null {
  if (!input.startsWith('/')) return null
  const [raw, ...rest] = input.slice(1).trim().split(/\s+/)
  const command = raw?.toLowerCase() ?? ''
  if (!SLASH_COMMANDS.find((c) => c.name === command)) return null
  return { command, arg: rest.join(' ') }
}
