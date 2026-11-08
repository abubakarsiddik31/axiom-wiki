import { execFileSync, execSync } from 'child_process'
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

/**
 * Commits only the given paths. Used by page operations so a browser edit does
 * not sweep unrelated working-tree changes into its commit.
 */
export function commitPaths(wikiDir: string, paths: string[], message: string): boolean {
  if (!isGitRepo(wikiDir) || paths.length === 0) return false
  try {
    const status = execFileSync('git', ['status', '--porcelain', '--', ...paths], {
      cwd: wikiDir,
      encoding: 'utf-8',
    })
    if (!status.trim()) return false
    // Untracked files must be added before `git commit -- <path>` will accept
    // them; `-A` also stages deletions for removed pages.
    execFileSync('git', ['add', '-A', '--', ...paths], {
      cwd: wikiDir,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    execFileSync('git', ['commit', '--no-verify', '-m', message, '--', ...paths], {
      cwd: wikiDir,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch (err) {
    process.stderr.write(`[axiom git] Scoped commit failed: ${err}\n`)
    return false
  }
}
