---
title: Migration from v0.4 → v0.5
description: Migrate your wiki directories to the new v0.5 layout.
---

In v0.5.0, the default wiki directories changed:

- **Global wiki:** `~/my-wiki/` → `~/axiom/`
- **Local wiki:** `.axiom/` → `axiom/`

The new names are cleaner (`wiki/` already lives inside, so no redundancy) and the local directory is no longer hidden.

## Backward compatibility

**Your existing wikis still work.** Axiom v0.5 automatically detects and reads from legacy `.axiom/` and `~/my-wiki/` directories. You don't need to migrate immediately — but you'll see a deprecation notice in the CLI header:

```
⚠ Deprecated: .axiom/ has been renamed to axiom/ — run axiom-wiki init to migrate.
```

## Automatic migration

Running `axiom-wiki init` detects legacy directories and offers to migrate them:

```
⚠ Legacy wiki detected

Since v0.5.0, wiki directories have been renamed:
  /Users/you/my-wiki → /Users/you/axiom
  /path/to/project/.axiom → /path/to/project/axiom

❯ Migrate — rename to new directory layout
  Skip — set up a fresh wiki instead
```

Choosing **Migrate** will:

1. Rename legacy directories to the new names
2. Update config paths (both global config and local `config.json`)
3. Update `.gitignore` entries (for local wikis)

All wiki pages, source files, state, and logs are preserved — nothing is deleted.

## Manual migration

### Global wiki

```bash
mv ~/my-wiki ~/axiom
axiom-wiki init    # set wiki directory to ~/axiom when prompted
```

### Local wiki

```bash
mv .axiom axiom
```

Then update `axiom/config.json` to reflect the new paths:

```json
{
  "wikiDir": "/path/to/project/axiom",
  "rawDir": "/path/to/project/axiom/raw"
}
```

And in `.gitignore`, replace `.axiom/` with `axiom/` (or keep both).

## What changed

| | Before (v0.4) | After (v0.5) |
|---|---|---|
| Global wiki dir | `~/my-wiki/` | `~/axiom/` |
| Local wiki dir | `.axiom/` | `axiom/` |
| Config lookup | `.axiom/config.json` | `axiom/config.json` (falls back to `.axiom/config.json`) |
| Directory structure inside | Same | Same |

The internal structure (`wiki/`, `raw/`, `state.json`, etc.) is identical — only the parent directory names changed.

## Custom wiki directories

If you previously chose a custom directory during `init` (not `~/my-wiki/`), you are unaffected. The migration prompt only appears when legacy directories exist and the new ones don't.
