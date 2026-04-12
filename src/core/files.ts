import fs from 'fs'
import path from 'path'
import { NodeHtmlMarkdown } from 'node-html-markdown'
import mammoth from 'mammoth'
import type { CoreMessage } from '../agent/types.js'
import { classifyError, friendlyErrorMessage } from './retry.js'
import { getContextWindow, estimateTokens, type ProviderId } from '../config/models.js'

export interface SourceFile {
  content: string
  mimeType: string
  isBase64: boolean
  filename: string
  extension: string
  sizeBytes: number
}

export const SUPPORTED_EXTS = ['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.html', '.docx']

const MAX_FILE_SIZE_TEXT = 100 * 1024 * 1024    // 100 MB
const MAX_FILE_SIZE_BINARY = 200 * 1024 * 1024  // 200 MB

// Overhead budget (tokens): system prompt + tool definitions + response reserve
const OVERHEAD_TOKENS = 8_000

export class ConversionError extends Error {
  constructor(public filename: string, public reason: string) {
    super(`Conversion failed for ${filename}: ${reason}`)
    this.name = 'ConversionError'
  }
}

export interface FileSizeCheck {
  ok: boolean
  sizeBytes: number
  sizeMB: string
  warning?: string
}

export function checkFileSize(filepath: string): FileSizeCheck {
  const sizeBytes = fs.statSync(filepath).size
  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1)
  const ext = path.extname(filepath).toLowerCase()
  const isBinary = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)
  const limit = isBinary ? MAX_FILE_SIZE_BINARY : MAX_FILE_SIZE_TEXT

  if (sizeBytes > limit) {
    return { ok: false, sizeBytes, sizeMB, warning: `File is ${sizeMB} MB, maximum is ${(limit / (1024 * 1024)).toFixed(0)} MB for ${isBinary ? 'binary' : 'text'} files.` }
  }
  if (sizeBytes > limit * 0.8) {
    return { ok: true, sizeBytes, sizeMB, warning: `File is ${sizeMB} MB — close to the ${(limit / (1024 * 1024)).toFixed(0)} MB limit.` }
  }
  return { ok: true, sizeBytes, sizeMB }
}

export function estimateContentTokens(src: SourceFile, provider: string): number {
  if (src.isBase64) {
    // Google Files API uploads don't consume context tokens
    if (provider === 'google') return 0
    // Base64 expands ~1.37x, then tokenized at ~3.5 chars/token
    return Math.ceil(src.sizeBytes * 1.37 / 3.5)
  }
  return estimateTokens(src.content)
}

export interface ContextBudgetCheck {
  fits: boolean
  estimatedTokens: number
  contextWindow: number
  message?: string
}

export function checkContextBudget(
  src: SourceFile,
  provider: ProviderId,
  modelId: string,
): ContextBudgetCheck {
  const contextWindow = getContextWindow(provider, modelId)
  const contentTokens = estimateContentTokens(src, provider)
  const totalNeeded = contentTokens + OVERHEAD_TOKENS
  const fits = totalNeeded < contextWindow * 0.95 // 5% safety margin

  if (!fits) {
    return {
      fits: false,
      estimatedTokens: contentTokens,
      contextWindow,
      message: `File is ~${(contentTokens / 1000).toFixed(0)}K tokens, model context is ${(contextWindow / 1000).toFixed(0)}K tokens. Try a model with a larger context window.`,
    }
  }
  return { fits: true, estimatedTokens: contentTokens, contextWindow }
}

export async function readSourceFile(filepath: string): Promise<SourceFile> {
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`)
  }

  const ext = path.extname(filepath).toLowerCase()
  const filename = path.basename(filepath)
  const sizeBytes = fs.statSync(filepath).size

  if (!SUPPORTED_EXTS.includes(ext)) {
    throw new Error(
      `Unsupported file type: ${ext}. Supported: .md .txt .pdf .png .jpg .jpeg .webp .html .docx`,
    )
  }

  // Pre-flight size check
  const sizeCheck = checkFileSize(filepath)
  if (!sizeCheck.ok) {
    throw new Error(sizeCheck.warning!)
  }

  if (ext === '.md' || ext === '.txt') {
    return { content: fs.readFileSync(filepath, 'utf-8'), mimeType: 'text/plain', isBase64: false, filename, extension: ext.slice(1), sizeBytes }
  }

  if (ext === '.pdf') {
    try {
      return { content: fs.readFileSync(filepath).toString('base64'), mimeType: 'application/pdf', isBase64: true, filename, extension: 'pdf', sizeBytes }
    } catch (err) {
      throw new ConversionError(filename, `PDF read failed: ${err instanceof Error ? err.message : String(err)}. File may be encrypted or corrupted.`)
    }
  }

  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') {
    const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
    return { content: fs.readFileSync(filepath).toString('base64'), mimeType: mimeMap[ext] ?? 'image/jpeg', isBase64: true, filename, extension: ext.slice(1), sizeBytes }
  }

  if (ext === '.html') {
    try {
      const markdown = NodeHtmlMarkdown.translate(fs.readFileSync(filepath, 'utf-8'))
      return { content: markdown, mimeType: 'text/plain', isBase64: false, filename, extension: 'html', sizeBytes }
    } catch (err) {
      throw new ConversionError(filename, `HTML conversion failed: ${err instanceof Error ? err.message : String(err)}.`)
    }
  }

  if (ext === '.docx') {
    try {
      const mammothAny = mammoth as unknown as { convertToMarkdown: (opts: { path: string }) => Promise<{ value: string; messages: Array<{ message: string }> }> }
      const result = await mammothAny.convertToMarkdown({ path: filepath })
      for (const msg of result.messages) process.stderr.write(`[mammoth] ${msg.message}\n`)
      return { content: result.value, mimeType: 'text/plain', isBase64: false, filename, extension: 'docx', sizeBytes }
    } catch (err) {
      if (err instanceof ConversionError) throw err
      throw new ConversionError(filename, `DOCX conversion failed: ${err instanceof Error ? err.message : String(err)}. File may be corrupted or password-protected.`)
    }
  }

  throw new Error(`Unsupported file type: ${ext}`)
}

/**
 * Uploads a binary file to Google's Files API and returns the hosted URI.
 * The URI can be passed directly to the model — the file bytes are NOT
 * embedded in the request body, so it bypasses the token-count limit.
 */
async function uploadGoogleFile(filepath: string, mimeType: string, apiKey: string): Promise<string> {
  const fileData = fs.readFileSync(filepath)
  const filename = path.basename(filepath)
  const boundary = `----AxiomBoundary${Date.now()}`
  const metadata = JSON.stringify({ file: { displayName: filename } })

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileData,
    Buffer.from(`\r\n--${boundary}--`),
  ])

  const res = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}&uploadType=multipart`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  )

  if (!res.ok) {
    throw new Error(`Google Files API upload failed: ${res.status} ${await res.text()}`)
  }

  const json = await res.json() as { file: { uri: string } }
  return json.file.uri
}

export interface ProviderConfig {
  provider: string
  apiKey: string
}

export async function buildIngestMessage(
  filepath: string,
  reingest: boolean,
  userContext = '',
  providerConfig?: ProviderConfig,
): Promise<CoreMessage> {
  const src = await readSourceFile(filepath)
  const instruction = reingest
    ? `Re-ingest this source file into the wiki (diff against existing pages). Filename: ${src.filename}${userContext ? `\n\nUser instructions: ${userContext}` : ''}`
    : `Ingest this source file into the wiki. Filename: ${src.filename}${userContext ? `\n\nUser instructions: ${userContext}` : ''}`

  if (src.isBase64) {
    // Google: upload via Files API so the bytes are hosted server-side (no token overhead)
    if (providerConfig?.provider === 'google' && providerConfig.apiKey) {
      try {
        const uri = await uploadGoogleFile(filepath, src.mimeType, providerConfig.apiKey)
        const fileUrl = new URL(uri)
        const content: Array<{ type: string; [k: string]: unknown }> = [{ type: 'text', text: instruction }]
        if (src.mimeType.startsWith('image/')) {
          content.push({ type: 'image', image: fileUrl, mimeType: src.mimeType })
        } else {
          content.push({ type: 'file', data: fileUrl, mimeType: src.mimeType, filename: src.filename })
        }
        return { role: 'user', content }
      } catch (uploadErr) {
        // Fall through to base64 — upload failure should not block ingestion
        process.stderr.write(`[axiom] Google file upload failed, falling back to base64: ${uploadErr}\n`)
      }
    }

    // Other providers or Google upload failure: inline base64
    if (src.mimeType.startsWith('image/')) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          { type: 'image', image: src.content, mimeType: src.mimeType as any },
        ],
      }
    }
    return {
      role: 'user',
      content: [
        { type: 'text', text: instruction },
        { type: 'file', data: src.content, mimeType: src.mimeType as any, filename: src.filename },
      ],
    }
  }

  // Plain text / markdown / html / docx (already converted to text)
  return {
    role: 'user',
    content: `${instruction}\n\n<file_content>\n${src.content}\n</file_content>`,
  }
}

/** Returns a friendly message if the error is a known provider error class. */
export function contextLimitMessage(err: unknown): string | null {
  const errorClass = classifyError(err)
  if (errorClass === 'context_limit') return friendlyErrorMessage('context_limit')
  if (errorClass === 'auth') return friendlyErrorMessage('auth')
  if (errorClass === 'billing') return friendlyErrorMessage('billing')
  if (errorClass === 'not_found') return friendlyErrorMessage('not_found')
  return null
}
