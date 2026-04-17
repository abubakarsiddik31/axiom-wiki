import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import ignore from 'ignore'
import type { ProjectSnapshot } from '../core/mapper.js'
import { buildProjectSummary } from '../core/mapper.js'

const MAX_FILE_BYTES = 256 * 1024
const MAX_SEARCH_RESULTS = 20
const MAX_SEARCH_LINE_LEN = 200

function loadIgnore(projectRoot: string): ReturnType<typeof ignore> {
  const ig = ignore().add([
    'node_modules', '.git', 'axiom', '.axiom', 'dist', 'build', 'out',
    '.next', '.nuxt', '.svelte-kit', 'coverage', '__pycache__',
    '.DS_Store', 'Thumbs.db', '*.lock', '*.log', '.env', '.env.*',
    'vendor', '.cache', '.turbo',
  ])
  try {
    const gitignore = path.join(projectRoot, '.gitignore')
    if (fs.existsSync(gitignore)) ig.add(fs.readFileSync(gitignore, 'utf-8'))
  } catch { /* skip */ }
  try {
    const axiomignore = path.join(projectRoot, '.axiomignore')
    if (fs.existsSync(axiomignore)) ig.add(fs.readFileSync(axiomignore, 'utf-8'))
  } catch { /* skip */ }
  return ig
}

const BINARY_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.tgz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.lib', '.a', '.o',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac', '.ogg',
  '.ttf', '.woff', '.woff2', '.otf', '.eot',
  '.pyc', '.class', '.jar', '.war',
  '.db', '.sqlite', '.sqlite3',
])

export function createCodebaseTools(projectRoot: string, snapshot: ProjectSnapshot) {
  const ig = loadIgnore(projectRoot)

  function safePath(relPath: string): string | null {
    const resolved = path.resolve(projectRoot, relPath)
    if (!resolved.startsWith(projectRoot)) return null
    const rel = path.relative(projectRoot, resolved)
    if (rel.startsWith('..')) return null
    return resolved
  }

  const read_project_file = createTool({
    id: 'read_project_file',
    description: 'Read a file from the project codebase. Returns the file content. Use relative paths from the project root.',
    inputSchema: z.object({
      path: z.string().describe('Relative path from project root, e.g. "src/index.ts"'),
    }),
    execute: async (input) => {
      const abs = safePath(input.path)
      if (!abs) return 'Error: path outside project root'
      if (!fs.existsSync(abs)) return `Error: file not found: ${input.path}`

      const stat = fs.statSync(abs)
      if (!stat.isFile()) return 'Error: not a file'
      if (stat.size > MAX_FILE_BYTES) return `Error: file too large (${Math.round(stat.size / 1024)}KB, max ${MAX_FILE_BYTES / 1024}KB)`

      const ext = path.extname(abs).toLowerCase()
      if (BINARY_EXTENSIONS.has(ext)) return `Binary file: ${input.path} (${ext}, ${Math.round(stat.size / 1024)}KB)`

      return fs.readFileSync(abs, 'utf-8')
    },
  })

  const list_project_dir = createTool({
    id: 'list_project_dir',
    description: 'List contents of a project directory. Returns file/dir names with sizes. Use relative paths from the project root, or "" for root.',
    inputSchema: z.object({
      path: z.string().describe('Relative path from project root, e.g. "src/" or ""'),
    }),
    execute: async (input) => {
      const dirPath = input.path === '' ? projectRoot : safePath(input.path)
      if (!dirPath) return 'Error: path outside project root'
      if (!fs.existsSync(dirPath)) return `Error: directory not found: ${input.path}`

      const stat = fs.statSync(dirPath)
      if (!stat.isDirectory()) return 'Error: not a directory'

      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      const items: string[] = []

      for (const entry of entries) {
        const relPath = path.relative(projectRoot, path.join(dirPath, entry.name))
        const checkPath = entry.isDirectory() ? relPath + '/' : relPath
        try { if (ig.ignores(checkPath)) continue } catch { continue }

        if (entry.isDirectory()) {
          items.push(`${entry.name}/`)
        } else if (entry.isFile()) {
          try {
            const size = fs.statSync(path.join(dirPath, entry.name)).size
            const sizeStr = size < 1024 ? `${size}B`
              : size < 1024 * 1024 ? `${Math.round(size / 1024)}KB`
              : `${(size / (1024 * 1024)).toFixed(1)}MB`
            items.push(`${entry.name} (${sizeStr})`)
          } catch {
            items.push(entry.name)
          }
        }
      }

      return items.length > 0 ? items.join('\n') : '(empty directory)'
    },
  })

  const search_project = createTool({
    id: 'search_project',
    description: 'Search for text/patterns across the project codebase using grep. Returns matching file paths with line excerpts.',
    inputSchema: z.object({
      query: z.string().describe('Search text or pattern'),
      glob: z.string().optional().describe('Optional file glob filter, e.g. "*.ts" or "src/**/*.tsx"'),
    }),
    execute: async (input) => {
      try {
        const args = ['--no-heading', '--line-number', '--max-count=3', '-r']
        if (input.glob) args.push(`--include=${input.glob}`)
        args.push('--', input.query, '.')

        const result = execSync(`grep ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
          cwd: projectRoot,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          maxBuffer: 1024 * 1024,
          timeout: 10000,
        })

        const lines = result.split('\n').filter(Boolean)
        const truncated = lines.slice(0, MAX_SEARCH_RESULTS).map((line) =>
          line.length > MAX_SEARCH_LINE_LEN ? line.slice(0, MAX_SEARCH_LINE_LEN) + '...' : line
        )

        if (truncated.length === 0) return 'No matches found'
        const suffix = lines.length > MAX_SEARCH_RESULTS ? `\n... (${lines.length - MAX_SEARCH_RESULTS} more matches)` : ''
        return truncated.join('\n') + suffix
      } catch {
        return 'No matches found'
      }
    },
  })

  const get_project_overview = createTool({
    id: 'get_project_overview',
    description: 'Get a summary of the project: directory tree, key files (README, package.json, etc.), language stats. Call this first to understand the project structure.',
    inputSchema: z.object({}),
    execute: async () => buildProjectSummary(snapshot),
  })

  return {
    read_project_file,
    list_project_dir,
    search_project,
    get_project_overview,
  }
}

export type CodebaseTools = ReturnType<typeof createCodebaseTools>
