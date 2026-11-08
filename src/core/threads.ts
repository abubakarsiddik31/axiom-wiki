import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

/**
 * Conversations with the wiki.
 *
 * A thread is state, not content: it lives beside `scout/` and `state.json`
 * under `chat/threads/<id>.json`, one file per conversation, written
 * atomically. Keeping it out of `wiki/pages` means a chat never pollutes the
 * corpus — until you explicitly file it as an analysis.
 *
 * Messages are append-only in spirit: the user turn is written before the
 * model runs, so a crash leaves a visible unanswered question rather than a
 * silent no-op.
 */

export const CHAT_DIR = 'chat/threads'
const THREAD_ID_RE = /^thr_[a-z0-9]{4,32}$/
const MAX_MESSAGES = 400
const MAX_TITLE = 80
const MAX_PREVIEW = 120

export type ThreadRole = 'user' | 'assistant'

export interface ThreadSource {
  id: string
  title: string
  category: string
  summary: string
  score: number
  origin: 'search' | 'link' | 'backlink'
}

export interface ThreadRerank {
  provider: string
  model: string
  used: boolean
  reason?: string
}

export interface ChatMessage {
  id: string
  role: ThreadRole
  content: string
  at: string
  /** Empty for a user turn. */
  sources?: ThreadSource[]
  rerank?: ThreadRerank | null
  /** The standalone query used for retrieval, when a follow-up was rewritten. */
  searched?: string
  /** Set when the turn failed instead of answering. */
  error?: string
  /** The job that produced this turn (useful for diagnostics and resume). */
  jobId?: string
}

export interface ChatThread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}

export interface ThreadSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string
  lastRole: ThreadRole | null
}

export interface ChatTurn {
  role: ThreadRole
  content: string
}

function threadsDir(wikiDir: string): string {
  return path.join(wikiDir, CHAT_DIR)
}

function newId(prefix: string, bytes = 6): string {
  return `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`
}

export function isValidThreadId(id: string): boolean {
  return THREAD_ID_RE.test(id)
}

function threadPath(wikiDir: string, id: string): string {
  if (!isValidThreadId(id)) throw new Error(`Invalid thread id: ${id}`)
  return path.join(threadsDir(wikiDir), `${id}.json`)
}

/** Collapses a question into a thread title; the first turn names the thread. */
export function titleFromQuestion(question: string): string {
  const cleaned = question
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'New conversation'
  if (cleaned.length <= MAX_TITLE) return cleaned
  return `${cleaned.slice(0, MAX_TITLE - 1).trimEnd()}…`
}

function atomicWrite(file: string, body: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, body, 'utf-8')
  fs.renameSync(tmp, file)
}

export function saveThread(wikiDir: string, thread: ChatThread): void {
  fs.mkdirSync(threadsDir(wikiDir), { recursive: true })
  const trimmed: ChatThread = {
    ...thread,
    messages: thread.messages.slice(-MAX_MESSAGES),
  }
  atomicWrite(threadPath(wikiDir, thread.id), `${JSON.stringify(trimmed, null, 2)}\n`)
}

export function createThread(
  wikiDir: string,
  options: { title?: string; at?: string } = {},
): ChatThread {
  const at = options.at ?? new Date().toISOString()
  const thread: ChatThread = {
    id: newId('thr'),
    title: (options.title ?? '').trim() || 'New conversation',
    createdAt: at,
    updatedAt: at,
    messages: [],
  }
  saveThread(wikiDir, thread)
  return thread
}

export function loadThread(wikiDir: string, id: string): ChatThread | null {
  if (!isValidThreadId(id)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(threadPath(wikiDir, id), 'utf-8')) as ChatThread
    if (!parsed || parsed.id !== id || !Array.isArray(parsed.messages)) return null
    return parsed
  } catch {
    return null
  }
}

/** A sidebar preview should read like a message, not like Markdown source. */
function plainPreview(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function summarize(thread: ChatThread): ThreadSummary {
  const last = thread.messages.at(-1)
  const preview = plainPreview(last?.content ?? '').slice(0, MAX_PREVIEW)
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messages.length,
    preview,
    lastRole: last?.role ?? null,
  }
}

/** Newest first. Threads are small files, so a directory scan is enough. */
export function listThreads(wikiDir: string): ThreadSummary[] {
  let names: string[]
  try {
    names = fs.readdirSync(threadsDir(wikiDir))
  } catch {
    return []
  }

  const threads: ChatThread[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const id = name.replace(/\.json$/, '')
    const thread = loadThread(wikiDir, id)
    if (thread) threads.push(thread)
  }

  return threads
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summarize)
}

export function newMessage(
  role: ThreadRole,
  content: string,
  extra: Omit<ChatMessage, 'id' | 'role' | 'content' | 'at'> = {},
  at = new Date().toISOString(),
): ChatMessage {
  return {
    id: newId('msg', 5),
    role,
    content,
    at,
    ...extra,
  }
}

/**
 * Appends a turn. The first user message also names the thread, so a
 * conversation created before its first question gets a useful title.
 */
export function appendMessage(wikiDir: string, id: string, message: ChatMessage): ChatThread {
  const thread = loadThread(wikiDir, id)
  if (!thread) throw new Error(`No thread “${id}”.`)

  thread.messages.push(message)
  if (thread.messages.length > MAX_MESSAGES) {
    thread.messages = thread.messages.slice(-MAX_MESSAGES)
  }
  if (thread.title === 'New conversation' && message.role === 'user' && message.content.trim()) {
    thread.title = titleFromQuestion(message.content)
  }
  thread.updatedAt = message.at
  saveThread(wikiDir, thread)
  return thread
}

export function renameThread(wikiDir: string, id: string, title: string): ChatThread | null {
  const thread = loadThread(wikiDir, id)
  if (!thread) return null
  thread.title = title.trim().slice(0, MAX_TITLE) || thread.title
  thread.updatedAt = new Date().toISOString()
  saveThread(wikiDir, thread)
  return thread
}

export function deleteThread(wikiDir: string, id: string): boolean {
  if (!isValidThreadId(id)) return false
  try {
    fs.rmSync(threadPath(wikiDir, id))
    return true
  } catch {
    return false
  }
}

/**
 * Conversation history for the model. Failed turns and empty turns are
 * dropped; long answers are truncated so a ten-turn thread does not crowd out
 * the retrieved evidence.
 */
export function historyFor(
  messages: ChatMessage[],
  options: { limit?: number; maxChars?: number } = {},
): ChatTurn[] {
  const limit = Math.max(2, options.limit ?? 12)
  const maxChars = Math.max(200, options.maxChars ?? 2400)

  const usable = messages
    .filter((message) => !message.error && message.content.trim().length > 0)
    .slice(-limit)
    .map((message) => ({
      role: message.role,
      content:
        message.content.length > maxChars
          ? `${message.content.slice(0, maxChars)}…`
          : message.content,
    }))

  // A provider expects the turn to start with the user; drop a dangling
  // assistant opening left by a truncated window.
  while (usable.length > 0 && usable[0]?.role === 'assistant') usable.shift()
  return usable
}

/**
 * Renders a thread as a wiki page. Used by "save to wiki" so a good
 * conversation becomes citable content instead of disappearing.
 */
export function threadMarkdown(
  thread: ChatThread,
  options: { title?: string; date?: string } = {},
): string {
  const title = options.title?.trim() || thread.title
  const date = options.date ?? new Date().toISOString().slice(0, 10)
  const exchanges = thread.messages.filter((message) => message.content.trim() && !message.error)

  const sections: string[] = []
  let index = 0
  for (const message of exchanges) {
    if (message.role === 'user') {
      index += 1
      sections.push(`## ${index}. ${message.content.trim()}`)
      continue
    }
    const lines = [message.content.trim()]
    if (message.sources && message.sources.length > 0) {
      const grounded = message.sources
        .map((source) => `[[${source.id}|${source.title}]]`)
        .join(' · ')
      lines.push('', `_Grounded in: ${grounded}_`)
    }
    sections.push(lines.join('\n'))
  }

  const summary = `Conversation: ${thread.messages.find((m) => m.role === 'user')?.content ?? title}`
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `summary: ${JSON.stringify(summary.slice(0, 160))}`,
    'tags: [analysis, conversation]',
    'category: analyses',
    `updatedAt: "${date}"`,
    '---',
    '',
    `# ${title}`,
    '',
    sections.join('\n\n'),
    '',
  ].join('\n')
}
