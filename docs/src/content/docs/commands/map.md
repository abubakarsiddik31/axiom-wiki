---
title: autowiki
description: Auto-generate wiki pages from a project folder or document collection.
---

```bash
axiom-wiki autowiki
```

> `axiom-wiki map` still works as an alias.

Analyzes the current directory and autonomously generates structured wiki pages. Works on codebases, document folders, personal notes — the agent detects the content type and adapts its approach.

## How it works

1. **Scan** — walks the filesystem (respects `.gitignore`), builds a directory tree, collects stats
2. **Confirm** — shows project stats and estimated cost, waits for Enter
3. **Explore & Write** — the agent uses tools to read files, search content, and navigate the wiki. It decides what pages to create, reads only what it needs, and writes pages in batches.

The agent has access to:
- **File tools** — `read_project_file`, `list_project_dir`, `search_project`, `get_project_overview`
- **Wiki tools** — `read_page`, `write_page`, `list_pages`, `search_wiki`

## Content detection

Autowiki automatically detects whether the folder contains code or documents:

- **Code** (`.ts`, `.py`, `.go`, etc.) — the agent documents architecture, modules, patterns, and design decisions
- **Documents** (`.md`, `.pdf`, `.docx`, etc.) — the agent extracts entities, concepts, and themes, and creates synthesis pages that connect ideas across documents

## Batched execution

Large projects are processed in multiple batches. Each batch is a fresh agent session, but the wiki carries state between batches — the agent reads `wiki/index.md` at the start of each batch to see what's already been documented.

Benefits:
- **Crash recovery** — if a batch fails, previous pages are preserved
- **Cost control** — cost is tracked per batch with a configurable ceiling (default $5)
- **No context degradation** — each batch has a fresh context window
- **Scales to large projects** — small projects need 1-2 batches, large ones scale to 8+

## Output

Pages are created in `wiki/pages/` with categories:
- **analyses** — overviews, architecture, how-things-work explanations
- **entities** — modules, components, people, organisations
- **concepts** — patterns, conventions, themes, ideas

Each page has YAML frontmatter, cross-references to other pages, and content based on the actual files.

A `wiki/moc.md` (Map of Content) is also generated — a tag-grouped index that organizes all pages by their tags, complementing the category-based `index.md`.

## Re-running

Running `autowiki` again overwrites existing pages with fresh content. Use this when the project has changed significantly. For incremental updates, use [`sync`](/axiom-wiki/commands/sync/) instead.

See the [Codebase Mapping guide](/axiom-wiki/guides/mapping/) for more details.
