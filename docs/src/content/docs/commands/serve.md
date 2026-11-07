---
title: serve
description: Browse the wiki in a local read-only web app with a JSON API.
---

```bash
axiom-wiki serve
axiom-wiki serve --port 3000 --open
axiom-wiki serve --host 0.0.0.0   # expose on your LAN
```

Starts a local web server (default `http://127.0.0.1:1717`) that serves the **Axiom web app** from `dist/web` plus a read-only JSON API under `/api/v1`.

## The web app

The frontend lives in `apps/web` (Vite + React + TypeScript + Tailwind) and ships pre-built in the npm package, so `axiom-wiki serve` needs no extra install or second process:

- **Overview** — page and source counts, wiki size, last ingest, semantic index health, pages by category, and the ten most recently updated pages.
- **Pages** — every page grouped by category, with client-side text and category filters.
- **Page view** — rendered Markdown with frontmatter (tags, sources, updatedAt), rewritten wiki-links, citation pills, and a **Linked from** panel ("what links here").
- **Search** — the same hybrid search the CLI uses (lexical + semantic when embeddings are enabled), with section badges and highlighted snippets.
- **Graph** — the page link graph with zoom, pan, and clickable nodes; orphan pages are dashed and dead links are listed alongside.

Content is read fresh from disk on every request — `watch`, `ingest`, and agent writes are reflected immediately.

## JSON API

The UI is a client of the same read-only API, which you can call directly:

| Route | Returns |
|---|---|
| `GET /api/v1/overview` | `{ status, recent }` |
| `GET /api/v1/pages` | `{ pages, total, nextCursor, facets }` |
| `GET /api/v1/pages/:category/:slug` | `{ id, frontmatter, html, backlinks }` |
| `GET /api/v1/search?q=…` | `{ query, results }` (optional `limit`, `category`) |
| `GET /api/v1/graph` | `{ nodes, edges, orphans, deadLinks, totalNodes, totalEdges, orphanCount, deadLinkCount, truncated }` |

`/api/v1/pages` is paginated server-side:

| Parameter | Default | Description |
|---|---|---|
| `cat` | — | Exact category filter |
| `q` | — | Case-insensitive match on title, summary, or tags |
| `limit` | `100` | Rows per page (max 500) |
| `cursor` | `0` | Opaque offset returned as `nextCursor` by the previous page |
| `sort` | `category` | `category`, `title`, or `updated` (descending) |

`facets.categories` always contains counts over the whole wiki, so filter chips stay stable while paging.

`/api/v1/graph` returns a bounded slice by default so a large wiki does not emit its entire edge set:

| Parameter | Default | Description |
|---|---|---|
| `limit` | `2000` | Maximum existing nodes (max 10000) |
| `focus` | — | Page id to center a neighborhood on |
| `depth` | `1` | Neighborhood radius when `focus` is set (max 3) |

Without `focus`, the server ranks pages by degree and returns the top slice. `truncated` is `true` when nodes were omitted; `totalNodes`, `totalEdges`, `orphanCount`, and `deadLinkCount` always report the full graph. Dead-link targets referenced by the visible slice are included so broken links remain visible.

All responses use `Cache-Control: no-store`. The API is GET/HEAD only and returns JSON errors with the appropriate status code. The page list and graph come from a watcher-backed in-process snapshot: a request after the first is served from memory, and the snapshot rebuilds once per file change rather than once per request.

## Read-only by design

The server exposes `GET`/`HEAD` routes only — no write endpoints, no auth. It is safe to keep running locally and to open on your LAN with `--host 0.0.0.0`, but it is not intended for public exposure. To share a wiki publicly, use [Obsidian-compatible](/guides/obsidian/) publishing or a static export.

## Options

| Option | Default | Description |
|---|---|---|
| `-p, --port <port>` | `1717` | Port to listen on |
| `--host <host>` | `127.0.0.1` | Bind address (`0.0.0.0` exposes on the LAN) |
| `--open` | off | Open the browser after starting |

## Developing the frontend

```bash
# Terminal 1 — API + wiki, port 1717
axiom-wiki serve

# Terminal 2 — Vite dev server with HMR, port 1718, proxying /api to 1717
pnpm dev:web
```

Build the frontend with `pnpm build:web` (outputs to `dist/web`) or build both halves with `pnpm build:all`. If `dist/web` is missing when `serve` starts, the server falls back to the legacy server-rendered pages so the command still works from a source checkout.
