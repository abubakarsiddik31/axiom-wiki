# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build      # Compile TypeScript → dist/
pnpm dev        # Watch mode with live reload (tsx watch)
pnpm start      # Run compiled binary (node dist/bin/axiom-wiki.js)
```

There is no test runner configured. Type-check with `pnpm build` (strict TypeScript compilation).

**Run `pnpm build` after every code change** to catch type errors early. The compiled output in `dist/` is what gets executed.

Run a specific CLI command in dev mode:
```bash
npx tsx bin/axiom-wiki.ts <command>   # e.g., status, query, ingest
```

## Architecture

Axiom Wiki is an AI-powered CLI wiki tool. The system has five main layers:

### Entry & Routing
- **`bin/axiom-wiki.ts`** — Commander.js CLI entry point defining 11 commands (`init`, `ingest`, `query`, `model`, `status`, `lint`, `watch`, `clip`, `sources`, `review`, `mcp`). Defaults to the home screen if no command is given.
- **`src/cli/index.tsx`** — Maps command types to Ink screen components (exhaustive type-checked dispatch).

### CLI/UI Layer (`src/cli/`)
- Built with **Ink 5 + React 18** (React for the terminal).
- **`screens/home.tsx`** — Main interactive REPL shell. Handles slash command autocomplete, keyboard navigation (↑↓ Tab Esc Ctrl+C), and routes to other screens.
- Each other screen (`ingest`, `query`, `init`, `watch`, `clip`, `sources`, `review`, `status`, `model`) is a self-contained Ink component.

### Agent Layer (`src/agent/`)
- **`index.ts`** — Creates a Mastra `Agent` with the resolved LLM model, system prompt, and tools.
- **`tools.ts`** — 14 Mastra tools (`read_page`, `write_page`, `list_pages`, `search_wiki`, `update_index`, `append_log`, `ingest_source`, `get_status`, `lint_wiki`, `list_sources`, `get_source`, `remove_source`, `get_contradictions`, `resolve_contradiction`).
- **`prompts.ts`** — System prompt defining wiki conventions (page frontmatter schema, category taxonomy, naming rules, cross-reference rules).

### Core/Wiki Layer (`src/core/`)
- **`wiki.ts`** — Atomic wiki I/O: `readPage`, `writePage`, `listPages`, `updateIndex`, `appendLog`, `getStatus`. Pages are Markdown with YAML frontmatter parsed by `gray-matter`.
- **`files.ts`** — Normalizes source files into `SourceFile` objects. Supported: `.md`, `.txt`, `.pdf`, `.docx`, `.html`, `.png/.jpg/.jpeg/.webp`. PDF/images → base64; HTML → Markdown via `node-html-markdown`; DOCX → Markdown via `mammoth`.
- **`search.ts`** — Full-text search over title, summary, tags, and content with ranked results.
- **`sources.ts`** — Tracks ingested sources by parsing `wiki/log.md`.
- **`watcher.ts`** — Chokidar file watcher with `.axiomignore` support and debouncing.

### Config Layer (`src/config/`)
- **`index.ts`** — `conf`-based persistent config. Interface: `AxiomConfig { provider, apiKey, model, wikiDir, rawDir, ollamaBaseUrl }`.
- **`models.ts`** — Provider/model definitions for Google Gemini, OpenAI, Anthropic, and Ollama.

### MCP Layer (`src/mcp/server.ts`)
- Exposes all 14 agent tools as MCP resources via stdio transport for Claude Code/Cursor integration.
- Sets a global `isMcpMode` flag to suppress terminal output.

## Key Conventions

**Module system:** ESM (`"module": "NodeNext"` in tsconfig). Use `.js` extensions in relative imports even for `.ts` source files.

**Wiki directory structure:**
```
<wikiDir>/
├── raw/                    ← Source files to ingest
│   └── .axiomignore
└── wiki/
    ├── pages/
    │   ├── entities/       ← People, places, orgs
    │   ├── concepts/       ← Ideas, theories
    │   ├── sources/        ← One summary per source
    │   └── analyses/       ← Comparisons, answers
    ├── index.md
    ├── log.md              ← Append-only operation log
    └── schema.md
```

**Page frontmatter schema:**
```yaml
---
title: "..."
summary: "..."
tags: [tag1, tag2]
category: entities | concepts | sources | analyses
sources: [file.pdf]
updatedAt: "YYYY-MM-DD"
---
```

**LLM providers:** Google Gemini (recommended, has free tier), OpenAI, Anthropic, Ollama (local/offline). Provider is resolved in `src/agent/index.ts` using the AI SDK (`@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/anthropic`).
