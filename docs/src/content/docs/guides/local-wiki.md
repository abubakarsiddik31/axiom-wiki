---
title: Local Project Wiki
description: Use Axiom Wiki scoped to a single project or repository.
---

Axiom Wiki can run at two levels:

- **Global** — a personal wiki in `~/.axiom/` for general knowledge
- **Local** — a project-scoped wiki inside `.axiom/` for codebase documentation

:::note
In versions before v0.5.0, the global wiki defaulted to `~/my-wiki/`. See the [migration guide](/axiom-wiki/guides/migration/) if you're upgrading.
:::

## Setting up a local wiki

During `axiom-wiki init`, the wizard detects your context (git repo, home directory) and offers the choice:

```
Where should this wiki live?
  > Local  — project wiki in /path/to/project/.axiom/
    Global — personal wiki in ~/.axiom/
```

When running from your home directory, only the Global option is shown.

**Local mode** stores everything inside `.axiom/`:

```
project/
  .axiom/
    config.json       # provider, model, API key
    map-state.json    # map/sync state
    wiki/             # wiki pages
    raw/              # source files
  src/
  ...
```

The `.axiom/` directory is automatically added to `.gitignore` during setup (it contains your API key).

## Scope priority

When both local and global configs exist, the local one wins. Axiom walks up from the current directory looking for `.axiom/config.json`.

- Inside the project directory: local config is used (yellow `local` badge in header)
- Outside the project directory: global config is used

No flags or environment variables needed — it switches automatically based on your working directory.

## Re-configuring

Running `axiom-wiki init` again from a directory with an existing local config shows a warning and lets you reconfigure.
