import fs from 'fs'
import path from 'path'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { NodeHtmlMarkdown } from 'node-html-markdown'
import slugify from 'slugify'
import matter from 'gray-matter'
import { fetchYouTubeTranscript, parseYouTubeUrl, transcriptToMarkdown } from './youtube.js'

export interface ClipResult {
  filepath: string
  filename: string
  title: string
  type: 'article' | 'pdf' | 'image' | 'video'
  sizeBytes: number
  /** True when an identical source was already in raw/ and nothing was downloaded. */
  reused?: boolean
}

export interface ClipOptions {
  /** Preferred subtitle language for YouTube transcripts (default: en). */
  lang?: string
  /** Progress callback (transcript download, one-time yt-dlp install, retry waits). */
  onStatus?: (message: string) => void
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const PDF_MIME = 'application/pdf'
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function makeFilename(title: string, date: string, ext: string): string {
  const slug = slugify(title, { lower: true, strict: true }).slice(0, 70)
  return `${slug}-${date}${ext}`
}

function uniqueFilepath(dir: string, filename: string): string {
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let candidate = path.join(dir, filename)
  let counter = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${counter}${ext}`)
    counter++
  }
  return candidate
}

function getUrlExt(url: string): string {
  try {
    const pathname = new URL(url).pathname
    return path.extname(pathname).toLowerCase()
  } catch {
    return ''
  }
}

async function checkRobots(url: string): Promise<void> {
  const { origin, pathname } = new URL(url)
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': 'axiom-wiki/1.0' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return

    const text = await res.text()
    const lines = text.split('\n').map((l) => l.trim())
    let applicable = false

    for (const line of lines) {
      if (line.toLowerCase().startsWith('user-agent:')) {
        const agent = line.split(':')[1]?.trim() ?? ''
        applicable = agent === '*' || agent.toLowerCase().includes('axiom')
      }
      if (applicable && line.toLowerCase().startsWith('disallow:')) {
        const disallowed = line.split(':')[1]?.trim() ?? ''
        if (disallowed && pathname.startsWith(disallowed)) {
          throw new Error(`Blocked by robots.txt: ${url}`)
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Blocked by robots.txt')) throw err
    // Ignore robots.txt fetch failures — proceed with clip
  }
}

/** Finds an existing transcript for this video so repeat clips cost nothing. */
function findExistingTranscript(
  rawDir: string,
  videoId: string,
): { filepath: string; title: string; sizeBytes: number } | null {
  if (!fs.existsSync(rawDir)) return null

  for (const entry of fs.readdirSync(rawDir)) {
    if (!entry.endsWith('.md')) continue
    const filepath = path.join(rawDir, entry)
    try {
      if (!fs.statSync(filepath).isFile()) continue
      const raw = fs.readFileSync(filepath, 'utf-8')
      if (!raw.startsWith('---')) continue
      if (!new RegExp(`^video_id:\\s*${videoId}\\s*$`, 'm').test(raw.slice(0, 2000))) continue
      const { data } = matter(raw)
      return {
        filepath,
        title: String(data['title'] ?? entry),
        sizeBytes: Buffer.byteLength(raw, 'utf-8'),
      }
    } catch {
      // unreadable file — keep looking
    }
  }
  return null
}

async function clipYouTube(
  url: string,
  rawDir: string,
  options: ClipOptions,
): Promise<ClipResult> {
  const ref = parseYouTubeUrl(url)
  if (!ref) throw new Error(`Not a YouTube URL: ${url}`)

  const existing = findExistingTranscript(rawDir, ref.id)
  if (existing) {
    options.onStatus?.(`Transcript already in raw/ — reusing ${path.basename(existing.filepath)}`)
    return {
      filepath: existing.filepath,
      filename: path.basename(existing.filepath),
      title: existing.title,
      type: 'video',
      sizeBytes: existing.sizeBytes,
      reused: true,
    }
  }

  const transcript = await fetchYouTubeTranscript(url, {
    lang: options.lang,
    onStatus: options.onStatus,
  })
  const content = transcriptToMarkdown(transcript)

  const date = today()
  const filename = makeFilename(transcript.title, date, '.md')
  const filepath = uniqueFilepath(rawDir, filename)
  fs.mkdirSync(rawDir, { recursive: true })
  fs.writeFileSync(filepath, content, 'utf-8')

  return {
    filepath,
    filename: path.basename(filepath),
    title: transcript.title,
    type: 'video',
    sizeBytes: Buffer.byteLength(content, 'utf-8'),
  }
}

export async function clipUrl(url: string, rawDir: string, options: ClipOptions = {}): Promise<ClipResult> {
  // YouTube is handled before robots/HTML: the payload is a transcript, not a page.
  if (parseYouTubeUrl(url)) {
    return clipYouTube(url, rawDir, options)
  }

  await checkRobots(url)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'axiom-wiki/1.0 (personal knowledge base)' },
      signal: controller.signal,
      redirect: 'follow',
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out: ${url}`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`)
  }

  const contentType = res.headers.get('content-type') ?? ''
  const urlExt = getUrlExt(url)
  const date = today()

  // ── PDF ──────────────────────────────────────────────────────────────────
  if (contentType.includes(PDF_MIME) || urlExt === '.pdf') {
    const hostname = new URL(url).hostname
    const filename = makeFilename(hostname + '-document', date, '.pdf')
    const filepath = uniqueFilepath(rawDir, filename)
    fs.mkdirSync(rawDir, { recursive: true })

    const buffer = await res.arrayBuffer()
    fs.writeFileSync(filepath, Buffer.from(buffer))

    return { filepath, filename: path.basename(filepath), title: hostname, type: 'pdf', sizeBytes: buffer.byteLength }
  }

  // ── Image ────────────────────────────────────────────────────────────────
  if ([...IMAGE_MIMES].some((m) => contentType.includes(m)) || IMAGE_EXTS.has(urlExt)) {
    const ext = urlExt || '.jpg'
    const hostname = new URL(url).hostname
    const filename = makeFilename(hostname + '-image', date, ext)
    const filepath = uniqueFilepath(rawDir, filename)
    fs.mkdirSync(rawDir, { recursive: true })

    const buffer = await res.arrayBuffer()
    fs.writeFileSync(filepath, Buffer.from(buffer))

    return { filepath, filename: path.basename(filepath), title: hostname, type: 'image', sizeBytes: buffer.byteLength }
  }

  // ── HTML article ─────────────────────────────────────────────────────────
  const html = await res.text()
  let markdown: string
  let articleTitle: string

  try {
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article) throw new Error('Readability returned null')

    articleTitle = article.title || new URL(url).hostname
    markdown = NodeHtmlMarkdown.translate(article.content ?? '')
  } catch {
    process.stderr.write(`[axiom clip] Readability failed — saving raw HTML\n`)
    articleTitle = new URL(url).hostname
    markdown = NodeHtmlMarkdown.translate(html)
  }

  const frontmatter = [
    '---',
    `source_url: ${url}`,
    `clipped_at: ${date}`,
    `title: "${articleTitle.replace(/"/g, '\\"')}"`,
    '---',
    '',
  ].join('\n')

  const content = frontmatter + markdown
  const filename = makeFilename(articleTitle, date, '.md')
  const filepath = uniqueFilepath(rawDir, filename)
  fs.mkdirSync(rawDir, { recursive: true })
  fs.writeFileSync(filepath, content, 'utf-8')

  return {
    filepath,
    filename: path.basename(filepath),
    title: articleTitle,
    type: 'article',
    sizeBytes: Buffer.byteLength(content, 'utf-8'),
  }
}
