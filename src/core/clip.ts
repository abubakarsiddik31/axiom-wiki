import fs from 'fs'
import path from 'path'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { NodeHtmlMarkdown } from 'node-html-markdown'
import slugify from 'slugify'

export interface ClipResult {
  filepath: string
  filename: string
  title: string
  type: 'article' | 'pdf' | 'image'
  sizeBytes: number
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

export async function clipUrl(url: string, rawDir: string): Promise<ClipResult> {
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
