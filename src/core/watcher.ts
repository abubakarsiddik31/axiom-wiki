import fs from 'fs'
import path from 'path'
import { watch, type FSWatcher } from 'chokidar'
import ignore from 'ignore'

const SUPPORTED_EXTS = new Set(['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.html', '.docx'])

export function loadIgnorePatterns(rawDir: string): string[] {
  const ignoreFile = path.join(rawDir, '.axiomignore')
  if (!fs.existsSync(ignoreFile)) return []
  return fs.readFileSync(ignoreFile, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

function isAlreadyIngested(rawDir: string, filepath: string): boolean {
  const logPath = path.join(path.dirname(rawDir), 'wiki/log.md')
  if (!fs.existsSync(logPath)) return false
  const filename = path.basename(filepath)
  const log = fs.readFileSync(logPath, 'utf-8')
  return log.includes(`| ${filename}`) || log.includes(`ingest | ${filename}`)
}

export function startWatcher(
  rawDir: string,
  onFile: (filepath: string) => Promise<void>,
  options?: { ignore?: string[] },
): FSWatcher {
  const patterns = options?.ignore ?? loadIgnorePatterns(rawDir)
  const ig = ignore().add(patterns)

  // Build chokidar ignored matcher combining extension check + ignore patterns
  const ignored = (filePath: string): boolean => {
    const ext = path.extname(filePath).toLowerCase()
    const rel = path.relative(rawDir, filePath)

    // Always allow directories through (chokidar passes dirs too)
    if (!ext) return false

    // Skip unsupported extensions
    if (!SUPPORTED_EXTS.has(ext)) return true

    // Skip .axiomignore itself
    if (path.basename(filePath) === '.axiomignore') return true

    // Check ignore patterns (relative paths)
    if (rel && !rel.startsWith('..') && ig.ignores(rel)) return true

    return false
  }

  const timers = new Map<string, NodeJS.Timeout>()

  const watcher = watch(rawDir, {
    persistent: true,
    ignoreInitial: true,
    ignored,
    depth: 1,
  })

  watcher.on('add', (filePath: string) => {
    const ext = path.extname(filePath).toLowerCase()
    if (!SUPPORTED_EXTS.has(ext)) return

    // Clear existing debounce timer for this path
    const existing = timers.get(filePath)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(async () => {
      timers.delete(filePath)

      if (isAlreadyIngested(rawDir, filePath)) {
        process.stderr.write(`[axiom watch] Skipping already-ingested: ${path.basename(filePath)}\n`)
        return
      }

      process.stderr.write(`[axiom watch] Detected: ${path.basename(filePath)}\n`)
      try {
        await onFile(filePath)
      } catch (err) {
        process.stderr.write(`[axiom watch] Error ingesting ${path.basename(filePath)}: ${err}\n`)
      }
    }, 2000)

    timers.set(filePath, timer)
  })

  return watcher
}
