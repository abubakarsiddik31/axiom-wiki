---
title: Wiki Structure
description: Directory layout and page frontmatter schema.
---

## Directory layout

### Local wiki (inside a project)

```
my-project/
  .axiom/                 # Everything lives here
    config.json           # Local config (provider, model, paths)
    state.json            # Compilation state (SHA-256 hashes per source)
    map-state.json        # Autowiki/sync state (pages, git hash)
    raw/                  # Source files to ingest
      .axiomignore
      assets/
    wiki/
      pages/
        entities/         # People, places, organisations
        concepts/         # Ideas, topics, theories
        sources/          # One summary per source file
        analyses/         # Filed answers, comparisons
      index.md            # Page catalog
      log.md              # Operation history
      usage.log           # Token usage and cost
      schema.md           # Wiki conventions
```

### Global wiki (personal knowledge base)

```
~/my-wiki/
  state.json              # Compilation state
  map-state.json          # Autowiki/sync state
  raw/                    # Source files to ingest
    .axiomignore
    assets/
  wiki/
    pages/
      entities/
      concepts/
      sources/
      analyses/
    index.md
    log.md
    usage.log
    schema.md
```

Global config lives in your OS config directory (`~/.config/axiom-wiki/` on macOS/Linux).

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
