---
title: export
description: Publish the wiki as a self-contained static HTML site.
---

```bash
axiom-wiki export                       # writes ./axiom-site
axiom-wiki export --out public --title "My Notes"
axiom-wiki export --base-url https://notes.example.com --open
```

`export` renders the wiki into a directory of plain HTML, CSS, and (optionally) copied media. It needs no server at runtime: links are relative, the search index is embedded in the page, and the site works when opened from `file://` or hosted on any static host.

## What it produces

```
axiom-site/
├── index.html              overview: stats, recent, most connected, categories
├── pages.html              every page, grouped by category, with a live filter
├── search.html             client-side search over titles, tags, summaries, and text
├── graph.html              the link graph as a self-contained SVG
├── 404.html                a static not-found page
├── p/<category>/<slug>.html
├── assets/style.css
├── assets/media/…          images copied from the wiki
├── sitemap.xml             when --base-url is set
├── robots.txt              when --base-url is set
└── .axiom-export.json      manifest used to recognise a previous export
```

Each page includes its tags, sources, updated date, table of contents, outgoing links, backlinks, and previous/next navigation within its category. `[[wiki-links]]` become relative links; links to pages that do not exist are rendered as dead-link text rather than broken anchors.

Inbox notes are intentionally excluded from the public site. The export reports how many were left out.

## Options

| Option | Description |
|---|---|
| `-o, --out <dir>` | Output directory (default `axiom-site`) |
| `--title <title>` | Site title shown in the header and page titles (default `Axiom Wiki`) |
| `--base-url <url>` | Canonical base URL; adds `<link rel="canonical">`, Open Graph URLs, `sitemap.xml`, and `robots.txt` |
| `--no-graph` | Omit `graph.html` |
| `--no-search` | Omit `search.html` and the embedded index |
| `--force` | Replace a non-empty output directory |
| `--open` | Open the exported `index.html` in a browser |

## Output safety

Re-exporting over a previous export is fine — the `.axiom-export.json` marker identifies it. If the output directory is non-empty and has no marker, `export` refuses to delete it unless you pass `--force`. It also refuses to write inside `wiki/` or `raw/`.

## Hosting

Any static host works. A few common setups:

```bash
# GitHub Pages: publish from a docs/ folder on main
axiom-wiki export --out docs --base-url https://username.github.io/repo

# Netlify / Vercel: build command
axiom-wiki export --out public --base-url "$URL"

# Local preview
axiom-wiki export --open
```

Because the search index is inline and all links are relative, the same directory works at a domain root, under a subpath, or straight from disk.
