import { Agent } from '@mastra/core/agent'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { SYSTEM_PROMPT, buildAutowikiSystemPrompt, buildSyncSystemPrompt } from './prompts.js'
import { createAxiomTools } from './tools.js'
import { createCodebaseTools } from './codebase-tools.js'
import type { AxiomConfig } from '../config/index.js'
import type { ProjectSnapshot } from '../core/mapper.js'
import { autoCommit } from '../core/git.js'

export function createAxiomAgent(config: AxiomConfig) {
  const model = resolveModel(config)
  const tools = createAxiomTools(config)

  const agent = new Agent({
    id: 'axiom',
    name: 'axiom',
    instructions: SYSTEM_PROMPT,
    model,
    tools,
  })

  return Object.assign(agent, {
    commitChanges: async (message: string) => {
      return autoCommit(config.wikiDir, message)
    },
  })
}

export type ContentType = 'code' | 'docs'

export function detectContentType(snapshot: ProjectSnapshot): ContentType {
  const docExts = new Set(['.md', '.txt', '.pdf', '.docx', '.doc', '.html', '.htm', '.rtf', '.odt', '.epub'])
  let docFiles = 0
  let totalFiles = 0
  for (const [ext, count] of Object.entries(snapshot.languages)) {
    totalFiles += count
    if (docExts.has(ext)) docFiles += count
  }
  // If more than half the files are docs/text, treat as a docs folder
  return docFiles > totalFiles * 0.5 ? 'docs' : 'code'
}

export function createAutowikiAgent(config: AxiomConfig, projectRoot: string, snapshot: ProjectSnapshot, mode: 'autowiki' | 'sync' = 'autowiki') {
  const model = resolveModel(config)
  const wikiTools = createAxiomTools(config)
  const codebaseTools = createCodebaseTools(projectRoot, snapshot)
  const tools = { ...wikiTools, ...codebaseTools }

  const contentType = detectContentType(snapshot)
  const instructions = mode === 'sync'
    ? buildSyncSystemPrompt(contentType)
    : buildAutowikiSystemPrompt(contentType)

  return new Agent({
    id: 'axiom-autowiki',
    name: 'axiom-autowiki',
    instructions,
    model,
    tools,
  })
}

function resolveModel(config: AxiomConfig) {
  const { provider, model: modelId, apiKey } = config
  switch (provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelId)
    case 'openai':
      return createOpenAI({ apiKey })(modelId)
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId)
    case 'ollama': {
      const baseURL = config.ollamaBaseUrl ?? 'http://localhost:11434/api'
      return createOpenAI({ baseURL, apiKey: 'ollama' })(modelId)
    }
    default: {
      const _exhaustive: never = provider
      throw new Error(`Unknown provider: ${_exhaustive}`)
    }
  }
}
