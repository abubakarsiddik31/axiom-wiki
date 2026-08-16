---
title: serve
description: Browse the wiki as a local read-only web UI.
---

```bash
axiom-wiki serve
axiom-wiki serve --port 3000 --open
axiom-wiki serve --host 0.0.0.0   # expose on your LAN
```

Starts a local web server (default `http://127.0.0.1:1717`) that renders your wiki as a clean, dark/light-themed browser UI:

- **Dashboard** — page counts by category, raw source count, semantic index health, and recently updated pages.
- **Pages** — every page grouped by category, with summaries and last-updated dates.
- **Page view** — rendered markdown with frontmatter (tags, sources, updatedAt) as a header, and wiki-links (`[[entities/foo]]`) rewritten to clickable internal links.
- **Search** — a search box wired to the same hybrid search the CLI uses (lexical + semantic when embeddings are enabled).
- **Graph** — the page link graph as an SVG; orphan pages get dashed circles, dead links are listed below.

## Read-only by design

The server exposes `GET` routes only — no write endpoints, no auth. It is safe to keep running locally and to open on your LAN with `--host 0.0.0.0`, but it is not intended for public exposure. To share a wiki publicly, use [Obsidian-compatible](/guides/obsidian/) publishing or a static export.

## Options

| Option | Default | Description |
|---|---|---|
| `-p, --port <port>` | `1717` | Port to listen on |
| `--host <host>` | `127.0.0.1` | Bind address (`0.0.0.0` exposes on the LAN) |
| `--open` | off | Open the browser after starting |

Content is read fresh from disk on every request — `watch`, `ingest`, and agent writes are reflected immediately, just refresh the page.
