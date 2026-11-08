---
title: maintain
description: Plan or apply deterministic wiki maintenance — summaries, orphan links, duplicates, and dead links.
---

```bash
axiom-wiki maintain             # print the plan (no writes)
axiom-wiki maintain --apply     # write the safe fixes
axiom-wiki maintain --json      # machine-readable plan or result
```

`maintain` is the mechanical half of "the wiki that maintains itself". It never calls an LLM and never rewrites prose: it finds the chores that are safe to do deterministically and either reports them or applies them.

## What it looks at

| Finding | Default action |
|---|---|
| Pages with no `summary` | Backfill an extractive summary from the page's own body |
| Orphan pages (no inbound links) | Add an inbound link — wrap an existing mention, or append a `## Related` bullet from a page that shares tags |
| Duplicate-looking pages | Propose the pair; **never** merge automatically |
| Dead links | Report the missing target and its referrers |
| Pages without tags | Report only — tags are a judgement call |

Inbox notes are deliberately excluded from orphan adoption. They are supposed to wait until you triage them.

## Options

| Option | Description |
|---|---|
| `--apply` | Write the safe fixes instead of only printing the plan |
| `--json` | Print the plan (or the full run result with `--apply`) as JSON |
| `--limit <n>` | Maximum items handled per category (default `25`) |
| `--no-summaries` | Skip summary backfill |
| `--no-links` | Skip orphan adoption |
| `--no-duplicates` | Skip duplicate proposals |
| `--no-dead-links` | Skip dead-link reporting |
| `--no-tags` | Skip untagged-page reporting |
| `--stubs` | With `--apply`, create a stub page for each safe dead-link target |
| `--refresh-stale` | With `--apply`, also rewrite summaries that share no content words with the body |

## Safety

- The compilation lock is acquired before any write, so `maintain` never races an ingest.
- Applied changes rebuild `wiki/index.md` and `wiki/moc.md`, append to `wiki/log.md`, refresh the semantic index for touched pages, and commit the result when the wiki is a git repository.
- Duplicate detection only proposes; merging stays a deliberate `page/merge` (or **Merge** in the web UI).
- Running it twice is a no-op once the safe fixes have landed.

## Scheduling it

For a truly nightly pass, use cron (or launchd/systemd) with `--apply`:

```cron
0 3 * * * cd /path/to/project && axiom-wiki maintain --apply --limit 50 >> ~/.axiom-maintain.log 2>&1
```

If you keep `axiom-wiki serve --allow-write` running, the server can do it for you:

```bash
axiom-wiki serve --allow-write --maintain-interval 1440
```

The first pass starts shortly after boot, then repeats every `N` minutes. The same pass is available on demand from the **Integrity** page (**Preview fixes** / **Apply safe fixes**).
