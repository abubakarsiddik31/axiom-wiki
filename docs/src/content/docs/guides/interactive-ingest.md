---
title: Interactive Ingest
description: Control what the agent writes before it starts.
---

Take control of what gets written before the agent starts:

```bash
axiom-wiki ingest notes.md --interactive
```

The agent reads the source, presents the key topics it found, and waits for your input:

```
Agent: I found these key topics: Alan Turing, Enigma Machine, Church-Turing Thesis.
       Any focus areas, things to skip, or framing to apply?
> Focus on the mathematics. Skip the wartime narrative.
```

After pages are written, it summarises what was created and waits for your confirmation before updating the index.

This is useful when:
- A source covers many topics and you want to focus on specific ones
- You want to set the framing or perspective for the wiki pages
- You need to exclude certain sections from being extracted
