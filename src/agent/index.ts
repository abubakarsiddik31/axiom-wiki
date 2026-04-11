import { Agent } from '@mastra/core/agent'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { SYSTEM_PROMPT } from './prompts.js'
import { createAxiomTools } from './tools.js'
import type { AxiomConfig } from '../config/index.js'
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
