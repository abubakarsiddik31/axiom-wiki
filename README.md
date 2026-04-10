# Axiom Wiki

**The wiki that maintains itself.**

[![npm version](https://img.shields.io/npm/v/axiom-wiki)](https://www.npmjs.com/package/axiom-wiki)
[![License: ELv2](https://img.shields.io/badge/License-Elastic%20v2-blue.svg)](https://www.elastic.co/licensing/elastic-license)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

Axiom Wiki turns a folder of raw documents into a persistent, AI-maintained personal knowledge base. Unlike RAG systems that re-derive answers from raw sources on every query, Axiom compiles knowledge into an interconnected wiki of markdown pages — and keeps it current as new sources arrive.

The human curates sources and asks questions. The AI does everything else: summarising, cross-referencing, filing, updating, and maintaining consistency across all pages.

> **Inspired by** Andrej Karpathy's [llm-wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — the idea that LLMs should maintain a persistent, compounding wiki rather than re-derive answers from raw sources on every query.

---

## Quick Start

```bash
npm install -g axiom-wiki
axiom-wiki init
```

The setup wizard will ask for your API key, wiki directory, and raw sources folder. It scaffolds the wiki structure and processes any existing files in your raw folder. When it's done, your wiki is live.

Drop a PDF or markdown file into your `raw/` folder, then:

```bash
axiom-wiki ingest
```

The agent reads the file, extracts entities and concepts, creates wiki pages, and updates the index — all automatically.

---

## Installation

```bash
# npm global install
npm install -g axiom-wiki

# npx (no install required)
npx axiom-wiki init

# Docker
docker run -it -v $(pwd):/wiki axiomwiki/axiom-wiki init
```

---

## Supported LLM Providers

| Provider | Models | Free Tier | Get API Key |
|---|---|---|---|
| **Google Gemini** *(recommended)* | Gemini 3.1 Pro, 3 Flash, 2.5 Pro, 2.0 Flash | Yes | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| **OpenAI** | GPT-5.4, GPT-5.4 Mini, GPT-5.4 Nano | No | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | No | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| **Ollama** *(local, no key)* | Llama 3.2, Llama 3.1, Mistral, Qwen 2.5 | Free | [ollama.com](https://ollama.com) |

Switch provider or model at any time:

```bash
axiom-wiki model
```

---

## Commands

```
axiom-wiki init                    First-time setup wizard
axiom-wiki ingest [file]           Ingest a source file, or scan raw/ for new files
axiom-wiki ingest [file] --interactive  Interactive ingest with topic review
axiom-wiki query                   Interactive chat against your wiki
axiom-wiki watch                   Auto-ingest new files dropped into raw/
axiom-wiki clip [url]              Clip a URL and save it to raw/
axiom-wiki sources                 Browse and manage ingested sources
axiom-wiki review                  Review and resolve wiki contradictions
axiom-wiki model                   Switch LLM provider or model
axiom-wiki lint                    Wiki health check (orphans, stale claims, broken links)
axiom-wiki status                  Wiki statistics
axiom-wiki mcp                     Start MCP server (for Claude Code / Cursor)
```

---

## Watch Mode

Automatically ingest files as they land in `raw/`:

```bash
axiom-wiki watch
```

Drop any supported file into your `raw/` folder and it is ingested within seconds. Watch mode respects `.axiomignore` and skips already-ingested files. Press `q` to stop.

---

## Web Clipper

Clip any URL directly into your wiki:

```bash
axiom-wiki clip https://example.com/article
```

Axiom fetches the page, extracts the article content via Readability, converts it to Markdown with frontmatter, and saves it to `raw/`. You can ingest immediately or later.

**Supported content types:**
- HTML articles — Readability extraction → Markdown with `source_url` frontmatter
- PDF URLs — direct download
- Image URLs — direct download (`.png`, `.jpg`, `.webp`)

---

## Interactive Ingest

Take control of what gets written before the agent starts:

```bash
axiom-wiki ingest notes.md --interactive
```

The agent reads the source, presents the key topics it found, and waits for your input before writing any pages:

```
Agent: I found these key topics: Alan Turing, Enigma Machine, Church-Turing Thesis.
       Any focus areas, things to skip, or framing to apply?
> Focus on the mathematics. Skip the wartime narrative.
```

After pages are written, it summarises what was created and waits for your confirmation before updating the index.

---

## Source Management

View and manage everything you have ingested:

```bash
axiom-wiki sources
```

Navigate with `↑↓`, then:

| Key | Action |
|-----|--------|
| `v` | View the source's wiki summary page |
| `r` | Mark for re-ingest (next ingest will diff) |
| `d` | Delete the source summary page |
| `q` | Quit |

**Re-ingest:** When you run `ingest` on a source that already has a wiki summary, Axiom automatically compares old and new content and only updates pages that have changed.

---

## Contradiction Resolution

Find and resolve conflicting information across sources:

```bash
axiom-wiki review
```

When ingesting, if the agent detects a conflict between sources it marks the affected page with a `⚠️ Contradiction:` block. The review screen surfaces all unresolved contradictions and proposes AI-assisted resolutions.

```
▶ entities/alan-turing.md
  ⚠️ Contradiction: notes.md says born 1912, wikipedia.md says born 1912-06-23.

AI: Both sources agree on 1912. Wikipedia provides the full date.
    I recommend "born 23 June 1912".

Apply this resolution? (Y/n/e=edit)
```

---

## Ollama — Run Fully Offline

Run Axiom entirely on-device with no API key:

1. Install Ollama: [ollama.com](https://ollama.com)
2. Pull a model: `ollama pull llama3.2`
3. Run `axiom-wiki init` and select **Ollama (local)**

Axiom connects to `http://localhost:11434` by default and validates the connection during setup.

**Docker + Ollama:**

```yaml
services:
  axiom-wiki:
    image: axiomwiki/axiom-wiki
    volumes:
      - ./wiki:/app/wiki
      - ./raw:/app/raw
    environment:
      - OLLAMA_BASE_URL=http://ollama:11434/api
  ollama:
    image: ollama/ollama
    volumes:
      - ollama_data:/root/.ollama
volumes:
  ollama_data:
```

---

## .axiomignore

Exclude files from watch mode and batch ingest using `.gitignore` syntax. A default `.axiomignore` is created in your `raw/` folder during `init`:

```
# axiomignore — patterns to skip during watch/ingest

# Temporary files
*.tmp
*.swp
.DS_Store
```

Add your own patterns:

```
# Ignore an archive folder
archive/

# Ignore a specific file
draft-do-not-ingest.md
```

---

## Claude Code / MCP Integration

Axiom Wiki exposes all its tools as an MCP server, so you can query and update your wiki directly from Claude Code, Cursor, or any MCP-compatible client.

**Step 1.** Start the MCP server:

```bash
axiom-wiki mcp
```

**Step 2.** Add to your Claude Code MCP config (`.claude/mcp_settings.json`):

```json
{
  "axiom-wiki": {
    "command": "axiom-wiki",
    "args": ["mcp"],
    "env": {}
  }
}
```

Or with npx (no global install required):

```json
{
  "axiom-wiki": {
    "command": "npx",
    "args": ["axiom-wiki", "mcp"],
    "env": {}
  }
}
```

**Step 3.** Restart Claude Code. Available tools:

- `read_page` — read any wiki page
- `write_page` — create or update a page
- `search_wiki` — full-text search across all pages
- `list_pages` — browse the wiki catalog
- `ingest_source` — process a raw file into the wiki
- `get_status` — wiki statistics
- `lint_wiki` — health check data
- `update_index` — rebuild the wiki index
- `append_log` — add a log entry
- `list_sources` — all ingested sources with dates
- `get_source` — read a source's wiki summary
- `remove_source` — remove a source summary page
- `get_contradictions` — find all unresolved contradiction blocks
- `resolve_contradiction` — apply a resolution to a contradiction

---

## Wiki Structure

```
my-wiki/
  raw/              ← Drop your source files here (PDF, MD, DOCX, images, HTML)
    .axiomignore    ← Patterns to exclude from watch/ingest
    assets/         ← Images and attachments
  wiki/
    pages/
      entities/     ← People, places, organisations
      concepts/     ← Ideas, topics, theories
      sources/      ← One summary page per source file
      analyses/     ← Filed answers and comparisons
    index.md        ← Catalog of all pages (agent reads this first)
    log.md          ← Append-only operation history
    schema.md       ← Wiki conventions
  .axiom/
    config.json     ← Local config placeholder
```

Every wiki page uses consistent frontmatter:

```yaml
---
title: "Alan Turing"
summary: "British mathematician and pioneer of computer science"
tags: [mathematics, computing, ai]
category: entities
sources: [turing-biography.pdf]
updatedAt: "2026-04-10"
---
```

The `index.md` and `log.md` files are plain text — parseable with standard Unix tools:

```bash
grep "^## \[" wiki/log.md | tail -5       # last 5 operations
grep "ingest" wiki/log.md | wc -l          # total sources ingested
```

---

## Obsidian Integration

Axiom Wiki stores everything as plain markdown — Obsidian works perfectly as a viewer.

- **Open `wiki/` as your Obsidian vault** — the graph view maps the connections the agent creates between pages
- **Use Obsidian Web Clipper** to save articles as `.md` files directly to your `raw/` folder, then run `axiom-wiki ingest`
- **Dataview plugin** works out of the box with the frontmatter Axiom writes on every page — build dashboards from your wiki
- **Bind a hotkey** to "Download attachments" to localise images referenced in sources

---

## Supported File Types

| Extension | How it's processed |
|---|---|
| `.md`, `.txt` | Read as plain text |
| `.pdf` | Extracted as base64 and passed to the model |
| `.png`, `.jpg`, `.jpeg`, `.webp` | Sent as images (vision models) |
| `.html` | Converted to Markdown via node-html-markdown |
| `.docx` | Converted to Markdown via mammoth |

---

## Docker

```bash
# Init
docker run -it -v $(pwd):/wiki axiomwiki/axiom-wiki init

# Ingest
docker run -it -v $(pwd):/wiki axiomwiki/axiom-wiki ingest

# Watch mode
docker run -it -v $(pwd):/wiki axiomwiki/axiom-wiki watch

# Query
docker run -it -v $(pwd):/wiki axiomwiki/axiom-wiki query

# MCP server
docker run -v $(pwd):/wiki axiomwiki/axiom-wiki mcp
```

Docker Compose (cloud provider):

```yaml
services:
  axiom-wiki:
    image: axiomwiki/axiom-wiki
    volumes:
      - ./my-wiki:/wiki
    environment:
      - GOOGLE_GENERATIVE_AI_API_KEY=${GOOGLE_GENERATIVE_AI_API_KEY}
```

---

## Contributing

PRs are welcome. Areas where contributions help most:

- **New file type handlers** — add support in `src/core/files.ts`
- **LLM provider integrations** — add to `src/config/models.ts` and `src/agent/index.ts`
- **CLI UX improvements** — Ink screens in `src/cli/screens/`
- **Documentation** — usage guides, examples, walkthroughs
- **Bug fixes** — open an issue first for anything non-trivial

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

[Elastic License 2.0 (ELv2)](LICENSE)

Free to use, self-host, and modify. You may not offer Axiom Wiki as a hosted or managed service to third parties without a separate commercial agreement.

*Axiom Wiki — The wiki that maintains itself.*
