---
title: Obsidian Integration
description: Use Obsidian as a viewer for your Axiom Wiki.
---

Axiom Wiki stores everything as plain markdown — Obsidian works perfectly as a viewer.

- **Open `wiki/` as your Obsidian vault** — the graph view maps the connections the agent creates between pages
- **Use Obsidian Web Clipper** to save articles as `.md` files directly to your `raw/` folder, then run `axiom-wiki ingest`
- **Dataview plugin** works out of the box with the frontmatter Axiom writes on every page — build dashboards from your wiki
- **Bind a hotkey** to "Download attachments" to localise images referenced in sources

## Obsidian compatibility mode

By default, Axiom uses `[[category/page-name]]` links (e.g. `[[entities/alan-turing]]`). Obsidian resolves these correctly when the vault root is `wiki/pages/`, but if you open `wiki/` as the vault root, Obsidian may not resolve the subfolder paths.

Enable compatibility mode to use bare `[[page-name]]` links instead:

```json
// .axiom/config.json (local) or global config
{
  "obsidianCompat": true
}
```

With this enabled, the agent generates links like `[[alan-turing]]` instead of `[[entities/alan-turing]]`. Axiom's graph parser handles both formats — bare names default to the `entities/` category.

You can also set this during `axiom-wiki init` or by editing your config directly.
