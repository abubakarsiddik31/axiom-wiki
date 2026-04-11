import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { readPage } from './wiki.js'

export interface SourceRecord {
  filename: string
  ingestedAt: string
  summaryPage: string
  pageCount: number
}

const LOG_INGEST_RE = /^## \[(\d{4}-\d{2}-\d{2})\] ingest \| (.+?)(?:\s+\((\d+) pages?\))?$/

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseLogEntries(logContent: string): SourceRecord[] {
  const seen = new Map<string, SourceRecord>()

  for (const line of logContent.split('\n')) {
    const m = line.trim().match(LOG_INGEST_RE)
    if (!m) continue
    const [, date, filename, pages] = m
    if (!filename) continue
    // Later entries overwrite earlier — keeps most-recent ingest per file
    seen.set(filename, {
      filename,
      ingestedAt: date ?? '',
      summaryPage: '',
      pageCount: pages ? parseInt(pages, 10) : 0,
    })
  }

  return [...seen.values()].reverse() // reverse-chron
}

function findSummaryPage(wikiDir: string, filename: string): string {
  const sourcesDir = path.join(wikiDir, 'wiki/pages/sources')
  if (!fs.existsSync(sourcesDir)) return ''

  for (const entry of fs.readdirSync(sourcesDir)) {
    if (!entry.endsWith('.md')) continue
    const abs = path.join(sourcesDir, entry)
    const raw = fs.readFileSync(abs, 'utf-8')
    const { data } = matter(raw)

    const sources: unknown = data['sources']
    if (Array.isArray(sources) && sources.some((s) => String(s) === filename)) {
      return path.relative(wikiDir, abs)
    }
  }

  return ''
}

export function getIngestedFromLog(logPath: string): Set<string> {
  const ingested = new Set<string>()
  if (!fs.existsSync(logPath)) return ingested
  const log = fs.readFileSync(logPath, 'utf-8')
  for (const line of log.split('\n')) {
    const m = line.match(/^## \[\d{4}-\d{2}-\d{2}\] (?:ingest|reingest) \| (.+?)(?:\s+\(|$)/)
    if (m?.[1]) ingested.add(m[1].trim())
  }
  return ingested
}

export async function listSources(wikiDir: string): Promise<SourceRecord[]> {
  const logPath = path.join(wikiDir, 'wiki/log.md')
  if (!fs.existsSync(logPath)) return []

  const logContent = fs.readFileSync(logPath, 'utf-8')
  const records = parseLogEntries(logContent)

  return records.map((r) => ({
    ...r,
    summaryPage: findSummaryPage(wikiDir, r.filename),
  }))
}

export async function getSource(wikiDir: string, filename: string): Promise<string> {
  const summaryPage = findSummaryPage(wikiDir, filename)
  if (!summaryPage) {
    throw new Error(`No summary page found for source: ${filename}`)
  }
  return readPage(wikiDir, summaryPage)
}

export async function removeSource(
  wikiDir: string,
  filename: string,
): Promise<{ removedPage: string; orphanedPages: string[] }> {
  const summaryPage = findSummaryPage(wikiDir, filename)
  if (!summaryPage) {
    throw new Error(`No summary page found for source: ${filename}`)
  }

  const abs = path.join(wikiDir, summaryPage)
  fs.unlinkSync(abs)

  // Scan all remaining pages for [[links]] to the removed source page
  const pagesDir = path.join(wikiDir, 'wiki/pages')
  const orphanedPages: string[] = []

  if (fs.existsSync(pagesDir)) {
    const allFiles = walkDir(pagesDir).filter((f) => f.endsWith('.md'))
    const summaryBasename = path.basename(summaryPage, '.md')

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf-8')
      if (content.includes(`[[sources/${summaryBasename}]]`) || content.includes(filename)) {
        orphanedPages.push(path.relative(wikiDir, file))
      }
    }
  }

  return { removedPage: summaryPage, orphanedPages }
}

export async function markForReingest(wikiDir: string, filename: string): Promise<void> {
  const logPath = path.join(wikiDir, 'wiki/log.md')
  const entry = `## [${today()}] reingest-pending | ${filename}\n`
  fs.appendFileSync(logPath, entry, 'utf-8')
}

// ── helpers ────────────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) files.push(...walkDir(full))
    else files.push(full)
  }
  return files
}
