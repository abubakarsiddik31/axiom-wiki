---
title: import
description: Bulk import files, folders, and URL lists into raw/ and compile them.
---

```bash
axiom-wiki import ~/Documents/vault ~/Downloads/papers   # folders and files
axiom-wiki import ~/vault --include-media                # include PDFs and images
axiom-wiki import --from bookmarks.html                  # a browser export
axiom-wiki import --from readwise.csv --url https://example.com/post
axiom-wiki import ~/vault --dry-run                      # plan only, no writes
```

`import` is how a library gets in. Point it at the places your material already lives — an Obsidian vault, a Notion export, a downloads folder, a browser bookmarks file — and it stages every supported source into `raw/`, then compiles it through the same pipeline [`ingest`](/commands/ingest) uses.

Nothing is copied or fetched until the plan has been built and, in the web app, reviewed.

## What it accepts

| Input | How |
|---|---|
| Files | Any supported type: `.md`, `.txt`, `.pdf`, `.html`, `.docx`, `.csv`, `.tsv`, images |
| Folders | Walked recursively, up to 12 levels |
| PDFs and images inside folders | Skipped by default; pass `--include-media` |
| URLs | `--url <url>`, repeatable |
| URL lists | `--from <file>`, repeatable: `.txt`, `.csv`/`.tsv`, `.json`, or a bookmarks `.html` |

List files are read in the shape exports actually come in: one URL per line, a Readwise/Pocket CSV with a `URL` column, a Chrome bookmarks JSON tree, or a Netscape bookmarks HTML file.

## What gets skipped, and why

- **Duplicates by content.** A file whose SHA-256 already exists in `raw/` is not copied again, whatever its name. Two identical files in the same run collapse to one.
- **Hidden and junk folders.** `.git`, `.obsidian`, `.trash`, `node_modules`, `__pycache__`, `venv`, `dist`, `build`, and friends are never walked, so a vault's internals do not become sources.
- **Already clipped URLs.** A link already present in `raw/` (via its `source_url` frontmatter or the import ledger) is reported as a duplicate instead of being downloaded again.
- **Unsupported extensions** are reported for an explicit file and silently skipped inside a folder.
- **Collisions** get a numeric suffix (`note.md` → `note-2.md`) instead of overwriting.

Every skipped item appears in the plan with a reason.

## Options

| Option | Description |
|---|---|
| `--url <url>` | A URL to clip (repeatable) |
| `--from <file>` | Read URLs from a `.txt`, `.csv`, `.tsv`, `.json`, or bookmarks `.html` file (repeatable) |
| `--include-media` | Include PDFs and images found inside folders |
| `--move` | Move files into `raw/` instead of copying them |
| `--no-ingest` | Stage sources without compiling them |
| `--dry-run` | Print the plan and stop |
| `--context <text>` | Extra framing for the ingest prompt |
| `--limit <n>` | Maximum URLs per run (default `200`) |
| `--file-limit <n>` | Maximum files per run (default `2000`) |
| `--json` | Print the plan or run result as JSON |

URLs are fetched sequentially and politely. The limit exists so a 4000-link bookmarks export cannot silently run for hours; the plan says how many were left out.

## The web app

**Import** in `axiom-wiki serve --allow-write` mirrors the command:

- Paste file and folder paths (resolved on the machine running the server) and URLs, or name a bookmarks/list file.
- **Preview plan** shows ready, duplicate, skipped, and the exact `raw/` filename for each source.
- **Import** runs as a background job; the plan table and a live log stream show progress, and the result links through to **Sources**.

The browser always **copies** — `--move` is CLI-only, so a mis-click cannot empty a vault.

## API

| Route / action | What it does |
|---|---|
| `POST /actions/import/plan` | `{ paths?, urls?, from?, includeMedia?, urlLimit?, fileLimit? }` → `{ plan }` |
| `POST /actions/import/run` | Same body, plus `{ ingest?, context? }` → `{ job }` |

Both actions require `--allow-write`, because planning reads paths outside `raw/`; a LAN-exposed read-only server should not become a filesystem probe. `import/run` takes the compilation lock through `ingest`, so it refuses to race another compile.

## Related

- [`ingest`](/commands/ingest) — one file or URL, with an interactive mode.
- [`watch`](/commands/watch) — compile files continuously as they land in `raw/`.
- [`scout`](/commands/scout) — hand over links and notes from a phone or another machine.
