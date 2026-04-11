import fs from 'fs'
import path from 'path'
import { NodeHtmlMarkdown } from 'node-html-markdown'
import mammoth from 'mammoth'

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
    return {
      content: fs.readFileSync(filepath, 'utf-8'),
      mimeType: 'text/plain',
      isBase64: false,
      filename,
      extension: ext.slice(1),
      sizeBytes,
    }
  }

  if (ext === '.pdf') {
    return {
      content: fs.readFileSync(filepath).toString('base64'),
      mimeType: 'application/pdf',
      isBase64: true,
      filename,
      extension: 'pdf',
      sizeBytes,
    }
  }

  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') {
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    }
    return {
      content: fs.readFileSync(filepath).toString('base64'),
      mimeType: mimeMap[ext] ?? 'image/jpeg',
      isBase64: true,
      filename,
      extension: ext.slice(1),
      sizeBytes,
    }
  }

  if (ext === '.html') {
    const html = fs.readFileSync(filepath, 'utf-8')
    const markdown = NodeHtmlMarkdown.translate(html)
    return {
      content: markdown,
      mimeType: 'text/plain',
      isBase64: false,
      filename,
      extension: 'html',
      sizeBytes,
    }
  }

  if (ext === '.docx') {
    const mammothAny = mammoth as unknown as { convertToMarkdown: (opts: { path: string }) => Promise<{ value: string; messages: Array<{ message: string }> }> }
    const result = await mammothAny.convertToMarkdown({ path: filepath })
    if (result.messages.length > 0) {
      for (const msg of result.messages) {
        process.stderr.write(`[mammoth] ${msg.message}\n`)
      }
    }
    return {
      content: result.value,
      mimeType: 'text/plain',
      isBase64: false,
      filename,
      extension: 'docx',
      sizeBytes,
    }
  }

  throw new Error(`Unsupported file type: ${ext}`)
}
