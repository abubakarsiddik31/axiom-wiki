<p align="center">
  <img src="images/icon.svg" width="120" alt="Axiom Wiki" />
</p>

<h1 align="center">Axiom Wiki</h1>

<p align="center">
  <strong>The wiki that maintains itself.</strong><br/>
  AI-powered personal knowledge base that ingests documents, extracts entities,<br/>and keeps an interconnected wiki of markdown pages — automatically.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/axiom-wiki"><img src="https://img.shields.io/npm/v/axiom-wiki" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/axiom-wiki"><img src="https://img.shields.io/npm/dm/axiom-wiki" alt="npm downloads" /></a>
  <a href="https://github.com/abubakarsiddik31/axiom-wiki/actions/workflows/ci.yml"><img src="https://github.com/abubakarsiddik31/axiom-wiki/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.elastic.co/licensing/elastic-license"><img src="https://img.shields.io/badge/License-Elastic%20v2-blue.svg" alt="License: ELv2" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js >= 18" /></a>
</p>

<p align="center">
  <a href="https://abubakarsiddik31.github.io/axiom-wiki">Documentation</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#commands">Commands</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://github.com/abubakarsiddik31/axiom-wiki/issues">Issues</a>
</p>

<br/>

![Axiom Wiki init screen](images/init.png)

<br/>

> Unlike RAG systems that re-derive answers from raw sources on every query, Axiom **compiles** knowledge into an interconnected wiki of markdown pages and keeps it current as new sources arrive. Inspired by Andrej Karpathy's [llm-wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

---

## Quick Start

```bash
npm install -g axiom-wiki
axiom-wiki init
```

The setup wizard configures your LLM provider, wiki directory, and source folder. Then drop files into `raw/` and ingest:

```bash
axiom-wiki ingest
```

Or auto-wiki a project folder:

```bash
axiom-wiki autowiki
```

Launch the interactive shell:

```bash
axiom-wiki
```

See the [full documentation](https://abubakarsiddik31.github.io/axiom-wiki) for detailed guides.

---

## Supported LLM Providers

| Provider | Free Tier | Get API Key |
|---|---|---|
| **Google Gemini** *(recommended)* | Yes | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **OpenAI** | No | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Anthropic** | No | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **OpenRouter** | Yes (free models) | [openrouter.ai/keys](https://openrouter.ai/keys) |
| **DeepSeek** | No | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| **Groq** | Yes | [console.groq.com](https://console.groq.com/keys) |
| **Mistral AI** | No | [console.mistral.ai](https://console.mistral.ai/api-keys) |
| **Ollama** *(local)* | Free | [ollama.com](https://ollama.com) |

---

## Commands

```
axiom-wiki                    Launch interactive shell
axiom-wiki init               First-time setup wizard
axiom-wiki ingest [file|url]  Ingest a file, URL, or scan raw/
axiom-wiki query              Chat against your wiki
axiom-wiki autowiki           Agent explores and builds a wiki
axiom-wiki sync               Agent updates stale wiki pages
axiom-wiki watch              Auto-ingest new files in raw/
axiom-wiki clip [url]         Clip a URL to raw/
axiom-wiki sources            Manage ingested sources
axiom-wiki review             Resolve wiki contradictions
axiom-wiki graph              Visualize the wiki page graph
axiom-wiki embed              Manage semantic search embeddings
axiom-wiki model              Switch LLM provider or model
axiom-wiki status             Wiki statistics
axiom-wiki mcp                Start MCP server (Claude Code / Cursor)
```

`axwiki` is an alias for `axiom-wiki`.

---

## Key Features

**Ingest documents** — Drop PDFs, markdown, images, DOCX, or HTML into `raw/`. The agent extracts entities, concepts, and creates cross-linked wiki pages. [Docs](https://abubakarsiddik31.github.io/axiom-wiki/commands/ingest/)

**Auto-wiki anything** — `axiom-wiki autowiki` lets an AI agent autonomously explore your project or document folder, decide what pages to create, and build a comprehensive wiki in batches. Works on codebases, company docs, personal notes — the agent adapts to the content. [Docs](https://abubakarsiddik31.github.io/axiom-wiki/guides/mapping/)

**Incremental compilation** — Source files are tracked by SHA-256 hash. Re-running `axiom-wiki ingest` skips unchanged files and only processes new or modified sources — fast even on large wikis.

**Incremental sync** — `axiom-wiki sync` detects changes and lets the agent update stale pages and document new areas. [Docs](https://abubakarsiddik31.github.io/axiom-wiki/commands/sync/)

**Hybrid Semantic Search** — Axiom uses **Orama** to provide hybrid search (keyword + vector). Supports Google Gemini, OpenAI, and Ollama embeddings. Enable during `init` or run `axiom-wiki embed --setup`.

**Live Maintenance** — The wiki updates itself when your code changes. Tier 1 (deterministic) handles renames and staleness; Tier 2 (agent-based) rewrites pages to reflect new logic. [Docs](https://abubakarsiddik31.github.io/axiom-wiki/guides/mapping/)

**Agent Instructions** — `axiom-wiki setup-agent` generates instructions for Claude Code, Cursor, and Windsurf, teaching them how to use the wiki's MCP tools effectively.

**Health Monitoring** — Track wiki staleness, confidence scores, and semantic index health via the CLI or MCP tools.

**Interactive REPL** — A full-featured terminal UI with slash command autocomplete, real-time progress, and color-coded status badges.

**Local project wikis** — Scope a wiki to a single project inside `axiom/`. Auto-detected, no flags needed. [Docs](https://abubakarsiddik31.github.io/axiom-wiki/guides/local-wiki/)

**Web clipper** — `axiom-wiki clip <url>` fetches articles via Readability and saves them for ingest. [Docs](https://abubakarsiddik31.github.io/axiom-wiki/commands/clip/)

**MCP integration** — Use all wiki tools from Claude Code or Cursor. [Docs](https://abubakarsiddik31.github.io/axiom-wiki/guides/mcp/)

**Obsidian compatible** — Plain markdown with frontmatter. Open `wiki/` as a vault. [Docs](https://abubakarsiddik31.github.io/axiom-wiki/guides/obsidian/)

**Cost tracking** — Every operation logs tokens and cost to `wiki/usage.log`. [Docs](https://abubakarsiddik31.github.io/axiom-wiki/reference/cost-tracking/)

---

## Installation

```bash
npm install -g axiom-wiki    # or: yarn, pnpm
npx axiom-wiki init          # run without installing
```

**From source:**
```bash
git clone https://github.com/abubakarsiddik31/axiom-wiki.git
cd axiom-wiki && pnpm install && pnpm build && pnpm link --global
```

**Docker:**
```bash
docker run -it -v $(pwd):/wiki axiomwiki/axiom-wiki init
```

See [Installation docs](https://abubakarsiddik31.github.io/axiom-wiki/getting-started/installation/) for Docker Compose and Ollama setup.

---

## Wiki Structure

For local wikis (inside a project), everything lives in `axiom/`:

```
axiom/
  config.json           Local config
  state.json            Compilation state (source hashes)
  map-state.json        Autowiki/sync state
  raw/                  Source files (PDF, MD, DOCX, images, HTML)
  wiki/
    pages/
      entities/         People, places, organisations
      concepts/         Ideas, topics, theories
      sources/          One summary per source file
      analyses/         Filed answers, comparisons
    index.md            Page catalog
    log.md              Operation history
    usage.log           Token usage and cost
```

---

## Sponsoring

Axiom Wiki is free and open source. If it saves you time, consider supporting development:

- **[GitHub Sponsors](https://github.com/sponsors/abubakarsiddik)** — recurring or one-time
- **[Ko-fi](https://ko-fi.com/abubakarsiddik)** — buy me a coffee
- **[Open Collective](https://opencollective.com/axiom-wiki)** — transparent, supports teams

---

## Contributing

PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

- [Report a bug](https://github.com/abubakarsiddik31/axiom-wiki/issues/new?template=bug_report.md)
- [Request a feature](https://github.com/abubakarsiddik31/axiom-wiki/issues/new?template=feature_request.md)
- [Good first issues](https://github.com/abubakarsiddik31/axiom-wiki/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)

---

## License

[Elastic License 2.0 (ELv2)](LICENSE) — Free to use, self-host, and modify. See [LICENSE](LICENSE) for details.

*Axiom Wiki — The wiki that maintains itself.*

## Star History

<a href="https://www.star-history.com/?repos=abubakarsiddik31%2Faxiom-wiki&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=abubakarsiddik31/axiom-wiki&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=abubakarsiddik31/axiom-wiki&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=abubakarsiddik31/axiom-wiki&type=date&legend=top-left" />
 </picture>
</a>