import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { axiomBinDir } from './paths.js'

export interface YtDlpLocation {
  command: string
  prefix: string[]
  /** True when this is the copy Axiom downloaded and manages itself. */
  managed: boolean
}

export const MISSING_YTDLP_MESSAGE = [
  'YouTube transcripts need yt-dlp, and it could not be installed automatically.',
  '',
  'Install it manually:',
  '  macOS        brew install yt-dlp',
  '  pip / pipx   pipx install yt-dlp',
  '  Windows      winget install yt-dlp',
  '',
  'Or point AXIOM_YTDLP at an existing binary.',
].join('\n')

export function managedYtDlpPath(platform: string = process.platform): string {
  return path.join(axiomBinDir(), platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
}

/** Official standalone build for this OS/arch (no Python required). */
export function resolveAssetName(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'win32') return 'yt-dlp.exe'
  if (platform === 'darwin') return 'yt-dlp_macos'
  if (arch === 'arm64') return 'yt-dlp_linux_aarch64'
  if (arch === 'arm') return 'yt-dlp_linux_armv7l'
  return 'yt-dlp_linux'
}

function works(command: string, prefix: string[]): boolean {
  try {
    execFileSync(command, [...prefix, '--version'], { stdio: 'ignore', timeout: 15000 })
    return true
  } catch {
    return false
  }
}

/** Finds a usable yt-dlp: explicit override, our managed copy, PATH, or a Python module. */
export function findYtDlp(): YtDlpLocation | null {
  const override = process.env['AXIOM_YTDLP']?.trim()
  if (override && works(override, [])) {
    return { command: override, prefix: [], managed: false }
  }

  const managed = managedYtDlpPath()
  if (fs.existsSync(managed) && works(managed, [])) {
    return { command: managed, prefix: [], managed: true }
  }

  for (const candidate of [
    { command: 'yt-dlp', prefix: [] as string[] },
    { command: 'yt-dlp.exe', prefix: [] as string[] },
    { command: 'python3', prefix: ['-m', 'yt_dlp'] },
    { command: 'python', prefix: ['-m', 'yt_dlp'] },
  ]) {
    if (works(candidate.command, candidate.prefix)) {
      return { ...candidate, managed: false }
    }
  }

  return null
}

const DOWNLOAD_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

/**
 * Downloads the standalone yt-dlp build into `~/.axiom/bin` and verifies it runs.
 * This is what makes `ingest <youtube-url>` work on a fresh machine with no setup.
 */
export async function installYtDlp(
  onStatus?: (message: string) => void,
): Promise<YtDlpLocation> {
  const target = managedYtDlpPath()
  const asset = resolveAssetName()
  const url = `${DOWNLOAD_BASE}/${asset}`
  const temp = `${target}.download`

  fs.mkdirSync(path.dirname(target), { recursive: true })
  onStatus?.('Downloading yt-dlp (one-time, ~30 MB)…')

  let response: Response
  try {
    response = await fetch(url, { redirect: 'follow' })
  } catch (err) {
    throw new Error(`Could not reach GitHub to download yt-dlp: ${(err as Error).message}\n\n${MISSING_YTDLP_MESSAGE}`)
  }

  if (!response.ok) {
    throw new Error(`yt-dlp download failed (HTTP ${response.status}).\n\n${MISSING_YTDLP_MESSAGE}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength < 1_000_000) {
    throw new Error(`yt-dlp download looks truncated (${bytes.byteLength} bytes).\n\n${MISSING_YTDLP_MESSAGE}`)
  }

  fs.writeFileSync(temp, bytes, { mode: 0o755 })
  try {
    fs.chmodSync(temp, 0o755)
  } catch {
    // Windows: not needed
  }
  fs.rmSync(target, { force: true }) // Windows rename fails over an existing file
  fs.renameSync(temp, target)

  if (!works(target, [])) {
    fs.rmSync(target, { force: true })
    throw new Error(`The downloaded yt-dlp binary would not run on this system.\n\n${MISSING_YTDLP_MESSAGE}`)
  }

  onStatus?.('yt-dlp installed')
  return { command: target, prefix: [], managed: true }
}

/**
 * Returns a usable yt-dlp, downloading one on first use unless
 * AXIOM_NO_AUTO_INSTALL=1 is set.
 */
export async function ensureYtDlp(
  onStatus?: (message: string) => void,
): Promise<YtDlpLocation> {
  const existing = findYtDlp()
  if (existing) return existing

  if (process.env['AXIOM_NO_AUTO_INSTALL'] === '1') {
    throw new Error(MISSING_YTDLP_MESSAGE)
  }

  return installYtDlp(onStatus)
}
