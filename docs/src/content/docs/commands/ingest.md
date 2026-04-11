---
title: ingest
description: Ingest source files into the wiki.
---

```bash
axiom-wiki ingest [file]
axiom-wiki ingest [file] --interactive
```

Ingest a specific file or scan `raw/` for anything not yet processed.

## Usage

```bash
axiom-wiki ingest path/to/file.pdf    # ingest a specific file
axiom-wiki ingest                      # scan raw/ and ingest new files
```

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

## Re-ingest

When you ingest a file that already has a wiki summary, Axiom compares old and new content and only updates pages that changed.

## Interactive mode

Add `--interactive` to review topics before writing:

```bash
axiom-wiki ingest notes.md --interactive
```

See the [Interactive Ingest guide](/axiom-wiki/guides/interactive-ingest/) for details.

## Supported file types

`.md`, `.txt`, `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.html`, `.docx`
