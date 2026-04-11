---
title: Codebase Mapping
description: Automatically generate wiki pages from your project's source code.
---

The `map` and `sync` commands turn any codebase into structured wiki documentation.

## Initial mapping

```bash
axiom-wiki map
```

Map works in three phases:

### 1. Walk

Scans the filesystem without any LLM calls. Respects `.gitignore` and standard ignores (node_modules, dist, build, etc.). Builds a directory tree, collects file stats, and reads key files (README, package.json, config files).

### 2. Plan

One LLM call analyzes the tree and proposes 4-8 wiki pages:

```
Analysis complete — here's the plan:

  Pages to create (6):
    1. [analyses] Codebase Overview
    2. [entities] Core Module            (src/core/)
    3. [entities] CLI Layer              (src/cli/)
    4. [entities] Agent Layer            (src/agent/)
    5. [concepts] Configuration System   (src/config/)
    6. [concepts] Tech Stack

  Planning: in=4821 out=312 cost=$0.0012
  Estimated total: ~$0.021

  Press Enter to proceed · Ctrl+C to cancel
```

You see the cost estimate before anything is written. Ctrl+C cancels cleanly.

### 3. Execute

One LLM call per page. Each page gets the relevant source files (truncated to fit context), a project summary for context, and the list of other pages for cross-references.

Pages are saved to `wiki/pages/` with proper frontmatter, cross-links, and accurate content based on the actual code.

## Keeping pages current

After the initial map, use sync to update only what changed:

```bash
axiom-wiki sync
```

Sync uses `git diff` to detect changed files since the last map/sync, matches them to wiki pages, and re-generates only the affected pages. The overview page is always refreshed.

```
Changes detected since last sync:

  14 files changed:
    src/core/    5 files
    src/cli/     6 files

  Pages to update (3 of 6):
    1. [entities] Core Module         (5 changed files)
    2. [entities] CLI Layer           (6 changed files)
    3. [analyses] Codebase Overview   (always refreshed)

  Unchanged: Agent Layer, Config System, Tech Stack
```

Sync also detects:
- **Stale pages** — where all source directories have been removed
- **New directories** — not covered by any existing page (run `/map` again to add them)

## Re-mapping

Running `map` again overwrites all existing pages with fresh content. Use this when the project structure has changed significantly.

## How it works under the hood

Map saves its state to `.axiom/map-state.json` — this tracks which pages cover which source paths and the git commit hash at the time of the last sync. This is what lets `sync` know what changed.
