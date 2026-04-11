import fs from 'fs'
import path from 'path'
import { NodeHtmlMarkdown } from 'node-html-markdown'
import mammoth from 'mammoth'
import type { CoreMessage } from '../agent/types.js'

export interface SourceFile {
  content: string
  mimeType: string
  isBase64: boolean
  filename: string
  extension: string
  sizeBytes: number
}

export const SUPPORTED_EXTS = ['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.html', '.docx']

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

  if (ext === '.md' || ext === '.txt') {
    return { content: fs.readFileSync(filepath, 'utf-8'), mimeType: 'text/plain', isBase64: false, filename, extension: ext.slice(1), sizeBytes }
  }

  if (ext === '.pdf') {
    return { content: fs.readFileSync(filepath).toString('base64'), mimeType: 'application/pdf', isBase64: true, filename, extension: 'pdf', sizeBytes }
  }

  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') {
    const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
    return { content: fs.readFileSync(filepath).toString('base64'), mimeType: mimeMap[ext] ?? 'image/jpeg', isBase64: true, filename, extension: ext.slice(1), sizeBytes }
  }

  if (ext === '.html') {
    const markdown = NodeHtmlMarkdown.translate(fs.readFileSync(filepath, 'utf-8'))
    return { content: markdown, mimeType: 'text/plain', isBase64: false, filename, extension: 'html', sizeBytes }
  }

  if (ext === '.docx') {
    const mammothAny = mammoth as unknown as { convertToMarkdown: (opts: { path: string }) => Promise<{ value: string; messages: Array<{ message: string }> }> }
    const result = await mammothAny.convertToMarkdown({ path: filepath })
    for (const msg of result.messages) process.stderr.write(`[mammoth] ${msg.message}\n`)
    return { content: result.value, mimeType: 'text/plain', isBase64: false, filename, extension: 'docx', sizeBytes }
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

/** Returns a friendly message if the error is a model context-limit rejection. */
export function contextLimitMessage(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('token count exceeds') || msg.includes('context length') || msg.includes('tokens allowed')) {
    return 'File too large for model context window. Try a smaller file or switch to a model with a larger context limit.'
  }
  return null
}
