---
title: .axiomignore
description: Exclude files from watch mode and batch ingest.
---

Exclude files from watch mode and batch ingest using `.gitignore` syntax. A default `.axiomignore` is created in your `raw/` folder during `init`:

```
# axiomignore — patterns to skip during watch/ingest

# Temporary files
*.tmp
*.swp
.DS_Store
```

## Examples

```
# Ignore an archive folder
archive/

# Ignore a specific file
draft-do-not-ingest.md

# Ignore all PDFs
*.pdf
```

The `.axiomignore` file uses the same pattern syntax as `.gitignore`.
