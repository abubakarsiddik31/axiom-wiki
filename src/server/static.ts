import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type http from 'http'
import type { URL } from 'url'

/**
 * Static hosting for the built frontend (`apps/web` -> `dist/web`).
 *
 * The SPA owns every non-API path once a build exists: unknown routes fall back
 * to `index.html` so the client router can render a 404. Missing files with an
 * extension are a real 404 (the bundler emitted an asset that no longer exists).
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}

/** Walks up from this module until it finds the published package root. */
function findPackageRoot(start: string): string {
  let dir = start
  for (let i = 0; i < 7; i += 1) {
    const manifest = path.join(dir, 'package.json')
    if (fs.existsSync(manifest)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { name?: string }
        if (pkg.name === 'axiom-wiki') return dir
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return start
}

/**
 * Resolves the directory holding the built SPA.
 *
 * Order: explicit override (CLI/env), the published `dist/web`, then the
 * monorepo `apps/web/dist` used when the frontend is built in isolation.
 */
export function resolveWebDir(explicit?: string): string | null {
  if (explicit === '') return null
  const here = path.dirname(fileURLToPath(import.meta.url))
  const root = findPackageRoot(here)
  const candidates = [
    explicit,
    process.env['AXIOM_WEB_DIR'],
    path.join(root, 'dist', 'web'),
    path.join(root, 'apps', 'web', 'dist'),
  ].filter((c): c is string => Boolean(c))

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate
  }
  return null
}

function sendFile(
  res: http.ServerResponse,
  abs: string,
  cacheControl: string,
  headOnly: boolean,
): void {
  const ext = path.extname(abs).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': cacheControl,
  })
  if (headOnly) {
    res.end()
    return
  }
  fs.createReadStream(abs).pipe(res)
}

function sendMissing(res: http.ServerResponse, pathname: string): void {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(`Not found: ${pathname}`)
}

/**
 * Serves a file from the SPA build. Returns true when a response was written.
 * Always returns true while the SPA is enabled — unknown paths render index.html.
 */
export function serveStatic(
  webDir: string,
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const headOnly = req.method === 'HEAD'

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    sendMissing(res, url.pathname)
    return true
  }

  if (pathname.includes('\0')) {
    sendMissing(res, pathname)
    return true
  }

  const indexFile = path.join(webDir, 'index.html')
  const rel = pathname.replace(/^\/+/, '')
  const abs = path.resolve(webDir, rel)
  const withinRoot = abs === webDir || abs.startsWith(webDir + path.sep)

  if (!withinRoot) {
    sendMissing(res, pathname)
    return true
  }

  if (rel && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    const cache = pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
    sendFile(res, abs, cache, headOnly)
    return true
  }

  // A missing file that looked like an asset should 404 rather than return HTML.
  if (path.extname(rel)) {
    sendMissing(res, pathname)
    return true
  }

  sendFile(res, indexFile, 'no-cache', headOnly)
  return true
}
