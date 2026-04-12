---
title: autowiki
description: Auto-generate wiki pages from a project codebase.
---

```bash
axiom-wiki autowiki
```

> `axiom-wiki map` still works as an alias.

Analyzes the current project directory and generates structured wiki pages describing the architecture, modules, and tech stack.

## How it works

1. **Walk** — scans the filesystem (respects `.gitignore`), builds a directory tree, collects stats
2. **Plan** — one LLM call proposes 4-8 wiki pages based on the project structure
3. **Confirm** — shows the plan with cost estimate, wait for Enter
4. **Execute** — one LLM call per page with relevant source files

## Output

Pages are created in `wiki/pages/` with categories:
- **analyses** — overview and architecture pages
- **entities** — module and component descriptions
- **concepts** — patterns, tech stack, conventions

Each page has proper YAML frontmatter, cross-references to other pages, and content based on the actual source code.

## Cost

The planning call is cheap (tree + stats only). Execution cost depends on the number of pages and how much source code each page covers. The cost estimate is shown before execution.

## Re-running

Running `autowiki` again overwrites all existing pages with fresh content. Use this when the project structure has changed significantly. For incremental updates, use [`sync`](/axiom-wiki/commands/sync/) instead.

See the [Codebase Mapping guide](/axiom-wiki/guides/mapping/) for more details.
