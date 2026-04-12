---
title: Wiki Structure
description: Directory layout and page frontmatter schema.
---

## Directory layout

```
my-wiki/
  raw/                  # Drop your source files here (PDF, MD, DOCX, images, HTML)
    .axiomignore        # Patterns to exclude from watch/ingest
    assets/             # Images and attachments
  wiki/
    pages/
      entities/         # People, places, organisations
      concepts/         # Ideas, topics, theories
      sources/          # One summary page per source file
      analyses/         # Filed answers and comparisons
    index.md            # Catalog of all pages (agent reads this first)
    log.md              # Append-only operation history
    usage.log           # Token usage and cost per operation
    schema.md           # Wiki conventions
  .axiom/
    config.json         # Local config (provider, model, paths)
    state.json          # Compilation state (SHA-256 hashes per source, concept mappings)
    lock                # PID-based lock file (present only during active ingest)
    map-state.json      # Map/sync state (pages, git hash)
```

## Page frontmatter

Every wiki page uses this YAML frontmatter:

```yaml
---
title: "Alan Turing"
summary: "British mathematician and pioneer of computer science"
tags: [mathematics, computing, ai]
category: entities
sources: ["turing-biography.pdf"]
updatedAt: "2026-04-10"
---
```

## Categories

| Category | Contains |
|----------|----------|
| `entities` | People, places, organisations, named things |
| `concepts` | Ideas, topics, themes, theories |
| `sources` | One summary page per raw source file |
| `analyses` | Filed answers, comparisons, syntheses |

## Cross-references

Internal links use wiki-link syntax:

```
[[entities/alan-turing]]
[[concepts/turing-completeness]]
```

## Index and log

The `index.md` and `log.md` files are plain text — parseable with standard Unix tools:

```bash
grep "^## \[" wiki/log.md | tail -5       # last 5 operations
grep "ingest" wiki/log.md | wc -l          # total sources ingested
grep "ingest" wiki/usage.log               # cost breakdown per ingest
```
