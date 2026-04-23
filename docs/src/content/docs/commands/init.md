---
title: init
description: First-time setup wizard.
---

```bash
axiom-wiki init
```

Interactive setup wizard that configures:

1.  **Scope** — local (project `axiom/`) or global (`~/axiom/`)
2.  **LLM provider** — Google Gemini, OpenAI, Anthropic, or Ollama
3.  **API key** — your provider key (Ollama runs locally, no key needed)
4.  **Model** — select from the provider's available models
5.  **Wiki directory** — where wiki pages are stored
6.  **Semantic Search** — Enable hybrid search (recommended) and configure an embedding provider.

### Upgrading Legacy Wikis
For local mode, the wizard auto-detects git repos and adds `axiom/` to `.gitignore`.

Running `init` again lets you reconfigure an existing wiki.

### Legacy wiki migration

If you're upgrading from v0.4 and have an existing `~/my-wiki/` directory, `init` will detect it and offer to migrate it to `~/axiom/`. See the [migration guide](/axiom-wiki/guides/migration) for details.
