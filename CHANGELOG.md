# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Static export**: `axiom-wiki export` writes a self-contained HTML site — overview, filterable page list, per-page views with tables of contents, outgoing links, backlinks, and category paging, a self-contained SVG graph, and client-side search over titles, tags, summaries, and page text. Links are relative and the search index is inlined, so the export works from `file://` or any static host. Local images are copied and rewritten, inbox notes are excluded, and `--base-url` adds canonical tags, OpenGraph URLs, `sitemap.xml`, and `robots.txt`. Re-exports overwrite a marked export; anything else requires `--force`.
- **Nightly maintenance**: `axiom-wiki maintain` plans a deterministic, LLM-free pass over the corpus and `--apply` writes the safe fixes — backfill missing summaries from each page's own body, give orphans an inbound link (wrapping an existing mention, or adding a `## Related` bullet from a tag-sharing page), and optionally create stubs for dead links. Duplicate-looking pages are proposed but never auto-merged, and inbox notes are left alone for triage. The **Integrity** page gained a **Preview fixes** / **Apply safe fixes** panel, the JSON API gained `maintain` (read-only) and `maintain/apply` (write), and `serve --allow-write --maintain-interval <minutes>` runs the same pass on a timer.
- **Capture inbox**: `POST /actions/capture` writes a note straight into the `inbox` category with no title or category decision, deriving both from the text. The **Inbox** page gives you one box (`⌘↵` to capture) and a triage list: **Promote** into `concepts`/`entities`/`analyses`/`sources` (a rename that rewrites inbound links and drops the inbox tag) or **Merge** into an existing page. The sidebar shows a count badge, and `overview` now returns `inboxCount`.
- **Graph-aware Ask**: query retrieval is now deliberate instead of agent-driven. `assembleContext` seeds with hybrid search, expands one hop through outbound links and backlinks, renders a citable evidence block under a character budget, and reports the pages used. The Ask page shows **grounded in N pages**, offers a **what will it read?** preview with a token estimate, and can opt out with a `graph context` toggle.
- **Curation & link intelligence**: the web app is now an editor, not just a viewer. Create, edit, rename, merge, delete, and restore pages from the browser (Markdown editor with server-rendered preview). Renaming rewrites every inbound `[[wiki-link]]`, and `state.json` concept mappings follow. Every page now shows **Mentions, not links** (one-click linking) and **Related** pages scored by shared tags, links, and sources.
- **Page history**: `GET /api/v1/pages/:id/history` and `/diff?rev=` expose the git log per page with unified diffs and one-click restore. Page writes commit only the touched paths.
- **Web actions + feature parity**: `serve --allow-write` now exposes the core CLI workflows in the browser. New pages cover **Ask** (streaming query with optional forensic mode and filing as an analysis), **Sources** (clip a URL, ingest from `raw/`, re-ingest, delete), **Integrity** (dead links, orphans, metadata gaps, contradictions, citation audit, agent lint), and **Settings** (provider/model, embeddings, reindex). Long-running work runs as cancellable jobs with SSE progress.
- **Live web updates**: `GET /api/v1/events` streams `wiki-changed` events from the snapshot watcher, and the SPA refreshes mounted views without polling.
- **React Web App**: `axiom-wiki serve` now ships a Vite + React + TypeScript + Tailwind frontend (`apps/web`, built to `dist/web`) with an overview dashboard, filterable page library, rendered page views with backlinks, hybrid search with highlighted snippets, and an interactive pan/zoom link graph. The repo is now a pnpm workspace (`apps/*`). A JSON API at `/api/v1` backs the UI; the previous server-rendered pages remain as a fallback when `dist/web` is absent.
- **YouTube Transcripts**: `clip` and `ingest` now accept YouTube URLs (`watch?v=`, `youtu.be`, `/shorts/`, `/embed/`, `/live/`, with `?t=` offsets) and save a timestamped transcript instead of the video. Supports `--lang`, per-video chapters as headings, rolling-caption deduplication, and `[12:34]` markers that work as `#12:34` citation locators in forensic lint.
- **Zero-setup yt-dlp**: the standalone yt-dlp build is downloaded to `~/.axiom/bin` on first use and verified, so YouTube ingestion needs no manual install. `AXIOM_NO_AUTO_INSTALL=1` opts out.
- **Transcript Cache**: parsed transcripts are cached in `~/.axiom/cache/youtube/`, and an existing `raw/` transcript for the same video is reused, so re-clipping costs no network requests. This also removes most HTTP 429 exposure, which now additionally retries with backoff.

### Fixed
- **Aliased and anchored wiki-links counted as dead**: `[[page|alias]]` and `[[page#heading]]` now resolve to their target when the link graph and orphan list are built. Links created by the editor's one-click mention wrapping no longer appear as dead links or leave the target orphaned.
- **Unlocked state writes**: the `sources` screen now takes the compilation lock before deleting a source or clearing its hash for re-ingest, so it cannot overwrite `state.json` while `ingest`/`watch` is running. A busy wiki reports the holding PID instead of racing.
- **Stale derived artifacts after source deletion**: removing a source now rebuilds `index.md` and `moc.md` and drops the summary page from the semantic index instead of leaving a deleted page in generated views.
- **Query state typing**: the Ink query screen's `answering` state is now part of its union instead of an `as any` escape hatch.
- **Silent state reset**: `loadState` now warns (once per process) when `state.json` is corrupt or has an unsupported version, names the backup it wrote, and preserves unknown-version files as `state.json.v<N>.bak` before falling back to an empty state.

### Performance
- **Debounced snapshot invalidation**: `serve` coalesces watcher events (~150 ms), so a bulk ingest rebuilds the page/graph snapshot once after writes settle instead of once per page.
- **ETag revalidation for page payloads**: `/api/v1/pages/:category/:slug` now returns a weak `ETag` + `Last-Modified` with `Cache-Control: no-cache`; `If-None-Match` gets a bodyless `304` without re-reading, parsing, or rendering the page.
- **One-pass read snapshot + watcher cache**: `serve` now builds page metadata and the link graph in a single corpus walk and keeps the result in memory, invalidating on Markdown changes. On a 10k-page corpus, warm `/api/v1/pages`, `/api/v1/graph`, and page views no longer repeat the 170–230ms full scan; backlinks drop from ~170ms to ~0.3ms.
- **Paginated page API**: `/api/v1/pages` now supports `limit`, `cursor`, `cat`, `q`, and `sort`, and returns category facets. At 10k pages the response drops from ~2.2MB to ~22KB for the default 100-row page.
- **Bounded graph API**: `/api/v1/graph` returns the most-connected slice by default (`limit`, or a `focus`/`depth` neighborhood) plus full totals and a `truncated` flag. At 10k pages the payload drops from ~1.8MB to ~289KB.
- **Status reuse**: `/api/v1/overview` reuses the snapshot's pages and precomputed wiki size instead of walking the corpus twice; warm overview latency drops from ~30ms to ~3ms at 10k pages.

## [0.9.2] - 2026-09-21

### Added
- **Strict Forensic Grounded Query Mode**: Added `--forensic`, `-g`, and in-session `Ctrl+G` / `/forensic` toggles to `axiom-wiki query`. Bars the AI agent from using pre-trained parametric knowledge or extrapolating beyond retrieved wiki documents, enforcing explicit refusal when documents lack the answer.
- **Forensic Citation Proof Mode**: Deterministic citation verification engine in `src/core/citations.ts` that audits all paragraph citations (`^[source#locator]`) against raw source files to guarantee zero hallucinated citations. Supports page locators (`#p. 14`), timestamps (`#12:45`), line numbers (`#L42`), exact quotes (`#"..."`), and claim grading (`data`, `anecdote`, `outcome`, `assertion`). Run via `axiom-wiki lint --forensic` or `--strict` (exiting with code 1 on failures for CI and pre-commit hooks).
- **Binary Citation Support**: Extended forensic citation verification to inspect binary source citations (`.pdf`, `.docx`) using extracted summary pages and declared frontmatter sources.
- **Dedicated Lint Documentation**: Added documentation guide for `axiom-wiki lint` (`docs/src/content/docs/commands/lint.md`) with pre-commit git hook setup and sidebar navigation.

### Fixed
- **Shell Flag Replacement**: Fixed word boundary regex when stripping `--grounded` in the interactive shell.
- **Strict Lint Standalone Execution**: Enabled running `axiom-wiki lint --strict` directly without requiring `--forensic`.

## [0.9.1] - 2026-09-21

### Added
- **Markdown Section Chunking (Parent-Child Indexing)**: Large pages and dense documents are automatically divided along markdown headings (`##`, `###`) into section chunks with hierarchical context (`[Document > Section]`). Prevents token truncation and allows pinpoint section-level search retrieval.
- **Embedding Consistency Manifest**: Dedicated `wiki/search.manifest.json` tracks `(provider, model, dimensions)` to prevent silent index wipes and coordinate space pollution across different embedding models.
- **Dynamic Dimension Probing**: Automatically probes embedding vectors during setup and reindexing, supporting any custom or newer embedding model without hardcoded dimension guesses.
- **Google Gemini 3072d Embeddings**: Added built-in support for Google's newest `gemini-embedding-001`, `gemini-embedding-2`, and `gemini-embedding-2-preview` (3,072 dimensions).
- **Two-Stage Search Retrieval**: Hybrid search over-fetches candidates and groups by document path to eliminate single-document chunk crowding and result starvation, resolving clean section anchors.
- **High-Performance Batch Reindexing**: Processes chunks in batches of up to 50 with provider-aware rate pacing (e.g. 3.5s delay on Google to honor 15 RPM).
- **Structural Tree Outline & Backlink Navigation**: Added `list_pages({ mode: 'tree' })` and `get_backlinks` tools, enabling AI agents to navigate large wikis via category/tag hierarchies and graph connections instead of reading flat indexes.
- **Backlinks on page views**: `axiom-wiki serve` now shows a "Linked from" card at the bottom of every page view listing the pages that link to it ("what links here"), powered by a new `getBacklinks()` core API that reuses the existing link graph.

### Fixed
- **Config Storage for Undefined Values**: `setConfig` now removes keys with `undefined` values instead of throwing in Conf v15.

## [0.9.0] - 2026-08-27

### Added
- **`serve` command**: Browse the wiki as a local read-only web UI (`axiom-wiki serve`) — dashboard with stats and semantic health, page list, rendered pages with rewritten wiki-links, hybrid search box, and an SVG link graph. Dark/light theme, `--port`/`--host`/`--open` flags, GET-only routes.
- **xAI (Grok) provider**: Grok model lineup (Grok 4.6 flagship through Grok Build 0.1) via the OpenAI-compatible API at `api.x.ai/v1`, with per-model context windows and pricing. Community contribution by @icn5381.
- **CSV/TSV ingestion**: `.csv` and `.tsv` sources are converted into Markdown tables before ingestion (RFC-4180 parser — quoted fields, embedded delimiters/newlines, escaped quotes), so tabular data works with every provider.

## [0.8.0] - 2026-08-16

### Added
- **`auth` command**: Authenticate providers from the CLI — interactive API-key entry or a browser-based OAuth flow (`axiom-wiki auth openai`), with `auth status` and `auth logout` subcommands.
- **OAuth for OpenAI**: PKCE-secured authorization-code flow with a localhost callback server, automatic OIDC discovery, and a default issuer — zero manual URL configuration required.
- **Non-interactive auth**: `--api-key`, `--activate`, and `--oauth` flags for scripts and CI; OAuth endpoints overridable via `AXIOM_OPENAI_OAUTH_*` environment variables.
- **Token persistence**: Access and refresh tokens are stored in config so authenticated sessions survive restarts.

## [0.7.2] - 2026-04-23

### Added
- **Feature Highlights**: Updated README with Live Maintenance, Agent Instructions, and Health Monitoring.

### Improved
- **Documentation**: Comprehensive scan and update of all documentation for stale information.
- **Migration Guides**: Refactored migration documentation into a structured hierarchy with a central hub.
- **Sidebar Navigation**: Improved Astro/Starlight sidebar with a dedicated Migration category.

### Fixed
- **Link Integrity**: Fixed 404s and broken links in the documentation migration guides.

## [0.7.1] - 2026-04-23

### Fixed
- **Path Resolution**: Fixed bug where semantic index was sought in the wrong directory.
- **UI Persistence**: Resolved vanishing slash command outputs in the interactive shell.
- **Orama Integration**: Corrected serialization and counting logic for Orama v3.
- **Navigation**: Standardized "Press Esc or Enter to return" behavior across all sub-screens.

### Improved
- **Ingest Screen**: Added real-time visual feedback during the vectorization phase.
- **Error Handling**: Added specific error messages for Ollama connection and model issues.
- **Agent Integration**: Ensured all agent-initiated wiki writes trigger semantic indexing.
- **Shell Commands**: Added `/embed` and `/init` support to the interactive REPL.

## [0.7.0] - 2026-04-23

### Added
- **Hybrid Semantic Search**: A major upgrade to the search engine combining lexical (keyword) and vector (semantic) search using Orama v3.
- **Multi-Provider Embeddings**: Support for Google Gemini (`text-embedding-004`), OpenAI (`text-embedding-3-small`), and Ollama (`nomic-embed-text`).
- **`axiom-wiki embed` command**: New CLI command for managing semantic search (setup, status, re-indexing).
- **Interactive Shell Upgrades**: Added `/embed` and `/init` commands to the interactive REPL.
- **Real-time Indexing**: Automatic vector updates during source ingestion, wiki sync, and code changes (via MCP).
- **Health Tracking**: Integrated semantic index health into `get_wiki_health` and the CLI status screen.
- **Agent.md**: A dedicated reference file for AI agents working on the project.

### Changed
- **Dependency Migration**: Fully transitioned from `npm` to `pnpm` for package management.
- **Search Core**: Refactored `searchWiki` to use Orama's hybrid search mode with Reciprocal Rank Fusion (RRF).
- **Documentation**: Updated all guides and command references to reflect semantic capabilities and `pnpm` usage.

### Fixed
- **UI Persistence**: Resolved an issue where slash command outputs in the interactive shell would vanish immediately.
- **Orama Integration**: Fixed serialization and counting issues with Orama v3 API.
- **Path Resolution**: Fixed a bug where the semantic index was being looked for in the wrong directory.

## [0.6.0] - 2026-04-15

### Added
- **Provider Expansion**: Support for OpenRouter, DeepSeek, Groq, and Mistral AI.
- **MCP Overhaul**: New planning tools (`plan_with_wiki`, `get_architecture_brief`) and resources (`axiom://overview`).
- **Token Efficiency**: Introduced `compact` and `summary` formats for agent context reduction.
- **Health Monitoring**: Initial implementation of `get_wiki_health` for staleness tracking.

## [0.5.0] - 2026-04-01

### Added
- **Tier 2 Incremental Sync**: Surgical wiki updates after code changes.
- **File Watcher**: Continuous monitoring of source files for automatic ingestion.
- **Web Clipper**: Integrated command to clip and ingest URLs.

## [0.4.0] - 2026-03-15

### Added
- **MCP Server**: Initial implementation of the Model Context Protocol server.
- **Autowiki**: Automated generation of wiki pages from codebase analysis.

## [0.3.0] - 2026-02-28

### Added
- **Interactive Query Mode**: REPL for chatting with the wiki.
- **Source Management**: Screen to list, view, and delete ingested sources.

## [0.2.0] - 2026-02-10

### Added
- **Basic Ingestion**: Support for Markdown and Text files.
- **Entity Extraction**: Initial agent logic for identifying people and concepts.

## [0.1.0] - 2026-01-20

### Added
- Initial release with core wiki structure and basic CLI.

[0.7.2]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/abubakarsiddik31/axiom-wiki/releases/tag/v0.1.0
