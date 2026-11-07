import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { ensureYtDlp } from './ytdlp.js'
import { axiomCacheDir } from './paths.js'

// ── URL parsing ─────────────────────────────────────────────────────────────

export interface YouTubeRef {
  id: string
  /** Canonical watch URL with tracking/playlist params stripped. */
  url: string
  /** Start offset from a `?t=` / `?start=` / `#t=` param, in seconds. */
  startSeconds?: number
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
])

/** Parses `90`, `90s`, `1m30s`, `1h2m3s` into seconds. Returns undefined if unparseable. */
export function parseTimeParam(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined
  const value = raw.trim().toLowerCase()
  if (/^\d+$/.test(value)) return parseInt(value, 10)
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined
  return (parseInt(m[1] ?? '0', 10) * 3600) + (parseInt(m[2] ?? '0', 10) * 60) + parseInt(m[3] ?? '0', 10)
}

/**
 * Recognises every common YouTube URL shape and returns the video id.
 * Returns null for anything else so callers can fall through to article clipping.
 */
export function parseYouTubeUrl(input: string): YouTubeRef | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!YOUTUBE_HOSTS.has(host)) return null

  const segments = url.pathname.split('/').filter(Boolean)
  let id: string | undefined

  if (host === 'youtu.be') {
    id = segments[0]
  } else if (segments[0] === 'watch') {
    id = url.searchParams.get('v') ?? undefined
  } else if (['shorts', 'embed', 'live', 'v', 'e'].includes(segments[0])) {
    id = segments[1]
  }

  if (!id || !VIDEO_ID_RE.test(id)) return null

  const startSeconds =
    parseTimeParam(url.searchParams.get('t') ?? url.searchParams.get('start')) ??
    parseTimeParam(new URLSearchParams(url.hash.replace(/^#/, '')).get('t'))

  const canonical = new URL('https://www.youtube.com/watch')
  canonical.searchParams.set('v', id)
  if (startSeconds !== undefined) canonical.searchParams.set('t', String(startSeconds))

  return { id, url: canonical.toString(), ...(startSeconds !== undefined ? { startSeconds } : {}) }
}

// ── yt-dlp arguments ────────────────────────────────────────────────────────

function ytDlpExtraArgs(): string[] {
  const args: string[] = []
  const cookies = process.env['AXIOM_YTDLP_COOKIES']?.trim()
  const browser = process.env['AXIOM_YTDLP_COOKIES_FROM_BROWSER']?.trim()
  if (cookies) args.push('--cookies', cookies)
  else if (browser) args.push('--cookies-from-browser', browser)
  return args
}

// ── Transcript parsing ──────────────────────────────────────────────────────

export interface TranscriptSegment {
  startMs: number
  endMs: number
  text: string
}

export interface TranscriptResult {
  videoId: string
  url: string
  title: string
  channel: string
  durationSeconds: number
  language: string
  automatic: boolean
  segments: TranscriptSegment[]
  chapters: Array<{ startMs: number; title: string }>
  uploadDate?: string
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  '#39': "'", lrm: '', rlm: '', ndash: '–', mdash: '—',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
    const key = name.toLowerCase()
    if (key.startsWith('#x')) {
      const code = parseInt(key.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (key.startsWith('#')) {
      const code = parseInt(key.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return ENTITIES[key] ?? match
  })
}

/** Strips VTT markup (`<c>`, `<00:00:01.234>`), decodes entities, collapses whitespace. */
export function cleanCueText(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

/** True for cues that are only sound labels — `[Music]`, `[Applause]`, `♪♪♪`. */
function isNoise(text: string): boolean {
  if (!text) return true
  if (/^[♪\s]+$/.test(text)) return true
  return /^[[(](?:music|applause|laughter|silence|intro|outro)[\])]$/i.test(text)
}

function parseVttTime(raw: string): number {
  const parts = raw.trim().split(':')
  const seconds = parseFloat(parts.pop() ?? '0')
  const minutes = parts.length ? parseInt(parts.pop() ?? '0', 10) : 0
  const hours = parts.length ? parseInt(parts.pop() ?? '0', 10) : 0
  return Math.round(((hours * 3600) + (minutes * 60) + seconds) * 1000)
}

/**
 * How many words at the start of `words` repeat the tail of `emitted`.
 * YouTube's auto-captions are a rolling window: every cue re-states the
 * previous line before adding new words, so naive concatenation triplicates
 * the transcript. Requiring a whole repeated phrase avoids eating genuine
 * one-word stutters.
 */
function overlapLength(emitted: string[], words: string[], minOverlap = 3, maxWindow = 40): number {
  const max = Math.min(words.length, emitted.length, maxWindow)
  for (let size = max; size >= minOverlap; size--) {
    let matched = true
    for (let i = 0; i < size; i++) {
      if (emitted[emitted.length - size + i] !== words[i]) {
        matched = false
        break
      }
    }
    if (matched) return size
  }
  return 0
}

/**
 * Parses WebVTT into ordered cues, dropping only the words that repeat the
 * tail of what was already emitted. Works for plain manual tracks (no overlap,
 * every word kept) and rolling auto-generated tracks alike.
 */
export function parseVtt(vtt: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  const emitted: string[] = []
  const blocks = vtt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '')
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex === -1) continue

    const [startRaw, endRaw] = lines[timingIndex].split('-->')
    const startMs = parseVttTime(startRaw)
    const endMs = parseVttTime((endRaw ?? '').trim().split(/\s+/)[0] ?? '')
    const text = cleanCueText(lines.slice(timingIndex + 1).join(' '))

    if (isNoise(text)) continue

    const words = text.split(' ').filter(Boolean)
    const fresh = words.slice(overlapLength(emitted, words))
    if (fresh.length === 0) continue

    emitted.push(...fresh)
    segments.push({
      startMs,
      endMs: Number.isFinite(endMs) ? endMs : startMs,
      text: fresh.join(' '),
    })
  }

  return segments
}

// ── Markdown rendering ──────────────────────────────────────────────────────

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

export interface TranscriptParagraph {
  startMs: number
  text: string
}

/**
 * Merges cues into readable paragraphs. Auto-generated tracks arrive in
 * 3–8 second fragments, which read badly and burn headings if left alone.
 */
export function groupSegments(
  segments: TranscriptSegment[],
  maxChars = 480,
  maxGapMs = 5000,
): TranscriptParagraph[] {
  const paragraphs: TranscriptParagraph[] = []
  let current: { startMs: number; lastEndMs: number; parts: string[] } | null = null

  for (const segment of segments) {
    if (current) {
      const size = current.parts.join(' ').length + segment.text.length
      const gap = segment.startMs - current.lastEndMs
      if (size > maxChars || gap > maxGapMs) {
        paragraphs.push({ startMs: current.startMs, text: current.parts.join(' ') })
        current = null
      }
    }
    if (!current) {
      current = { startMs: segment.startMs, lastEndMs: segment.endMs, parts: [segment.text] }
    } else {
      current.parts.push(segment.text)
      current.lastEndMs = segment.endMs
    }
  }

  if (current) paragraphs.push({ startMs: current.startMs, text: current.parts.join(' ') })
  return paragraphs
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

export function transcriptToMarkdown(transcript: TranscriptResult): string {
  const paragraphs = groupSegments(transcript.segments)
  const lines: string[] = ['---']

  lines.push(`title: ${yamlString(transcript.title)}`)
  lines.push(`source_url: ${transcript.url}`)
  lines.push('source_type: youtube')
  lines.push(`video_id: ${transcript.videoId}`)
  lines.push(`channel: ${yamlString(transcript.channel)}`)
  lines.push(`duration: ${formatTimestamp(transcript.durationSeconds * 1000)}`)
  lines.push(`transcript_language: ${transcript.language}`)
  lines.push(`transcript_kind: ${transcript.automatic ? 'auto-generated' : 'manual'}`)
  if (transcript.uploadDate) lines.push(`published: ${transcript.uploadDate}`)
  lines.push(`clipped_at: ${new Date().toISOString().slice(0, 10)}`)
  lines.push('---', '')

  lines.push(`# ${transcript.title}`, '')
  lines.push(
    [
      `**Channel:** ${transcript.channel}`,
      `**Duration:** ${formatTimestamp(transcript.durationSeconds * 1000)}`,
      `**Transcript:** ${transcript.automatic ? 'auto-generated' : 'manual'} (${transcript.language})`,
      `**Source:** ${transcript.url}`,
    ].join(' · '),
  )
  lines.push('')

  if (paragraphs.length === 0) {
    lines.push('_No transcript text was returned for this video._', '')
    return lines.join('\n')
  }

  const chapters = [...transcript.chapters].sort((a, b) => a.startMs - b.startMs)
  let nextChapter = 0

  for (const paragraph of paragraphs) {
    while (nextChapter < chapters.length && paragraph.startMs >= chapters[nextChapter].startMs) {
      lines.push(`## ${chapters[nextChapter].title}`, '')
      nextChapter++
    }
    lines.push(`[${formatTimestamp(paragraph.startMs)}] ${paragraph.text}`, '')
  }

  return lines.join('\n')
}

// ── Fetching via yt-dlp ─────────────────────────────────────────────────────

interface ExecOutcome {
  stdout: string
  stderr: string
}

function run(command: string, args: string[], timeoutMs: number): Promise<ExecOutcome> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }))
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

interface YtInfo {
  id?: string
  title?: string
  uploader?: string
  channel?: string
  duration?: number
  upload_date?: string
  language?: string
  chapters?: Array<{ start_time?: number; title?: string }>
  subtitles?: Record<string, unknown>
  automatic_captions?: Record<string, unknown>
}

function availableLanguages(info: YtInfo): string[] {
  const manual = Object.keys(info.subtitles ?? {})
  const automatic = Object.keys(info.automatic_captions ?? {})
  return [...new Set([...manual, ...automatic])]
}

function formatUploadDate(raw: string | undefined): string | undefined {
  if (!raw || !/^\d{8}$/.test(raw)) return undefined
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

/** yt-dlp (or YouTube) told us to slow down. Retryable. */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitError'
  }
}

function friendlyYtDlpError(err: unknown): Error {  const stderr = String((err as { stderr?: string }).stderr ?? '')
  const message = err instanceof Error ? err.message : String(err)
  const combined = `${message}\n${stderr}`

  if (/HTTP Error 429|Too Many Requests/i.test(combined)) {
    return new RateLimitError('YouTube rate-limited this transcript request (HTTP 429).')
  }
  if (/Sign in to confirm|not a bot/i.test(combined)) {
    return new Error(
      'YouTube asked for a bot check instead of serving the transcript. ' +
      'Set AXIOM_YTDLP_COOKIES_FROM_BROWSER=chrome (or firefox/safari) so yt-dlp can use your signed-in session, then retry.',
    )
  }
  if (/Private video|members-only|Join this channel/i.test(combined)) {
    return new Error('This video is private or members-only — no transcript is available.')
  }
  if (/Video unavailable|does not exist|has been removed/i.test(combined)) {
    return new Error('This video is unavailable.')
  }
  return new Error(`yt-dlp failed: ${(stderr.trim() || message).split('\n').slice(-3).join(' ')}`)
}

export interface FetchTranscriptOptions {
  /** Subtitle language to request. Defaults to `en`. */
  lang?: string
  /** Progress callback for downloads, installs and retry waits. */
  onStatus?: (message: string) => void
}

/** Backoff between retries when YouTube answers 429. Override with AXIOM_YT_RETRY_MS=5000,15000. */
const RATE_LIMIT_RETRY_MS = [15_000, 45_000]

function retryDelays(): number[] {
  const raw = process.env['AXIOM_YT_RETRY_MS']?.trim()
  if (!raw) return RATE_LIMIT_RETRY_MS
  const parsed = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0)
  return parsed.length > 0 ? parsed : RATE_LIMIT_RETRY_MS
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cachePathFor(videoId: string, lang: string): string {
  return path.join(axiomCacheDir('youtube'), `${videoId}.${lang.toLowerCase()}.json`)
}

/** Cached transcripts are free: they cost zero requests and work offline. */
export function readCachedTranscript(videoId: string, lang: string): TranscriptResult | null {
  if (process.env['AXIOM_NO_YT_CACHE'] === '1') return null
  const file = cachePathFor(videoId, lang)
  if (!fs.existsSync(file)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as TranscriptResult
    if (parsed?.videoId !== videoId || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function writeCachedTranscript(transcript: TranscriptResult, requestedLang: string): void {
  if (process.env['AXIOM_NO_YT_CACHE'] === '1') return
  try {
    const payload = JSON.stringify(transcript)
    fs.mkdirSync(axiomCacheDir('youtube'), { recursive: true })
    fs.writeFileSync(cachePathFor(transcript.videoId, transcript.language), payload, 'utf-8')
    if (requestedLang.toLowerCase() !== transcript.language.toLowerCase()) {
      fs.writeFileSync(cachePathFor(transcript.videoId, requestedLang), payload, 'utf-8')
    }
  } catch {
    // A cache write failure must never break ingestion.
  }
}

/**
 * Fetches subtitles (no video bytes) and returns the parsed transcript.
 * Order of operations: local cache → managed/auto-installed yt-dlp → download.
 * Rate-limited downloads retry with backoff before failing.
 */
export async function fetchYouTubeTranscript(
  input: string,
  options: FetchTranscriptOptions = {},
): Promise<TranscriptResult> {
  const ref = parseYouTubeUrl(input)
  if (!ref) throw new Error(`Not a YouTube URL: ${input}`)

  const requested = (options.lang || 'en').trim()

  const cached = readCachedTranscript(ref.id, requested)
  if (cached) {
    options.onStatus?.(`Using cached transcript (${cached.language})`)
    return cached
  }

  const ytdlp = await ensureYtDlp(options.onStatus)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-yt-'))

  const download = async (lang: string): Promise<void> => {
    const args = [
      ...ytdlp.prefix,
      ...ytDlpExtraArgs(),
      '--skip-download',
      '--no-playlist',
      '--no-warnings',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', lang,
      '--sub-format', 'vtt',
      '--convert-subs', 'vtt',
      '--write-info-json',
      '--retries', '2',
      '--socket-timeout', '20',
      '-o', path.join(tmpDir, '%(id)s.%(ext)s'),
      ref.url,
    ]
    try {
      await run(ytdlp.command, args, 120_000)
    } catch (err) {
      // yt-dlp exits non-zero when *any* requested track fails (429 on an
      // extra language, for example) even though the file we need landed.
      const hasSubtitle = fs.readdirSync(tmpDir).some((name) => name.endsWith('.vtt'))
      if (!hasSubtitle) throw friendlyYtDlpError(err)
      process.stderr.write('[axiom] yt-dlp reported an error but wrote subtitles — continuing.\n')
    }
  }

  const readInfo = (): YtInfo | null => {    const infoPath = path.join(tmpDir, `${ref.id}.info.json`)
    if (!fs.existsSync(infoPath)) return null
    try {
      return JSON.parse(fs.readFileSync(infoPath, 'utf-8')) as YtInfo
    } catch {
      return null
    }
  }

  const findVtt = (): string | null => {
    const entries = fs.readdirSync(tmpDir).filter((name) => name.endsWith('.vtt'))
    if (entries.length === 0) return null
    const exact = entries.find((name) => name === `${ref.id}.${requested}.vtt`)
    const file = exact ?? entries[0]
    return path.join(tmpDir, file)
  }

  const downloadWithRetry = async (lang: string): Promise<void> => {
    const delays = retryDelays()
    for (let attempt = 0; ; attempt++) {
      try {
        await download(lang)
        return
      } catch (err) {
        if (!(err instanceof RateLimitError)) throw err
        if (attempt >= delays.length) {
          throw new Error(
            'YouTube rate-limited transcript downloads (HTTP 429), even after retrying. ' +
            'Wait a few minutes and run the command again — or set AXIOM_YTDLP_COOKIES_FROM_BROWSER=chrome ' +
            'to reuse a signed-in session, which has a much higher limit.',
          )
        }
        const waitMs = delays[attempt]
        options.onStatus?.(`YouTube rate limit hit — retrying in ${Math.round(waitMs / 1000)}s…`)
        await sleep(waitMs)
        for (const stale of fs.readdirSync(tmpDir)) {
          if (stale.endsWith('.vtt') || stale.endsWith('.info.json')) {
            fs.rmSync(path.join(tmpDir, stale), { force: true })
          }
        }
      }
    }
  }

  try {
    await downloadWithRetry(requested)

    let info = readInfo()
    let vttPath = findVtt()
    let language = requested

    // No track in the requested language — follow the video's own language once.
    if (!vttPath && info) {
      const meta = info
      const available = availableLanguages(meta)
      const fallback =
        (meta.language && available.find((l) => l === meta.language || l.startsWith(`${meta.language}-`))) ??
        available.find((l) => !l.startsWith('en')) ??
        available[0]

      if (fallback && fallback !== requested) {
        for (const stale of fs.readdirSync(tmpDir)) {
          if (stale.endsWith('.vtt')) fs.rmSync(path.join(tmpDir, stale), { force: true })
        }
        await downloadWithRetry(fallback)
        info = readInfo()
        vttPath = findVtt()
        language = fallback
      }
    }

    if (!info) throw new Error('yt-dlp returned no metadata for this video.')
    if (!vttPath) {
      const available = availableLanguages(info)
      const hint = available.length
        ? ` Available: ${available.slice(0, 12).join(', ')}. Re-run with --lang <code>.`
        : ' This video has no subtitles at all.'
      throw new Error(`No "${requested}" transcript for this video.${hint}`)
    }

    const segments = parseVtt(fs.readFileSync(vttPath, 'utf-8'))
    if (segments.length === 0) {
      throw new Error('The subtitle track for this video is empty — nothing to ingest.')
    }
    const manual = Object.keys(info.subtitles ?? {}).some(
      (code) => code === language || code.startsWith(`${language}-`),
    )

    const result: TranscriptResult = {
      videoId: ref.id,
      url: ref.url,
      title: info.title?.trim() || `YouTube video ${ref.id}`,
      channel: (info.channel || info.uploader || 'Unknown channel').trim(),
      durationSeconds: typeof info.duration === 'number' ? info.duration : 0,
      language,
      automatic: !manual,
      segments,
      chapters: (info.chapters ?? [])
        .filter((c) => typeof c.start_time === 'number' && Boolean(c.title?.trim()))
        .map((c) => ({ startMs: Math.round((c.start_time as number) * 1000), title: (c.title as string).trim() })),
      uploadDate: formatUploadDate(info.upload_date),
    }

    writeCachedTranscript(result, requested)
    return result
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
