import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

/**
 * Checks if the directory is a git repository.
 */
export function isGitRepo(dir: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: dir, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Stages all changes and commits them with a message.
 */
export async function autoCommit(wikiDir: string, message: string): Promise<boolean> {
  if (!isGitRepo(wikiDir)) return false

  try {
    // Only commit if there are changes
    const status = execSync('git status --porcelain', { cwd: wikiDir }).toString()
    if (!status.trim()) return false

    execSync('git add .', { cwd: wikiDir })
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: wikiDir })
    return true
  } catch (err) {
    process.stderr.write(`[axiom git] Auto-commit failed: ${err}\n`)
    return false
  }
}
