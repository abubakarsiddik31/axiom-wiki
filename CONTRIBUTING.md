# Contributing to Axiom Wiki

Thanks for your interest in contributing. This guide covers everything you need to get started.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Commit Style](#commit-style)
- [Where to Start](#where-to-start)

---

## Code of Conduct

Be respectful. Disagreement is fine; rudeness is not. We're all here to build something useful.

---

## Ways to Contribute

| Type | How |
|------|-----|
| Bug report | [Open an issue](https://github.com/abubakarsiddik31/axiom-wiki/issues/new?template=bug_report.md) |
| Feature request | [Open an issue](https://github.com/abubakarsiddik31/axiom-wiki/issues/new?template=feature_request.md) |
| Fix a bug | Open an issue first (for anything non-trivial), then a PR |
| New file type | Add a handler in `src/core/files.ts`, open a PR |
| New LLM provider | Add to `src/config/models.ts` and `src/agent/index.ts`, open a PR |
| Documentation | PRs welcome without an issue |
| UI/UX improvement | Describe the problem first in an issue |

---

## Development Setup

**Requirements:** Node.js ≥ 18, pnpm

```bash
git clone https://github.com/abubakarsiddik31/axiom-wiki.git
cd axiom-wiki
pnpm install
pnpm build
```

Run a command directly without installing globally:

```bash
npx tsx bin/axiom-wiki.ts init
npx tsx bin/axiom-wiki.ts ingest path/to/file.md
```

Watch mode for development (recompiles on save):

```bash
pnpm dev
```

After any code change, compile and check for errors:

```bash
pnpm build
```

There is no test runner — `pnpm build` is the type-check. If it compiles clean, the types are correct.

---

## Project Structure

```
bin/
  axiom-wiki.ts         ← CLI entry point (Commander.js)
src/
  agent/
    index.ts            ← Creates the Mastra agent
    tools.ts            ← All 14 agent tools
    prompts.ts          ← System prompt and wiki conventions
    types.ts            ← Shared types (CoreMessage)
  cli/
    index.tsx           ← Maps commands to Ink screen components
    screens/
      home.tsx          ← Interactive REPL shell
      ingest.tsx        ← Ingest screen
      watch.tsx         ← Watch mode screen
      clip.tsx          ← Web clipper screen
      sources.tsx       ← Source management screen
      review.tsx        ← Contradiction review screen
      query.tsx         ← Query screen
      status.tsx        ← Status screen
      model.tsx         ← Model switcher
      init.tsx          ← Setup wizard
  core/
    wiki.ts             ← Atomic wiki I/O (read/write/index/log/snapshot)
    files.ts            ← File reading, Google Files API upload, message building
    sources.ts          ← Ingested source tracking via log.md
    usage.ts            ← Token cost calculation and usage.log
    clip.ts             ← Web clipper (fetch + Readability + save)
    watcher.ts          ← Chokidar file watcher with .axiomignore
    search.ts           ← Full-text search
  config/
    index.ts            ← conf-based persistent config
    models.ts           ← Provider and model definitions with pricing
  mcp/
    server.ts           ← MCP server exposing all tools via stdio
```

**Key conventions:**
- ESM modules — use `.js` extensions in all relative imports (even for `.ts` source files)
- `"module": "NodeNext"` in tsconfig — no CommonJS
- Ink 5 + React 18 for all terminal UI
- All wiki writes go through `writePage()` in `wiki.ts` — atomic via `.tmp` rename

---

## Making Changes

### Adding a new file type

1. Add the extension to `SUPPORTED_EXTS` in `src/core/files.ts`
2. Add a handler branch in `readSourceFile()` that returns a `SourceFile`
3. If the format is binary (like PDF), set `isBase64: true` and handle it in `buildIngestMessage()`

### Adding a new LLM provider

1. Add the provider entry to `PROVIDERS` in `src/config/models.ts` with model list and pricing
2. Add the provider case in `createAxiomAgent()` in `src/agent/index.ts`
3. Add the API key env var and setup step in `src/cli/screens/init.tsx`

### Adding a new agent tool

1. Define the tool in `src/agent/tools.ts` using `createTool()` from Mastra
2. Add it to the tools array in `src/agent/index.ts`
3. Expose it in `src/mcp/server.ts` if it should be available via MCP

### Modifying the system prompt

Edit `src/agent/prompts.ts`. The prompt defines all wiki conventions — be precise about any new behaviour you add.

---

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm build` — must compile with zero errors
4. Open a PR against `main` with a clear title and description
5. Link the related issue if one exists

**PR checklist:**
- [ ] `pnpm build` passes clean
- [ ] No new TypeScript `any` casts without a comment explaining why
- [ ] New behaviour is reflected in the README if user-facing
- [ ] Commit messages follow the style below

---

## Commit Style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(core): add support for .epub files
fix(cli): handle filenames with spaces in ingest screen
refactor(agent): extract buildIngestMessage to core/files
docs: update README with cost tracking section
chore(config): pin dependency versions for npm release
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `build`, `ci`

Scope is the affected layer: `core`, `cli`, `agent`, `config`, `mcp`, `ci`

---

## Where to Start

Good first issues are tagged [`good first issue`](https://github.com/abubakarsiddik31/axiom-wiki/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) on GitHub.

Areas that always welcome contributions:
- **New file types** — `.epub`, `.rtf`, `.csv`, `.pptx`
- **Provider pricing** — keep model pricing tables up to date as providers change rates
- **Error messages** — make failures more actionable for users
- **Documentation** — usage examples, walkthroughs, recipes

If you're unsure whether something is a good idea, open a discussion issue first. We'd rather talk it through than have you spend time on something that won't land.
