---
title: Migration from v0.4 → v0.5
description: Migrate your global wiki from ~/my-wiki to ~/.axiom.
---

In v0.5.0, the default global wiki directory changed from `~/my-wiki/` to `~/.axiom/`. This keeps the global wiki consistent with local project wikis (which already use `.axiom/`) and avoids a visible directory in the home folder.

## Automatic migration

If you have an existing `~/my-wiki/` wiki and run `axiom-wiki init`, the setup wizard detects it and offers to migrate:

```
⚠ Legacy wiki detected

Found an existing wiki at /Users/you/my-wiki

Since v0.5.0, the default global wiki directory is ~/.axiom

❯ Migrate — move ~/my-wiki → ~/.axiom
  Skip — set up a fresh wiki instead
```

Choosing **Migrate** will:

1. Move `~/my-wiki/` to `~/.axiom/`
2. Update the global config to point to the new path

All your wiki pages, source files, state, and logs are preserved — nothing is deleted.

## Manual migration

If you prefer to migrate manually, or the automatic migration fails:

```bash
# 1. Move the directory
mv ~/my-wiki ~/.axiom

# 2. Update the global config
axiom-wiki init
```

During `init`, set the wiki directory to `~/.axiom` when prompted.

## What changed

| | Before (v0.4) | After (v0.5) |
|---|---|---|
| Global wiki dir | `~/my-wiki/` | `~/.axiom/` |
| Local wiki dir | `.axiom/` | `.axiom/` (unchanged) |
| Directory structure inside | Same | Same |

The internal structure (`wiki/`, `raw/`, `state.json`, etc.) is identical — only the parent directory path changed.

## Existing local wikis

Local project wikis (`.axiom/` inside a repo) are **not affected** by this change. No migration is needed for local wikis.

## Custom wiki directories

If you previously chose a custom directory during `init` (not `~/my-wiki/`), you are also unaffected. The migration prompt only appears when `~/my-wiki/` exists and `~/.axiom/` does not.
