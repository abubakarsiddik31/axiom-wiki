---
title: ingest
description: Ingest source files into the wiki.
---

```bash
axiom-wiki ingest [file-or-url]
axiom-wiki ingest [file-or-url] --interactive
```

Ingest a local file, a URL, or scan `raw/` for anything not yet processed.

## Usage

```bash
axiom-wiki ingest path/to/file.pdf           # ingest a local file
axiom-wiki ingest https://example.com/article # clip URL and ingest in one step
axiom-wiki ingest                             # scan raw/ and ingest new files
```

When given a URL, Axiom fetches the page, extracts the article content (using Readability), saves it to `raw/`, and immediately ingests it — no separate `clip` step needed.

## What happens

The agent reads the file, extracts entities and concepts, creates wiki pages, and updates the index. The terminal shows live progress:

```
write_page({"pagePath":"wiki/pages/entities/alan-turing.md"...})
  wiki/pages/entities/alan-turing.md written

my-notes.pdf
  in=42318 out=1847  $0.0231

+ wiki/pages/entities/alan-turing.md
+ wiki/pages/concepts/turing-test.md
~ wiki/index.md
```

## Incremental compilation

Each source file is tracked by SHA-256 hash in `state.json`. When you run `axiom-wiki ingest` without a file argument, only new or modified sources are processed — unchanged files are skipped automatically. This makes re-running ingest fast even on large wikis.

## Semantic dependency tracking

When a source changes, Axiom checks if it shares wiki pages (concepts, entities) with other sources. If it does, those shared pages are flagged for recompilation — and the unchanged sources that contributed to them are pulled back in so the agent can reconcile all information.

For example, if `paper-a.pdf` and `paper-b.pdf` both contributed to the "gradient descent" concept page and `paper-a.pdf` is modified, Axiom will re-process both sources for that shared concept. The terminal shows a summary:

```
3 sources changed, 5 shared concepts need recompilation, pulling in 2 additional sources
```

## Source citations

Generated wiki pages include paragraph-level source citations using the `^[filename]` format. Each factual paragraph cites the source file(s) it was derived from, making it easy to trace claims back to their origin.

## Compilation lock

A PID-based lock prevents concurrent ingest operations. If another ingest is already running, you'll see a "Compilation locked" message. Stale locks from crashed processes are automatically reclaimed.

## Re-ingest

When you ingest a file that already has a wiki summary, Axiom compares old and new content and only updates pages that changed. You can also force a re-ingest from the `sources` screen by pressing `r`.

## Interactive mode

Add `--interactive` to review topics before writing:

```bash
axiom-wiki ingest notes.md --interactive
```

See the [Interactive Ingest guide](/axiom-wiki/guides/interactive-ingest/) for details.

## Supported file types

`.md`, `.txt`, `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.html`, `.docx`
