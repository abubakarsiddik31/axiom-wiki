---
title: Migration from v0.4 → v0.5
description: Migrate your wiki directories to the new v0.5 layout.
---

In v0.5.0, the default wiki directories changed:

- **Global wiki:** `~/my-wiki/` → `~/axiom/`
- **Local wiki:** `.axiom/` → `axiom/`

The new names are cleaner (`wiki/` already lives inside, so no redundancy) and the local directory is no longer hidden.

## Automatic migration (global wiki)

If you have an existing `~/my-wiki/` wiki and run `axiom-wiki init`, the setup wizard detects it and offers to migrate:

```
⚠ Legacy wiki detected

Found an existing wiki at /Users/you/my-wiki

Since v0.5.0, the default global wiki directory is ~/axiom

❯ Migrate — move ~/my-wiki → ~/axiom
  Skip — set up a fresh wiki instead
```

Choosing **Migrate** will:

1. Move `~/my-wiki/` to `~/axiom/`
2. Update the global config to point to the new path

All your wiki pages, source files, state, and logs are preserved — nothing is deleted.

## Manual migration

If you prefer to migrate manually, or the automatic migration fails:

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

## What changed

| | Before (v0.4) | After (v0.5) |
|---|---|---|
| Global wiki dir | `~/my-wiki/` | `~/axiom/` |
| Local wiki dir | `.axiom/` | `axiom/` |
| Directory structure inside | Same | Same |

The internal structure (`wiki/`, `raw/`, `state.json`, etc.) is identical — only the parent directory names changed.

## Custom wiki directories

If you previously chose a custom directory during `init` (not `~/my-wiki/`), you are unaffected. The migration prompt only appears when `~/my-wiki/` exists and `~/axiom/` does not.
