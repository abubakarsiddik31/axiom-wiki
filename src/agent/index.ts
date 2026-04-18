import { Agent } from '@mastra/core/agent'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { buildSystemPrompt, buildAutowikiSystemPrompt, buildSyncSystemPrompt } from './prompts.js'
import { createAxiomTools } from './tools.js'
import { createCodebaseTools } from './codebase-tools.js'
import type { AxiomConfig } from '../config/index.js'
import { getOllamaNumCtx } from '../config/models.js'
import type { ProjectSnapshot } from '../core/mapper.js'
import { autoCommit } from '../core/git.js'

export function createAxiomAgent(config: AxiomConfig) {
  const model = resolveModel(config)
  const tools = createAxiomTools(config)

  const agent = new Agent({
    id: 'axiom',
    name: 'axiom',
    instructions: buildSystemPrompt({ obsidianCompat: config.obsidianCompat }),
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
  const compatOpts = { obsidianCompat: config.obsidianCompat }
  const instructions = mode === 'sync'
    ? buildSyncSystemPrompt(contentType, compatOpts)
    : buildAutowikiSystemPrompt(contentType, compatOpts)

  return new Agent({
    id: 'axiom-autowiki',
    name: 'axiom-autowiki',
    instructions,
    model,
    tools,
  })
}

type AnyModel = ReturnType<ReturnType<typeof createGoogleGenerativeAI>>

/** Create an OpenAI-compatible provider client for API gateways that follow the OpenAI /v1 spec. */
function createOpenAICompatible(baseURL: string, apiKey: string, headers?: Record<string, string>) {
  return createOpenAI({ baseURL, apiKey, headers })
}

export function resolveModel(config: AxiomConfig): AnyModel {
  const { provider, model: modelId, apiKey } = config
  if (process.env['AXIOM_DEBUG'] === '1') console.error('[resolveModel]', { provider, modelId, ollamaBaseUrl: config.ollamaBaseUrl })
  switch (provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelId)
    case 'openai':
      return createOpenAI({ apiKey })(modelId)
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId)
    case 'openrouter':
      return createOpenAICompatible('https://openrouter.ai/api/v1', apiKey, {
        'HTTP-Referer': 'https://github.com/abubakarsiddik31/axiom-wiki',
        'X-Title': 'Axiom Wiki',
      })(modelId)
    case 'deepseek':
      return createOpenAICompatible('https://api.deepseek.com/v1', apiKey)(modelId)
    case 'groq':
      return createOpenAICompatible('https://api.groq.com/openai/v1', apiKey)(modelId)
    case 'mistral':
      return createOpenAICompatible('https://api.mistral.ai/v1', apiKey)(modelId)
    case 'ollama': {
      const baseURL = config.ollamaBaseUrl ?? 'http://localhost:11434/v1'
      const numCtx = getOllamaNumCtx(modelId, config.ollamaNumCtx)
      const nativeBase = baseURL.replace(/\/v1\/?$/, '')
      const debug = process.env['AXIOM_DEBUG'] === '1'

      // Intercept /v1/chat/completions requests and redirect to Ollama's
      // native /api/chat endpoint, converting the request format.
      // This lets us pass options.num_ctx which /v1 ignores.
      const ollamaFetch: typeof globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url
        if (!url.includes('/chat/completions') || !init?.body || typeof init.body !== 'string') {
          return globalThis.fetch(input, init)
        }

        try {
          const openaiBody = JSON.parse(init.body)
          if (debug) console.error('[ollama] intercepting /v1/chat/completions → /api/chat with num_ctx:', numCtx)

          // Convert OpenAI messages → Ollama native messages
          // OpenAI SDK sends tool_calls.arguments as strings, Ollama native expects objects.
          // OpenAI SDK sends role:"tool" for tool results, Ollama expects the same but
          // prior assistant messages need arguments un-stringified.
          const convertMessages = (msgs: any[]): any[] => {
            return msgs.map((msg: any) => {
              if (msg.role === 'assistant' && msg.tool_calls) {
                return {
                  ...msg,
                  tool_calls: msg.tool_calls.map((tc: any) => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                      name: tc.function?.name,
                      arguments: typeof tc.function?.arguments === 'string'
                        ? (() => { try { return JSON.parse(tc.function.arguments) } catch { return tc.function.arguments } })()
                        : tc.function?.arguments,
                    },
                  })),
                }
              }
              return msg
            })
          }

          const ollamaBody: Record<string, unknown> = {
            model: openaiBody.model ?? modelId,
            messages: convertMessages(openaiBody.messages ?? []),
            stream: false,
            options: { num_ctx: numCtx },
          }
          if (openaiBody.tools) ollamaBody.tools = openaiBody.tools
          if (openaiBody.temperature !== undefined) ollamaBody.options = { ...(ollamaBody.options as Record<string, unknown>), temperature: openaiBody.temperature }

          if (debug) console.error('[ollama] sending', (ollamaBody.messages as any[]).length, 'messages, roles:', (ollamaBody.messages as any[]).map((m: any) => m.role).join(','))

          const nativeRes = await globalThis.fetch(`${nativeBase}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ollamaBody),
          })

          // Convert Ollama native response → OpenAI format
          const ollamaRes = await nativeRes.json() as Record<string, any>
          if (debug) console.error('[ollama] native response eval_count:', ollamaRes.eval_count, 'prompt_eval_count:', ollamaRes.prompt_eval_count)

          // Fix tool_calls format: Ollama native returns arguments as object
          // and omits type:"function", but OpenAI SDK expects both.
          const message = ollamaRes.message ?? { role: 'assistant', content: '' }
          if (message.tool_calls) {
            message.tool_calls = message.tool_calls.map((tc: Record<string, any>) => ({
              id: tc.id ?? `call_${Date.now()}`,
              type: 'function',
              function: {
                name: tc.function?.name ?? '',
                arguments: typeof tc.function?.arguments === 'string'
                  ? tc.function.arguments
                  : JSON.stringify(tc.function?.arguments ?? {}),
              },
            }))
          }

          const openaiRes = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: ollamaBody.model,
            choices: [{
              index: 0,
              message,
              finish_reason: ollamaRes.done ? 'stop' : 'length',
            }],
            usage: {
              prompt_tokens: ollamaRes.prompt_eval_count ?? 0,
              completion_tokens: ollamaRes.eval_count ?? 0,
              total_tokens: (ollamaRes.prompt_eval_count ?? 0) + (ollamaRes.eval_count ?? 0),
            },
          }

          return new Response(JSON.stringify(openaiRes), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (err) {
          if (debug) console.error('[ollama] native fallback failed, using /v1:', err)
          return globalThis.fetch(input, init)
        }
      }

      return createOpenAI({ baseURL, apiKey: 'ollama', fetch: ollamaFetch }).chat(modelId)
    }
    default: {
      const _exhaustive: never = provider
      throw new Error(`Unknown provider: ${_exhaustive}`)
    }
  }
}
