---
title: Codebase Mapping
description: Automatically generate wiki pages from your project's source code or document collection.
---

The `autowiki` and `sync` commands turn any folder into structured wiki documentation — codebases, company docs, personal notes, or research papers.

## Initial mapping

```bash
axiom-wiki autowiki
```

Autowiki works in three phases:

### 1. Scan

Walks the filesystem without any LLM calls. Respects `.gitignore` and standard ignores (node_modules, dist, build, etc.). Builds a directory tree and collects file stats.

### 2. Confirm

Shows project stats and a cost estimate before any LLM work begins:

```
Project scanned

  234 files · 1.2MB · ~250,000 words
  .ts (89), .tsx (42), .md (15), .json (8)

The agent will explore this codebase and build a wiki autonomously.
It will survey the project structure, read key files, and create
wiki pages in batches (up to 10 batches, max $5.00).

Press Enter to proceed · Ctrl+C to cancel
```

### 3. Explore & Write

The agent autonomously explores the project using tools:

- **`get_project_overview`** — see the directory tree, key files, language stats
- **`read_project_file`** — read any file on demand
- **`list_project_dir`** — list directory contents
- **`search_project`** — grep across the project

It reads files, decides what pages to create, writes them using wiki tools, and signals when it's done. Large projects are processed in multiple batches — each batch starts fresh, but the wiki carries state between them.

The agent adapts to the content:
- **Code folders** — documents architecture, modules, patterns, design decisions
- **Document folders** — extracts entities, concepts, themes; creates synthesis pages

## Keeping pages current

After the initial autowiki, use sync to update what changed:

```bash
axiom-wiki sync
```

Sync detects changed files via `git diff` and lets the agent decide which wiki pages need updating:

```
Changes detected since last sync:

  14 files changed:
    src/core/    5 files
    src/cli/     6 files

The agent will read existing wiki pages and the changed code,
then update stale pages and create new ones as needed.

Press Enter to proceed · Ctrl+C to cancel
```

The agent reads existing pages, checks the changed files, and only rewrites what's actually stale.

## Re-running autowiki

Running `autowiki` again creates fresh pages from scratch. Use this when the project structure has changed significantly.

## How it works under the hood

Autowiki saves its state to `.axiom/map-state.json` — this tracks which pages were created and the git commit hash at the time of the last sync. This is what lets `sync` know what changed.

The agent runs in batches. Each batch is a fresh LLM call with a clean context window. Between batches, the wiki itself serves as the agent's memory — it reads `wiki/index.md` to see what it's already documented, then focuses on uncovered areas. This means:

- A crash mid-batch doesn't lose work from previous batches
- Cost is tracked per batch with a safety ceiling
- Context doesn't degrade on large projects

After all batches complete, Axiom rebuilds both `wiki/index.md` (category-grouped) and `wiki/moc.md` (tag-grouped Map of Content). The MOC provides an alternative navigation view — pages appear under every tag they have, making it easy to browse by topic rather than category.
