---
title: Cost Tracking
description: Token usage and cost logging for all operations.
---

Every operation (ingest, autowiki, sync, query) logs token usage and estimated cost to `wiki/usage.log`:

```
2026-04-11T07:23:19Z | ingest | my-notes.pdf | google/gemini-3-flash-preview | in=42318 out=1847 | $0.0231
2026-04-11T08:01:05Z | map | codebase-overview | google/gemini-3-flash-preview | in=8204 out=921 | $0.0046
```

Cost is also shown inline after each operation in the terminal.

## Viewing costs

```bash
grep "ingest" wiki/usage.log    # cost breakdown per ingest
grep "map" wiki/usage.log       # autowiki operation costs
grep "sync" wiki/usage.log      # sync operation costs
```

## Cost estimates

The `autowiki` and `sync` commands show estimated costs before execution, giving you a chance to cancel before any LLM calls are made.
