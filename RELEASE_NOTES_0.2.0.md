# Axiom Wiki v0.2.0

**Faster ingests, smarter change detection, and a cleaner experience.**

---

## Highlights

### Incremental Compilation

Axiom now tracks source files by SHA-256 hash. Running `axiom-wiki ingest` skips unchanged files automatically — only new or modified sources are processed. This makes re-running ingest fast even on large wikis with hundreds of sources.

Existing wikis are migrated automatically on first run — no manual steps needed.

### Ingest URLs Directly

No more separate `clip` step. Pass a URL directly to ingest:

```bash
axiom-wiki ingest https://example.com/article
```

Axiom fetches the page, extracts the article content, saves it to `raw/`, and ingests — all in one command. The `clip` command still exists for saving URLs without ingesting.

### `autowiki` (formerly `map`)

The `map` command has been renamed to `autowiki` — a name that actually tells you what it does. It auto-generates wiki pages from any project folder: codebases, documentation directories, research collections.

```bash
axiom-wiki autowiki
```

`map` still works as an alias for backward compatibility.

### Compilation Lock

A PID-based lock prevents concurrent ingest operations from corrupting your wiki. If another ingest is already running, you'll see a clear message instead of silent data corruption. Stale locks from crashed processes are automatically reclaimed.

### Flat Directory Structure

Local wikis now use a cleaner, flat structure — no more nested `.axiom` directories:

```
.axiom/
  config.json
  state.json
  raw/
  wiki/
    pages/
    index.md
    log.md
```

---

## All Changes

### New Features
- **Incremental compilation** — SHA-256 hash tracking skips unchanged source files during ingest
- **URL ingestion** — `axiom-wiki ingest <url>` clips and ingests in one step
- **Compilation lock** — PID-based lock prevents concurrent ingest/compile corruption
- **`autowiki` command** — renamed from `map` for clarity (`map` remains as alias)

### Improvements
- Flattened local wiki directory structure (no more nested `.axiom/wiki/.axiom/`)
- Reordered slash commands — `autowiki` and `sync` now appear near the top
- State tracking across all commands (ingest, watch, clip, sources)
- Automatic state migration for existing wikis

### New Files
- `src/core/state.ts` — compilation state management
- `src/core/lock.ts` — PID-based locking
- `test/core/state.test.ts` — 24 tests for state management
- `test/core/lock.test.ts` — 13 tests for locking

### Documentation
- Updated all command docs (ingest, watch, clip, sources, sync)
- New wiki structure reference for local and global wikis
- Added state tracking checklist to CLAUDE.md
- Updated README with new features and structure

---

## Migration from 0.1.x

**No manual steps required.** Existing wikis work as-is:
- `state.json` is created automatically on first `ingest` run
- Source hashes are bootstrapped from your existing `log.md`
- The `map` command still works (aliased to `autowiki`)

If you have an existing local wiki with nested `.axiom/wiki/.axiom/`, you can safely delete the inner `.axiom` directory after re-running `init`.

---

## Stats

- 28 files changed
- +1,290 lines / -199 lines
- 76 tests passing
