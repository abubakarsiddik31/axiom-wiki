# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build      # Compile the CLI TypeScript → dist/
pnpm build:web  # Build the React app → dist/web (shipped with the npm package)
pnpm build:all  # Both of the above (what prepublishOnly runs)
pnpm dev        # Watch mode with live reload (tsx watch)
pnpm dev:web    # Vite dev server for apps/web on :1718, proxying /api → :1717
pnpm start      # Run compiled binary (node dist/bin/axiom-wiki.js)
```

Tests: `pnpm test` (Vitest). Type-check with `pnpm build` (strict TypeScript compilation) and `pnpm typecheck:web` for the frontend.

**Run `pnpm build` after every backend change and `pnpm typecheck:web` after every frontend change** to catch type errors early. The compiled output in `dist/` is what gets executed; the frontend is served from `dist/web`.

**Update docs after every user-facing change.** The documentation site lives in `docs/src/content/docs/` (Astro + Starlight). When adding or changing commands, features, or wiki structure, update the relevant doc pages under `docs/src/content/docs/commands/`, `docs/src/content/docs/guides/`, or `docs/src/content/docs/reference/`.

Run a specific CLI command in dev mode:
```bash
npx tsx bin/axiom-wiki.ts <command>   # e.g., status, query, ingest
```

## Architecture

Axiom Wiki is an AI-powered CLI wiki tool. The repository is a pnpm workspace: the CLI package lives at the root, the web frontend in `apps/web` (see `pnpm-workspace.yaml`). The system has these main layers:

### Entry & Routing
- **`bin/axiom-wiki.ts`** — Commander.js CLI entry point defining the commands (`init`, `ingest`, `query`, `model`, `status`, `graph`, `serve`, `lint`, `watch`, `clip`, `sources`, `review`, `autowiki`, `sync`, `start`, `mcp`, `setup-agent`, `embed`, `auth`). Defaults to the home screen if no command is given.
- **`src/cli/index.tsx`** — Maps command types to Ink screen components (exhaustive type-checked dispatch).

### Web UI Layer (`src/server/` + `apps/web/`)
- **`src/server/index.ts`** — Bare `node:http` server behind `axiom-wiki serve` (`--port`, `--host`, `--open`, `--allow-write`). Wires `/healthz`, the JSON API, static SPA serving, and the legacy SSR fallback (used only when `dist/web` is absent, e.g. a source checkout). Read-only by default; `--allow-write` is loopback-only and gates mutation routes.
- **`src/server/api.ts`** — JSON API under `/api/v1`: read routes (`overview`, paginated `pages`, page payload, `search`, bounded `graph`, `sources`, `integrity`, `config`), SSE (`events`, job streams), and `POST /actions/*` / `DELETE /jobs/:id`. Read actions stay available in read-only mode; write actions require `--allow-write` plus `X-Axiom-Write: 1`.
- **`src/server/actions.ts`** — Action router. Validates bodies, restricts web ingest paths to `raw/`, acquires the compilation lock for mutations, and delegates to the same core functions as the CLI (`ingest`, `clipUrl`, `reindexWiki`, `removeSource`, `markForReingest`, citation verification). Actions: `ingest`, `clip`, `query`, `lint`, `sources/delete`, `sources/reingest`, `embeddings/reindex`, `analysis/save`, `contradiction/resolve`, `watch/start`, `watch/stop`, `page/save`, `page/rename`, `page/merge`, `page/delete`, `page/restore`, `link/insert`, `preview`.
- **`src/server/watch.ts`** — `WatchController` wraps the CLI's chokidar watcher for `serve`: each dropped file becomes a job, and server shutdown stops the watcher.
- **`src/server/jobs.ts`** — Process-local job registry for long-running actions (`queued/running/succeeded/failed/cancelled`), bounded log lines, cancellation via `AbortController`, and per-job SSE subscribers. Jobs are intentionally non-durable.
- **`src/server/cache.ts`** — `WikiReadCache`: one snapshot per process, invalidated by a debounced chokidar watcher on `wiki/`. Reads are O(1) after the first request; watcher bursts rebuild once and notify `onChange` listeners (SSE).
- **`src/core/snapshot.ts`** — `buildWikiSnapshot`: single pass over `wiki/pages` that returns page metadata, the link graph, and the wiki size, so consumers no longer walk and parse the corpus once each.
- **`src/server/static.ts`** — Serves the built SPA from `dist/web` (or `apps/web/dist`), with hashed-asset caching and `index.html` fallback for client routes. `AXIOM_WEB_DIR` overrides the location.
- **`src/server/render.ts`** — Pure rendering helpers shared by the API and the legacy SSR fallback: wiki-link rewriting (`[[id]]`, `[[id|title]]`, relative `.md` links → `/page/...`), citations, markdown→HTML via `marked`, and the SVG graph. Unit-tested without sockets.
- **`apps/web/`** — Vite + React + TypeScript + Tailwind SPA (`@axiom-wiki/web`). Routes: overview, pages, page view, page editor (`/new`, `/edit/*`), page history (`/history/*`), search, graph, ask, sources, integrity, settings. Styling follows `DESIGN.md`. `vite build` outputs to the root `dist/web` so the npm package (`files: ["dist"]`) ships it. During development, Vite proxies `/api` to a running `axiom-wiki serve` on `:1717`. `WikiEventsProvider` feeds a version counter into `useAsync`, so SSE changes refresh mounted views.

### CLI/UI Layer (`src/cli/`)
- Built with **Ink 5 + React 18** (React for the terminal).
- **`screens/home.tsx`** — Main interactive REPL shell. Handles slash command autocomplete, keyboard navigation (↑↓ Tab Esc Ctrl+C), and routes to other screens.
- Each other screen (`ingest`, `query`, `init`, `watch`, `clip`, `sources`, `review`, `status`, `model`, `embed`) is a self-contained Ink component.

### Agent Layer (`src/agent/`)
- **`index.ts`** — Creates a Mastra `Agent` with the resolved LLM model, system prompt, and tools.
- **`tools.ts`** — 16 Mastra tools (`read_page`, `write_page`, `list_pages`, `search_wiki`, `update_index`, `append_log`, `ingest_source`, `get_status`, `lint_wiki`, `list_sources`, `get_source`, `remove_source`, `get_contradictions`, `resolve_contradiction`, `verify_citations`, `get_backlinks`).
- **`prompts.ts`** — System prompt defining wiki conventions (page frontmatter schema, category taxonomy, naming rules, cross-reference rules).

### Core/Wiki Layer (`src/core/`)
- **`wiki.ts`** — Atomic wiki I/O: `readPage`, `writePage`, `listPages`, `updateIndex`, `updateMOC`, `appendLog`, `getStatus`. Pages are Markdown with YAML frontmatter parsed by `gray-matter`.
- **`ingest.ts`** — Non-interactive ingest pipeline shared by the web action API: clip URLs, resolve `raw/` changes, pre-flight size/context checks, run the agent, update index/MOC, index pages, append the log, record state, and append usage. Acquires/releases the compilation lock internally.
- **`page-ops.ts`** — Human page operations: `savePage`, `renamePage` (rewrites inbound links + state mappings), `mergePages`, `deletePage`. Filesystem-only; the caller owns the lock and derived-artifact refresh.
- **`links.ts`** — Link intelligence computed on demand from the corpus: `buildLinkIndex`, `findUnlinkedMentions` (mentions that never link), `findRelatedPages` (shared tags/links/co-citations), `rewriteLinksForRename`, and `linkFirstMentionInBody`.
- **`history.ts`** — Per-page git log, historical content, and unified diffs. Uses `execFileSync` with validated revs; follows renames so pre-rename commits still resolve.
- **`git.ts`** — `isGitRepo`, `autoCommit`, and `commitPaths` (scoped commits so a browser edit does not sweep unrelated changes).
- **`state.ts`** — Compilation state management. Tracks per-source SHA-256 hashes in `{wikiDir}/state.json` for incremental compilation. Key functions: `loadState`, `saveState`, `computeHash`, `detectChanges`, `recordIngest`, `migrateFromLog`.
- **`lock.ts`** — PID-based compilation lock (`{wikiDir}/lock`). Prevents concurrent ingest/compile operations. Stale locks from dead processes are auto-reclaimed. Key functions: `acquireLock`, `releaseLock`, `getLockInfo`, `forceReleaseLock`.
- **`files.ts`** — Normalizes source files into `SourceFile` objects. Supported: `.md`, `.txt`, `.pdf`, `.docx`, `.html`, `.png/.jpg/.jpeg/.webp`, `.csv/.tsv`. PDF/images → base64; HTML → Markdown via `node-html-markdown`; DOCX → Markdown via `mammoth`; CSV/TSV → Markdown table via `delimitedToMarkdown`.
- **`search.ts`** — Hybrid search (Lexical + Semantic) using Orama. Orchestrates keyword matching and vector similarity.
- **`indexing.ts`** — Manages full and incremental indexing of wiki pages into the Orama store.
- **`embeddings.ts`** — Unified provider for vector embeddings (Google, OpenAI, Ollama).
- **`sources.ts`** — Tracks ingested sources by parsing `wiki/log.md`.
- **`watcher.ts`** — Chokidar file watcher with `.axiomignore` support and debouncing.

### Config Layer (`src/config/`)
- **`index.ts`** — `conf`-based persistent config. Interface: `AxiomConfig { provider, apiKey, model, wikiDir, rawDir, ollamaBaseUrl }`.
- **`models.ts`** — Provider/model definitions for Google Gemini, OpenAI, Anthropic, and Ollama.

### MCP Layer (`src/mcp/server.ts`)
- Exposes all 16 agent tools as MCP resources via stdio transport for Codex/Cursor integration.
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
- The `sources` screen acquires the lock before any `saveState` or log append (delete and reingest) and releases it in `finally`. If another process holds it, the action is refused with the holder's PID rather than racing.

**Commands that must track state:**
| Command | lock | log.md | index.md | moc.md | state.json | usage.log |
|---------|------|--------|----------|--------|------------|-----------|
| `ingest` | yes | yes | yes | yes | yes | yes |
| `watch` | yes | yes | yes | yes | yes | yes |
| `clip` (with ingest) | yes | yes | yes | yes | yes | yes |
| `sources` → delete | yes | no | no | no | yes (remove) | no |
| `sources` → reingest | yes | yes | no | no | yes (clear hash) | no |
| `query` | no | yes | no | no | no | yes |
| `autowiki` / `sync` | no | yes | yes | yes | no (own state) | yes |

**Both config scopes work identically** — state files live directly in `{wikiDir}/` (`state.json`, `lock`, `map-state.json`). For local wikis `wikiDir = axiom`, for global wikis it's the user-chosen directory.
