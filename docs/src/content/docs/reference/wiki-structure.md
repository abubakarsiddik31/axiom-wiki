---
title: Wiki Structure
description: Directory layout and page frontmatter schema.
---

## Directory layout

### Local wiki (inside a project)

```
my-project/
  axiom/                  # Everything lives here
    config.json           # Local config (provider, model, paths, obsidianCompat)
    state.json            # Compilation state (SHA-256 hashes, concepts, frozenSlugs)
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
      index.md            # Page catalog (by category)
      moc.md              # Map of Content (by tag)
      log.md              # Operation history
      usage.log           # Token usage and cost
      schema.md           # Wiki conventions
```

### Global wiki (personal knowledge base)

```
~/axiom/
  state.json              # Compilation state (SHA-256 hashes, concepts, frozenSlugs)
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
    moc.md
    log.md
    usage.log
    schema.md
```

:::note
Before v0.5.0 the default was `~/my-wiki/`. See the [migration guide](/axiom-wiki/guides/migration/) if upgrading.
:::

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

With `obsidianCompat: true` in config, links use bare names instead:

```
[[alan-turing]]
[[turing-completeness]]
```

Axiom's graph parser handles both formats — bare names default to the `entities/` category.

## Source citations

Wiki pages use paragraph-level citations to trace information back to source files:

```
Alan Turing was a British mathematician who made foundational contributions
to computer science and artificial intelligence. ^[turing-biography.pdf]

His work at Bletchley Park was instrumental in breaking the Enigma code. ^[turing-biography.pdf] ^[intelligence-trap.md]
```

Every factual paragraph cites the source file(s) it was derived from.

## Map of Content (moc.md)

The `moc.md` file is an auto-generated tag-grouped index. While `index.md` organizes pages by category, `moc.md` groups them by tag — each page appears under every tag it has:

```markdown
## machine-learning
- [[pages/concepts/gradient-descent]] — Gradient Descent
- [[pages/concepts/neural-networks]] — Neural Networks

## history
- [[pages/entities/alan-turing]] — Alan Turing
```

It is rebuilt automatically after every ingest, watch, clip, and autowiki operation.

## Index and log

The `index.md` and `log.md` files are plain text — parseable with standard Unix tools:

```bash
grep "^## \[" wiki/log.md | tail -5       # last 5 operations
grep "ingest" wiki/log.md | wc -l          # total sources ingested
grep "ingest" wiki/usage.log               # cost breakdown per ingest
```
