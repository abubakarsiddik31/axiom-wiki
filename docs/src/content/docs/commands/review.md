---
title: review
description: Review and resolve wiki contradictions.
---

```bash
axiom-wiki review
```

Surfaces all unresolved contradictions across wiki pages and proposes AI-assisted resolutions.

When ingesting, if the agent detects a conflict between sources it marks the page with a `Contradiction:` block. The review screen finds these and helps resolve them:

```
entities/alan-turing.md
  Contradiction: notes.md says born 1912, wikipedia.md says born 1912-06-23.

AI: Both sources agree on 1912. Wikipedia provides the full date.
    I recommend "born 23 June 1912".

Apply this resolution? (Y/n/e=edit)
```
