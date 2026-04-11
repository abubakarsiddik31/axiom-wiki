import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import ignore from 'ignore'

const STANDARD_IGNORES = [
  'node_modules', '.git', '.axiom', 'dist', 'build', 'out',
  '.next', '.nuxt', '.svelte-kit', 'coverage', '__pycache__',
  '.DS_Store', 'Thumbs.db', '*.lock', '*.log', '.env', '.env.*',
  'vendor', '.cache', '.turbo', '.vercel', '.netlify',
]

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

const KEY_FILE_NAMES = new Set([
  'readme.md', 'readme.txt', 'readme', 'readme.rst', 'readme.mdx',
  'package.json', 'cargo.toml', 'go.mod', 'pyproject.toml',
  'composer.json', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'makefile', 'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  'tsconfig.json', '.eslintrc.json', 'vite.config.ts', 'vite.config.js',
  'next.config.js', 'next.config.ts', 'nuxt.config.ts', 'svelte.config.js',
])

const MAX_KEY_FILE_BYTES = 50 * 1024
const MAX_TREE_DEPTH = 4
const COLLAPSE_THRESHOLD = 20

export interface KeyFile {
  path: string
  content: string
  sizeBytes: number
}

export interface FileEntry {
  relPath: string
  sizeBytes: number
  ext: string
  isBinary: boolean
}

export interface ProjectSnapshot {
  root: string
  totalFiles: number
  totalTextFiles: number
  totalSizeBytes: number
  totalTextSizeBytes: number
  totalWords: number
  languages: Record<string, number>
  tree: string
  keyFiles: KeyFile[]
  files: FileEntry[]
}

export function findProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim()
  } catch {
    return process.cwd()
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

interface DirNode {
  files: Array<{ name: string; sizeBytes: number }>
  children: Map<string, DirNode>
}

function buildDirNode(): DirNode {
  return { files: [], children: new Map() }
}

function countNodeFiles(node: DirNode): number {
  let count = node.files.length
  for (const child of node.children.values()) count += countNodeFiles(child)
  return count
}

function insertFile(root: DirNode, relPath: string, sizeBytes: number): void {
  const parts = relPath.split('/')
  let node = root
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i]!
    if (!node.children.has(seg)) node.children.set(seg, buildDirNode())
    node = node.children.get(seg)!
  }
  node.files.push({ name: parts[parts.length - 1]!, sizeBytes })
}

function renderNode(node: DirNode, prefix: string, depth: number, lines: string[]): void {
  if (depth > MAX_TREE_DEPTH) return

  const children = [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b))
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name))

  const items: Array<{ label: string; childKey?: string }> = []

  for (const [name, child] of children) {
    const n = countNodeFiles(child)
    const collapsed = depth >= MAX_TREE_DEPTH - 1 || n > COLLAPSE_THRESHOLD
    items.push({
      label: collapsed ? `${name}/ (${n} files)` : `${name}/`,
      childKey: collapsed ? undefined : name,
    })
  }
  for (const f of files) {
    items.push({ label: `${f.name} (${formatSize(f.sizeBytes)})` })
  }

  items.forEach((item, i) => {
    const last = i === items.length - 1
    lines.push(prefix + (last ? '└── ' : '├── ') + item.label)
    if (item.childKey) {
      const child = node.children.get(item.childKey)!
      renderNode(child, prefix + (last ? '    ' : '│   '), depth + 1, lines)
    }
  })
}

export async function walkProject(
  rootDir: string,
  onProgress?: (count: number) => void,
): Promise<ProjectSnapshot> {
  const ig = ignore().add(STANDARD_IGNORES)

  try {
    const gitignore = path.join(rootDir, '.gitignore')
    if (fs.existsSync(gitignore)) ig.add(fs.readFileSync(gitignore, 'utf-8'))
  } catch { /* skip */ }

  try {
    const axiomignore = path.join(rootDir, '.axiomignore')
    if (fs.existsSync(axiomignore)) ig.add(fs.readFileSync(axiomignore, 'utf-8'))
  } catch { /* skip */ }

  const files: FileEntry[] = []
  const keyFiles: KeyFile[] = []
  let progressCount = 0

  function walk(dir: string): void {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue

      const fullPath = path.join(dir, entry.name)
      const relPath = path.relative(rootDir, fullPath)

      try {
        const checkPath = entry.isDirectory() ? relPath + '/' : relPath
        if (ig.ignores(checkPath)) continue
      } catch { continue }

      if (entry.isDirectory()) { walk(fullPath); continue }
      if (!entry.isFile()) continue

      let sizeBytes = 0
      try { sizeBytes = fs.statSync(fullPath).size } catch { continue }

      const ext = path.extname(entry.name).toLowerCase()
      const isBinary = BINARY_EXTENSIONS.has(ext)

      files.push({ relPath, sizeBytes, ext, isBinary })
      progressCount++
      if (progressCount % 50 === 0) onProgress?.(progressCount)

      const isRoot = path.dirname(relPath) === '.'
      const baseLower = entry.name.toLowerCase()
      const isKeyByName = !isBinary && KEY_FILE_NAMES.has(baseLower) && sizeBytes <= MAX_KEY_FILE_BYTES
      const isKeyByPattern = !isBinary && isRoot && /^[a-z]+\.config\.(js|ts|json|cjs|mjs)$/i.test(entry.name) && sizeBytes <= MAX_KEY_FILE_BYTES
      if (isKeyByName || isKeyByPattern) {
        try {
          keyFiles.push({ path: relPath, content: fs.readFileSync(fullPath, 'utf-8'), sizeBytes })
        } catch { /* skip */ }
      }
    }
  }

  walk(rootDir)
  onProgress?.(files.length)

  // Deduplicate key files (e.g. multiple package.json in monorepos)
  // and prioritize root-level files
  const seenKeyNames = new Set<string>()
  const rootKeyFiles: KeyFile[] = []
  const nestedKeyFiles: KeyFile[] = []
  for (const kf of keyFiles) {
    const isRoot = !kf.path.includes('/')
    if (isRoot) {
      rootKeyFiles.push(kf)
      seenKeyNames.add(path.basename(kf.path).toLowerCase())
    } else {
      nestedKeyFiles.push(kf)
    }
  }
  // Only keep nested key files if we don't already have the same filename at root
  const dedupedKeyFiles = [
    ...rootKeyFiles,
    ...nestedKeyFiles.filter((kf) => !seenKeyNames.has(path.basename(kf.path).toLowerCase())),
  ]

  const textFiles = files.filter((f) => !f.isBinary)
  const totalSizeBytes = files.reduce((s, f) => s + f.sizeBytes, 0)
  const totalTextSizeBytes = textFiles.reduce((s, f) => s + f.sizeBytes, 0)
  const totalWords = Math.round(totalTextSizeBytes / 5)

  const languages: Record<string, number> = {}
  for (const f of files) {
    if (f.ext) languages[f.ext] = (languages[f.ext] ?? 0) + 1
  }

  const root = buildDirNode()
  for (const f of files) insertFile(root, f.relPath, f.sizeBytes)

  const treeLines = [`${path.basename(rootDir)}/`]
  renderNode(root, '', 0, treeLines)

  return {
    root: rootDir,
    totalFiles: files.length,
    totalTextFiles: textFiles.length,
    totalSizeBytes,
    totalTextSizeBytes,
    totalWords,
    languages,
    tree: treeLines.join('\n'),
    keyFiles: dedupedKeyFiles,
    files,
  }
}

export function gatherFilesForPaths(
  snapshot: ProjectSnapshot,
  paths: string[],
  maxTotalBytes: number = 80 * 1024,
  maxLinesPerFile: number = 200,
): Array<{ path: string; content: string }> {
  const result: Array<{ path: string; content: string }> = []
  let totalBytes = 0

  if (paths.length === 0) return result

  const matching = snapshot.files.filter((f) => {
    if (f.isBinary) return false
    return paths.some((p) =>
      p.endsWith('/') ? f.relPath.startsWith(p) : f.relPath === p
    )
  })

  for (const file of matching) {
    if (totalBytes >= maxTotalBytes) break
    const fullPath = path.join(snapshot.root, file.relPath)
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8')
      const lines = raw.split('\n')
      const truncated = lines.length > maxLinesPerFile
      const content = lines.slice(0, maxLinesPerFile).join('\n') + (truncated ? '\n... [truncated]' : '')
      const byteSize = Buffer.byteLength(content, 'utf-8')
      if (totalBytes + byteSize > maxTotalBytes) break
      result.push({ path: file.relPath, content })
      totalBytes += byteSize
    } catch { /* skip unreadable files */ }
  }

  return result
}
