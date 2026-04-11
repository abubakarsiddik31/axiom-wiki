---
title: init
description: First-time setup wizard.
---

```bash
axiom-wiki init
```

Interactive setup wizard that configures:

1. **Scope** — local (project `.axiom/`) or global (`~/my-wiki/`)
2. **LLM provider** — Google Gemini, OpenAI, Anthropic, or Ollama
3. **API key** — your provider key (Ollama runs locally, no key needed)
4. **Model** — select from the provider's available models
5. **Wiki directory** — where wiki pages are stored
6. **Raw directory** — where source files go

For local mode, the wizard auto-detects git repos and adds `.axiom/` to `.gitignore`.

Running `init` again lets you reconfigure an existing wiki.
