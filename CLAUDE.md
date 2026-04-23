# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build      # Compile TypeScript → dist/
pnpm dev        # Watch mode with live reload (tsx watch)
pnpm start      # Run compiled binary (node dist/bin/axiom-wiki.js)
```

Tests: `pnpm test` (Vitest). Type-check with `pnpm build` (strict TypeScript compilation).

**Run `pnpm build` after every code change** to catch type errors early. The compiled output in `dist/` is what gets executed.

**Update docs after every user-facing change.** The documentation site lives in `docs/src/content/docs/` (Astro + Starlight). When adding or changing commands, features, or wiki structure, update the relevant doc pages under `docs/src/content/docs/commands/`, `docs/src/content/docs/guides/`, or `docs/src/content/docs/reference/`.

Run a specific CLI command in dev mode:
```bash
npx tsx bin/axiom-wiki.ts <command>   # e.g., status, query, ingest
```

## Architecture

Axiom Wiki is an AI-powered CLI wiki tool. The system has five main layers:

### Entry & Routing
- **`bin/axiom-wiki.ts`** — Commander.js CLI entry point defining 12 commands (`init`, `ingest`, `query`, `model`, `status`, `lint`, `watch`, `clip`, `sources`, `review`, `mcp`, `embed`). Defaults to the home screen if no command is given.
- **`src/cli/index.tsx`** — Maps command types to Ink screen components (exhaustive type-checked dispatch).

### CLI/UI Layer (`src/cli/`)
- Built with **Ink 5 + React 18** (React for the terminal).
- **`screens/home.tsx`** — Main interactive REPL shell. Handles slash command autocomplete, keyboard navigation (↑↓ Tab Esc Ctrl+C), and routes to other screens.
- Each other screen (`ingest`, `query`, `init`, `watch`, `clip`, `sources`, `review`, `status`, `model`, `embed`) is a self-contained Ink component.

### Agent Layer (`src/agent/`)
- **`index.ts`** — Creates a Mastra `Agent` with the resolved LLM model, system prompt, and tools.
- **`tools.ts`** — 14 Mastra tools (`read_page`, `write_page`, `list_pages`, `search_wiki`, `update_index`, `append_log`, `ingest_source`, `get_status`, `lint_wiki`, `list_sources`, `get_source`, `remove_source`, `get_contradictions`, `resolve_contradiction`).
- **`prompts.ts`** — System prompt defining wiki conventions (page frontmatter schema, category taxonomy, naming rules, cross-reference rules).

### Core/Wiki Layer (`src/core/`)
- **`wiki.ts`** — Atomic wiki I/O: `readPage`, `writePage`, `listPages`, `updateIndex`, `appendLog`, `getStatus`. Pages are Markdown with YAML frontmatter parsed by `gray-matter`.
- **`state.ts`** — Compilation state management. Tracks per-source SHA-256 hashes in `{wikiDir}/state.json` for incremental compilation. Key functions: `loadState`, `saveState`, `computeHash`, `detectChanges`, `recordIngest`, `migrateFromLog`.
- **`lock.ts`** — PID-based compilation lock (`{wikiDir}/lock`). Prevents concurrent ingest/compile operations. Stale locks from dead processes are auto-reclaimed. Key functions: `acquireLock`, `releaseLock`, `getLockInfo`, `forceReleaseLock`.
- **`files.ts`** — Normalizes source files into `SourceFile` objects. Supported: `.md`, `.txt`, `.pdf`, `.docx`, `.html`, `.png/.jpg/.jpeg/.webp`. PDF/images → base64; HTML → Markdown via `node-html-markdown`; DOCX → Markdown via `mammoth`.
- **`search.ts`** — Hybrid search (Lexical + Semantic) using Orama. Orchestrates keyword matching and vector similarity.
- **`indexing.ts`** — Manages full and incremental indexing of wiki pages into the Orama store.
- **`embeddings.ts`** — Unified provider for vector embeddings (Google, OpenAI, Ollama).
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

**Wiki directory structure** (wikiDir = `axiom` for local, user-chosen for global):
```
<wikiDir>/
├── config.json             ← Local project config (local scope only)
├── state.json              ← Compilation state (SHA-256 hashes, concept mappings)
├── map-state.json          ← Autowiki/sync state
├── search.index            ← Orama binary/JSON search index
├── lock                    ← PID-based lock (transient, present during ingest)
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

## State Tracking Checklist

Any code change that creates, modifies, or removes wiki content must keep these systems in sync. Forgetting one causes subtle bugs (stale state, missing log entries, broken incremental compilation).

**After every source ingest** (ingest, watch, clip):
1. `acquireLock(wikiDir)` — acquire compilation lock before any writes
2. `updateIndex(wikiDir)` — rebuild `wiki/index.md` from all pages
3. `updateMOC(wikiDir)` — rebuild `wiki/moc.md` (tag-grouped Map of Content)
4. `appendLog(wikiDir, filename, 'ingest')` — append to `wiki/log.md`
5. `recordIngest(state, filename, filepath, pages)` + `saveState(wikiDir, state)` — update `state.json` with SHA-256 hash and concept mappings
6. `recordIngest(state, filename, filepath, pages)` + `saveState(wikiDir, state)` — update `state.json` with SHA-256 hash and concept mappings
7. `indexWikiPage(config, pagePath)` — update semantic index for new/modified pages
8. `releaseLock(wikiDir)` — release lock on **every** exit path (success, error, user cancel, escape)

1. `removeSource(wikiDir, filename)` — delete summary page
2. `delete state.sources[filename]` + `saveState()` — remove from compilation state

**After marking for re-ingest** (sources screen → reingest):
1. `markForReingest(wikiDir, filename)` — append to log
2. `state.sources[filename].sha256 = ''` + `saveState()` — clear hash so next ingest detects it as "changed"

**Compilation lock rules:**
- Lock is at `{wikiDir}/lock` (PID + timestamp JSON). Stale locks from dead processes auto-reclaim.
- **Every code path that acquires the lock must release it** — including early returns, error catches, user cancellation ("n"), and Escape key. This is the most common source of bugs.
- The `watch` screen uses `try/finally` to guarantee release.
- The `ingest` screen has multiple async pause points (reingest-confirm, interactive-reply, interactive-confirm) where the lock stays held until the user responds — release on both "y" and "n" paths.

**Commands that must track state:**
| Command | lock | log.md | index.md | moc.md | state.json | usage.log |
|---------|------|--------|----------|--------|------------|-----------|
| `ingest` | yes | yes | yes | yes | yes | yes |
| `watch` | yes | yes | yes | yes | yes | yes |
| `clip` (with ingest) | yes | yes | yes | yes | yes | yes |
| `sources` → delete | no | no | no | no | yes (remove) | no |
| `sources` → reingest | no | yes | no | no | yes (clear hash) | no |
| `query` | no | yes | no | no | no | yes |
| `autowiki` / `sync` | no | yes | yes | yes | no (own state) | yes |

**Both config scopes work identically** — state files live directly in `{wikiDir}/` (`state.json`, `lock`, `map-state.json`). For local wikis `wikiDir = axiom`, for global wikis it's the user-chosen directory.
