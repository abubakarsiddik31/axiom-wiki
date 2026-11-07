import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  parseYouTubeUrl,
  parseTimeParam,
  parseVtt,
  cleanCueText,
  formatTimestamp,
  groupSegments,
  transcriptToMarkdown,
  readCachedTranscript,
  writeCachedTranscript,
  type TranscriptResult,
} from '../../src/core/youtube.js'
import { parseLocator, verifyLocatorInContent } from '../../src/core/citations.js'
import { resolveAssetName, managedYtDlpPath } from '../../src/core/ytdlp.js'

describe('parseYouTubeUrl', () => {
  it('parses watch URLs and drops playlist context', () => {
    const ref = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=4')
    expect(ref?.id).toBe('dQw4w9WgXcQ')
    expect(ref?.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('parses short, shorts, embed, live and nocookie URLs', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeUrl('https://m.youtube.com/live/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ')
  })

  it('carries the start offset through to the canonical URL', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=90')?.startSeconds).toBe(90)
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s')?.startSeconds).toBe(90)
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=90')?.url).toContain('t=90')
  })

  it('rejects non-YouTube and malformed input', () => {
    expect(parseYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=short')).toBeNull()
    expect(parseYouTubeUrl('not a url')).toBeNull()
    expect(parseYouTubeUrl('https://www.youtube.com/@somechannel')).toBeNull()
  })
})

describe('parseTimeParam', () => {
  it('parses seconds, minutes and hours', () => {
    expect(parseTimeParam('90')).toBe(90)
    expect(parseTimeParam('90s')).toBe(90)
    expect(parseTimeParam('1m30s')).toBe(90)
    expect(parseTimeParam('1h2m3s')).toBe(3723)
  })

  it('returns undefined for junk', () => {
    expect(parseTimeParam(null)).toBeUndefined()
    expect(parseTimeParam('')).toBeUndefined()
    expect(parseTimeParam('soon')).toBeUndefined()
  })
})

describe('cleanCueText', () => {
  it('strips inline word timings and karaoke tags', () => {
    expect(cleanCueText('<00:00:01.200><c>hello</c> <00:00:01.500><c>world</c>')).toBe('hello world')
  })

  it('decodes entities', () => {
    expect(cleanCueText('R&amp;D &quot;team&quot; &#39;ok&#39;')).toBe('R&D "team" \'ok\'')
  })
})

describe('parseVtt', () => {
  const manual = `WEBVTT
Kind: captions
Language: en

00:00:01.360 --> 00:00:03.040
Hello and welcome.

00:00:04.000 --> 00:00:06.500 align:start position:0%
Today we talk about compilers.

00:00:07.000 --> 00:00:08.000
Today we talk about compilers.

00:00:09.000 --> 00:00:10.000
[Music]
`

  it('parses cues, drops duplicate rolling lines and sound labels', () => {
    const segments = parseVtt(manual)
    expect(segments.map((s) => s.text)).toEqual([
      'Hello and welcome.',
      'Today we talk about compilers.',
    ])
    expect(segments[0].startMs).toBe(1360)
    expect(segments[1].startMs).toBe(4000)
  })

  it('removes the rolling window of auto-generated captions', () => {
    const rolling = `WEBVTT

00:00:01.000 --> 00:00:02.000
we are going to talk
about compilers today

00:00:02.000 --> 00:00:02.010
about compilers today

00:00:02.010 --> 00:00:04.000
about compilers today
and<00:00:02.500><c> why</c><00:00:02.700><c> they</c><00:00:03.000><c> matter</c>
`
    const segments = parseVtt(rolling)
    expect(segments.map((s) => s.text)).toEqual([
      'we are going to talk about compilers today',
      'and why they matter',
    ])
  })

  it('keeps genuine one-word repeats at cue boundaries', () => {
    const segments = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:02.000
no no no

00:00:02.000 --> 00:00:03.000
no that is wrong
`)
    expect(segments.map((s) => s.text)).toEqual(['no no no', 'no that is wrong'])
  })

  it('handles hour-long timestamps', () => {
    const segments = parseVtt('01:02:03.500 --> 01:02:05.000\nLate in the video.\n')
    expect(segments[0].startMs).toBe(3723500)
  })

  it('returns nothing for empty or header-only files', () => {
    expect(parseVtt('WEBVTT\n\n')).toEqual([])
  })
})

describe('formatTimestamp', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatTimestamp(5000)).toBe('0:05')
    expect(formatTimestamp(754000)).toBe('12:34')
  })

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatTimestamp(3723000)).toBe('1:02:03')
  })
})

describe('groupSegments', () => {
  it('splits on the character budget', () => {
    const segments = Array.from({ length: 10 }, (_, i) => ({
      startMs: i * 1000,
      endMs: i * 1000 + 900,
      text: 'x'.repeat(100),
    }))
    const paragraphs = groupSegments(segments, 250, 10_000)
    expect(paragraphs.length).toBeGreaterThan(1)
    expect(paragraphs[0].startMs).toBe(0)
    expect(paragraphs.flatMap((p) => p.text.split(' '))).toHaveLength(10)
  })

  it('splits on long pauses', () => {
    const paragraphs = groupSegments([
      { startMs: 0, endMs: 1000, text: 'one' },
      { startMs: 30_000, endMs: 31_000, text: 'two' },
    ])
    expect(paragraphs).toHaveLength(2)
  })
})

function makeTranscript(overrides: Partial<TranscriptResult> = {}): TranscriptResult {
  return {
    videoId: 'dQw4w9WgXcQ',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'A Talk About "Things"',
    channel: 'Some Channel',
    durationSeconds: 125,
    language: 'en',
    automatic: true,
    uploadDate: '2024-03-01',
    chapters: [
      { startMs: 0, title: 'Intro' },
      { startMs: 60_000, title: 'Deep dive' },
    ],
    segments: [
      { startMs: 0, endMs: 5000, text: 'First paragraph of the talk.' },
      { startMs: 65_000, endMs: 70_000, text: 'Second paragraph after the chapter break.' },
    ],
    ...overrides,
  }
}

describe('transcriptToMarkdown', () => {
  it('writes frontmatter, header and timestamped paragraphs', () => {
    const md = transcriptToMarkdown(makeTranscript())

    expect(md).toContain('source_type: youtube')
    expect(md).toContain('video_id: dQw4w9WgXcQ')
    expect(md).toContain('transcript_kind: auto-generated')
    expect(md).toContain('published: 2024-03-01')
    expect(md).toContain('**Transcript:** auto-generated (en)')

    // Quoted titles must not break the YAML block
    expect(md).toContain('title: "A Talk About \\"Things\\""')
    expect(md.split('---')[0]).not.toContain('title: A Talk')

    expect(md).toContain('[0:00] First paragraph of the talk.')
    expect(md).toContain('[1:05] Second paragraph after the chapter break.')
  })

  it('groups paragraphs under chapter headings', () => {
    const md = transcriptToMarkdown(makeTranscript())
    expect(md).toContain('## Intro')
    expect(md).toContain('## Deep dive')
    expect(md.indexOf('## Deep dive')).toBeLessThan(md.indexOf('[1:05]'))
  })

  it('marks manual transcripts and omits chapters when absent', () => {
    const md = transcriptToMarkdown(makeTranscript({ automatic: false, chapters: [] }))
    expect(md).toContain('transcript_kind: manual')
    expect(md).not.toContain('## ')
  })

  it('emits citable timestamps that the citation verifier accepts', () => {
    const md = transcriptToMarkdown(makeTranscript())
    const locator = parseLocator('#1:05')
    expect(locator.type).toBe('timestamp')
    expect(verifyLocatorInContent(locator, md)).toBe(true)
  })

  it('handles a transcript with no segments', () => {
    const md = transcriptToMarkdown(makeTranscript({ segments: [], chapters: [] }))
    expect(md).toContain('_No transcript text was returned for this video._')
  })
})

describe('yt-dlp asset selection', () => {
  it('picks the standalone build for each platform', () => {
    expect(resolveAssetName('darwin', 'arm64')).toBe('yt-dlp_macos')
    expect(resolveAssetName('darwin', 'x64')).toBe('yt-dlp_macos')
    expect(resolveAssetName('linux', 'x64')).toBe('yt-dlp_linux')
    expect(resolveAssetName('linux', 'arm64')).toBe('yt-dlp_linux_aarch64')
    expect(resolveAssetName('win32', 'x64')).toBe('yt-dlp.exe')
  })

  it('stores the managed binary under AXIOM_HOME', () => {
    const previous = process.env['AXIOM_HOME']
    process.env['AXIOM_HOME'] = '/tmp/axiom-test-home'
    try {
      expect(managedYtDlpPath('darwin')).toBe('/tmp/axiom-test-home/bin/yt-dlp')
      expect(managedYtDlpPath('win32')).toBe('/tmp/axiom-test-home/bin/yt-dlp.exe')
    } finally {
      if (previous === undefined) delete process.env['AXIOM_HOME']
      else process.env['AXIOM_HOME'] = previous
    }
  })
})

describe('transcript cache', () => {
  let home: string
  let previousHome: string | undefined
  let previousCache: string | undefined

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-cache-test-'))
    previousHome = process.env['AXIOM_HOME']
    previousCache = process.env['AXIOM_NO_YT_CACHE']
    process.env['AXIOM_HOME'] = home
    delete process.env['AXIOM_NO_YT_CACHE']
  })

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env['AXIOM_HOME']
    else process.env['AXIOM_HOME'] = previousHome
    if (previousCache === undefined) delete process.env['AXIOM_NO_YT_CACHE']
    else process.env['AXIOM_NO_YT_CACHE'] = previousCache
  })

  it('round-trips a transcript', () => {
    expect(readCachedTranscript('dQw4w9WgXcQ', 'en')).toBeNull()

    const transcript = makeTranscript()
    writeCachedTranscript(transcript, 'en')

    const cached = readCachedTranscript('dQw4w9WgXcQ', 'en')
    expect(cached?.title).toBe(transcript.title)
    expect(cached?.segments).toHaveLength(transcript.segments.length)
    expect(fs.existsSync(path.join(home, 'cache', 'youtube', 'dQw4w9WgXcQ.en.json'))).toBe(true)
  })

  it('serves a fallback-language transcript for the requested language', () => {
    writeCachedTranscript(makeTranscript({ language: 'bn' }), 'en')
    expect(readCachedTranscript('dQw4w9WgXcQ', 'en')?.language).toBe('bn')
    expect(readCachedTranscript('dQw4w9WgXcQ', 'bn')?.language).toBe('bn')
  })

  it('ignores the cache when AXIOM_NO_YT_CACHE=1', () => {
    writeCachedTranscript(makeTranscript(), 'en')
    process.env['AXIOM_NO_YT_CACHE'] = '1'
    expect(readCachedTranscript('dQw4w9WgXcQ', 'en')).toBeNull()
  })

  it('ignores corrupt cache entries', () => {
    const dir = path.join(home, 'cache', 'youtube')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'dQw4w9WgXcQ.en.json'), '{not json')
    expect(readCachedTranscript('dQw4w9WgXcQ', 'en')).toBeNull()
  })
})
