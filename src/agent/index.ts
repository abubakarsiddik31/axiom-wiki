import { Agent } from '@mastra/core/agent'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { SYSTEM_PROMPT } from './prompts.js'
import { createAxiomTools } from './tools.js'
import type { AxiomConfig } from '../config/index.js'

export function createAxiomAgent(config: AxiomConfig) {
  const model = resolveModel(config.provider, config.model, config.apiKey)
  const tools = createAxiomTools(config)

  return new Agent({
    id: 'axiom',
    name: 'axiom',
    instructions: SYSTEM_PROMPT,
    model,
    tools,
  })
}

function resolveModel(
  provider: AxiomConfig['provider'],
  modelId: string,
  apiKey: string,
) {
  switch (provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelId)
    case 'openai':
      return createOpenAI({ apiKey })(modelId)
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId)
    default: {
      const _exhaustive: never = provider
      throw new Error(`Unknown provider: ${_exhaustive}`)
    }
  }
}
