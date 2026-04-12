---
title: Quick Start
description: Get your first wiki running in under 2 minutes.
---

## Setup

```bash
axiom-wiki init
```

The setup wizard asks for:
1. **Scope** — local (project) or global (personal) wiki
2. **LLM provider** — Google Gemini (free), OpenAI, Anthropic, or Ollama
3. **API key** — paste your key (or Ollama URL)
4. **Model** — pick from the provider's model list
5. **Wiki directory** — where pages are stored
6. **Raw sources folder** — where you drop files to ingest

## Interactive shell

Launch with no arguments:

```bash
axiom-wiki
```

Type `/` to open the slash command menu. Navigate with arrow keys, complete with Tab, run with Enter.

Or type a question directly to query your wiki:

```
> What did Alan Turing say about intelligence?
```

## Your first ingest

Drop a file into your `raw/` folder, then:

```bash
axiom-wiki ingest
```

The agent reads the file, extracts entities and concepts, creates wiki pages, and updates the index — all automatically.

## Auto-wiki a codebase

Inside a project directory:

```bash
axiom-wiki init       # choose "Local"
axiom-wiki autowiki   # auto-generate wiki from codebase
```

Later, after making code changes:

```bash
axiom-wiki sync    # update only affected pages
```
