import fs from 'fs'
import path from 'path'

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface LockInfo {
  pid: number
  acquiredAt: string
}

// ── Constants ───────────────────────────────────────────────────────────────

const LOCK_FILENAME = 'lock'

// ── Core Functions ──────────────────────────────────────────────────────────

function lockPath(wikiDir: string): string {
  return path.join(wikiDir, LOCK_FILENAME)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLock(wikiDir: string): LockInfo | null {
  const fp = lockPath(wikiDir)
  if (!fs.existsSync(fp)) return null

  try {
    const raw = fs.readFileSync(fp, 'utf-8')
    const parsed = JSON.parse(raw) as LockInfo
    if (typeof parsed.pid !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Attempt to acquire the compilation lock.
 * Returns true if lock acquired, false if another live process holds it.
 * Stale locks (dead PIDs) are automatically reclaimed.
 */
export function acquireLock(wikiDir: string): boolean {
  const fp = lockPath(wikiDir)
  fs.mkdirSync(path.dirname(fp), { recursive: true })

  const existing = readLock(wikiDir)
  if (existing) {
    if (existing.pid === process.pid) return true // we already hold it

    if (isProcessAlive(existing.pid)) {
      return false // another live process holds the lock
    }

    // Stale lock — reclaim it
    try { fs.unlinkSync(fp) } catch { /* race: another process may have reclaimed */ }
  }

  // Try to create the lock file
  const lock: LockInfo = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  }

  try {
    // Use exclusive create flag to avoid race conditions
    fs.writeFileSync(fp, JSON.stringify(lock, null, 2), { flag: 'wx' })
    return true
  } catch (err: unknown) {
    // EEXIST: another process created the lock between our check and write
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }
    throw err
  }
}

/**
 * Release the compilation lock. Only releases if current process holds it.
 */
export function releaseLock(wikiDir: string): void {
  const existing = readLock(wikiDir)
  if (!existing || existing.pid !== process.pid) return

  try {
    fs.unlinkSync(lockPath(wikiDir))
  } catch {
    // Already released or race — fine
  }
}

/**
 * Get info about the current lock holder, if any.
 */
export function getLockInfo(wikiDir: string): { locked: boolean; info: LockInfo | null; stale: boolean } {
  const existing = readLock(wikiDir)
  if (!existing) return { locked: false, info: null, stale: false }

  const alive = isProcessAlive(existing.pid)
  return { locked: alive, info: existing, stale: !alive }
}

/**
 * Force-release a stale lock. Use when the user confirms override.
 */
export function forceReleaseLock(wikiDir: string): void {
  try {
    fs.unlinkSync(lockPath(wikiDir))
  } catch {
    // Already gone — fine
  }
}
