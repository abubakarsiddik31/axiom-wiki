import fs from 'fs'
import path from 'path'
import type { ProviderId } from '../config/models.js'
import { PROVIDERS } from '../config/models.js'

export interface UsageEntry {
  timestamp: string
  operation: string
  source: string
  provider: ProviderId
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number | null
}

export function calcCost(provider: ProviderId, modelId: string, inputTokens: number, outputTokens: number): number | null {
  const model = PROVIDERS[provider]?.models.find((m) => m.id === modelId)
  if (!model?.pricing) return null
  return (inputTokens * model.pricing.input + outputTokens * model.pricing.output) / 1_000_000
}

export function appendUsageLog(wikiDir: string, entry: UsageEntry): void {
  const logPath = path.join(wikiDir, 'wiki/usage.log')
  const cost = entry.costUsd !== null ? `$${entry.costUsd.toFixed(6)}` : 'n/a'
  const line = `${entry.timestamp} | ${entry.operation} | ${entry.source} | ${entry.provider}/${entry.model} | in=${entry.inputTokens} out=${entry.outputTokens} | ${cost}\n`
  fs.appendFileSync(logPath, line, 'utf-8')
}

export function readUsageLog(wikiDir: string): UsageEntry[] {
  const logPath = path.join(wikiDir, 'wiki/usage.log')
  if (!fs.existsSync(logPath)) return []
  const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean)
  const entries: UsageEntry[] = []
  for (const line of lines) {
    const parts = line.split(' | ')
    if (parts.length < 6) continue
    const [timestamp, operation, source, provModel, tokens, costStr] = parts
    const [provider, model] = (provModel ?? '').split('/')
    const inMatch = (tokens ?? '').match(/in=(\d+)/)
    const outMatch = (tokens ?? '').match(/out=(\d+)/)
    const costMatch = (costStr ?? '').match(/\$([0-9.]+)/)
    entries.push({
      timestamp: timestamp ?? '',
      operation: operation ?? '',
      source: source ?? '',
      provider: (provider ?? 'google') as ProviderId,
      model: model ?? '',
      inputTokens: inMatch ? parseInt(inMatch[1]!) : 0,
      outputTokens: outMatch ? parseInt(outMatch[1]!) : 0,
      costUsd: costMatch ? parseFloat(costMatch[1]!) : null,
    })
  }
  return entries
}

export function totalCost(wikiDir: string): number {
  return readUsageLog(wikiDir).reduce((sum, e) => sum + (e.costUsd ?? 0), 0)
}
