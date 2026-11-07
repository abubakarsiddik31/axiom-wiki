---
title: clip
description: Clip a URL and save it to raw/ for ingest.
---

:::tip
You can also use `axiom-wiki ingest <url>` to clip and ingest a URL in one step.
:::

```bash
axiom-wiki clip [url]
axiom-wiki clip [url] --lang bn
```

Fetches a URL, extracts the content, and saves it to `raw/`.

You are then prompted to ingest immediately or save for later. Ingested clips are tracked in `state.json` like any other source, so they participate in incremental compilation.

## Supported content types

- **HTML articles** — Readability extraction, converted to Markdown with `source_url` frontmatter
- **YouTube videos** — transcript with timestamps (no video download), see below
- **PDF URLs** — direct download
- **Image URLs** — direct download (`.png`, `.jpg`, `.webp`)

## YouTube transcripts

Any YouTube URL becomes a timestamped transcript, not a video download:

```bash
axiom-wiki clip https://www.youtube.com/watch?v=zjkBMFhNj_g
axiom-wiki ingest https://youtu.be/zjkBMFhNj_g        # clip + ingest in one step
```

Short links (`youtu.be`), `/shorts/`, `/embed/`, `/live/`, and `?t=` offsets are all recognised. The saved Markdown carries the title, channel, duration, publish date, and one paragraph every ~30–60 seconds, each prefixed with a `[12:34]` marker:

```markdown
---
title: "Intro to Large Language Models"
source_url: https://www.youtube.com/watch?v=zjkBMFhNj_g
source_type: youtube
video_id: zjkBMFhNj_g
channel: "Andrej Karpathy"
duration: 59:39
transcript_language: en
transcript_kind: auto-generated
clipped_at: 2026-11-08
---

# Intro to Large Language Models

**Channel:** Andrej Karpathy · **Duration:** 59:39 · **Transcript:** auto-generated (en) · **Source:** ...

## Intro

[0:05] So I wanted to talk about large language models...
```

Those markers are real citation locators: the compiler can write `^[intro-to-llms-2026-11-08.md#12:34]`, and `axiom-wiki lint --forensic` verifies the timestamp exists in the transcript.

If the video has chapters, the transcript is grouped under them as headings.

### No install step

Transcripts are downloaded with [yt-dlp](https://github.com/yt-dlp/yt-dlp), which Axiom fetches for you on first use: it grabs the official standalone build (~30 MB, no Python needed) into `~/.axiom/bin/yt-dlp`, verifies it runs, and reuses it forever after. The terminal shows the one-time progress.

Only subtitles are fetched (`--skip-download`), so no video or audio bytes are transferred.

Already have yt-dlp? Any of these is used instead, in this order: `AXIOM_YTDLP`, then a `yt-dlp` on your `PATH`, then `python3 -m yt_dlp`. To install it yourself, `brew install yt-dlp`, `pipx install yt-dlp`, or `winget install yt-dlp`.

### Caching

Two layers, so a repeat ingest costs nothing:

1. **Transcript cache** — parsed transcripts live in `~/.axiom/cache/youtube/<video-id>.<lang>.json`. Clipping the same video again (even in a different wiki) is instant and needs no network or yt-dlp.
2. **`raw/` reuse** — if the video is already saved in the current `raw/`, `clip` reports `Already saved` and skips the download entirely.

Delete `~/.axiom/cache/youtube` to force fresh transcripts.

| Environment variable | Purpose |
|---|---|
| `AXIOM_YTDLP` | Path to a specific `yt-dlp` binary (skips the managed copy) |
| `AXIOM_NO_AUTO_INSTALL` | `1` disables the automatic yt-dlp download |
| `AXIOM_NO_YT_CACHE` | `1` ignores the transcript cache |
| `AXIOM_HOME` | Where the managed binary and cache live (default `~/.axiom`) |
| `AXIOM_YTDLP_COOKIES_FROM_BROWSER` | `chrome`, `firefox`, `safari`, … — lets yt-dlp reuse your signed-in session when YouTube serves a bot check |
| `AXIOM_YTDLP_COOKIES` | Path to a Netscape `cookies.txt` file |

### Language

`--lang` picks the subtitle track (default `en`). If that language is missing, Axiom retries once with the video's own language and tells you which languages are available:

```bash
axiom-wiki ingest https://youtu.be/zjkBMFhNj_g --lang bn
```

### Rate limits

YouTube throttles subtitle requests (HTTP 429) when many are made in a short window. Axiom retries automatically with backoff (15s, then 45s) before giving up, and a cached or already-saved video never reaches the network at all. If it still fails:

- wait a few minutes and run the command again, or
- set `AXIOM_YTDLP_COOKIES_FROM_BROWSER=chrome` so requests come from a signed-in session, which has a much higher limit.

### Other limits

- Videos with no subtitles (and no auto-generated track) cannot be ingested — there is no speech-to-text fallback.
- A multi-hour video can exceed the model's context window. Prefer shorter videos, or a model with a larger window.
- Playlist parameters are ignored on purpose: one URL ingests one video.
