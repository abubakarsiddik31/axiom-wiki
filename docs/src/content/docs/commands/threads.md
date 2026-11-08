---
title: threads
description: Saved Ask conversations — list, read, resume, or delete them.
---

```bash
axiom-wiki threads                    # list conversations
axiom-wiki threads --show <id>        # print one as Markdown
axiom-wiki threads --delete <id>      # remove one
axiom-wiki threads --new              # mint a new conversation id
axiom-wiki query --thread <id>        # resume it in the terminal
```

A **thread** is a saved conversation with the wiki. It behaves like a chat: each turn keeps the earlier turns in context, retrieves fresh evidence, and cites the pages it read. Threads are stored under `<wikiDir>/chat/threads/<id>.json`, one file per conversation, written atomically.

Threads are **state, not wiki content**. They never appear in the page list, the graph, or search. When a conversation is worth keeping, **save** it — from the web app's **Ask** page or with `/thread/save` — and it becomes an `analyses/` page that the rest of the wiki can link to and cite.

## Follow-up questions

A chat turn is often not a search query. *"And how does that compare to the other one?"* has no useful keywords. Before retrieval, Axiom rewrites the turn into a standalone query using the recent conversation:

```
Q: What is Raft and why was it designed?
A: Raft is a consensus algorithm…

Follow-up: How does it compare to Paxos?
searched: Comparison of Raft and Paxos consensus algorithms
```

The rewrite is one small model call, skipped when the question already stands on its own. If it fails, retrieval falls back to combining the previous question with the follow-up, so the turn still works. The answer prompt always contains your actual words — only search uses the normalized form, and the web UI shows it under the answer.

## The web app

Open **Ask** in `axiom-wiki serve --allow-write`:

- **Left rail** — every conversation, newest first, with a one-line preview.
- **Transcript** — your turns on the right, Axiom's on the left, with Markdown, `[[wiki-links]]`, sources, and a `searched:` line when a follow-up was rewritten.
- **Composer** — `Enter` sends, `Shift+Enter` adds a line. You can type your next question while an answer streams.
- **Save** — files the whole conversation into `analyses/`. Individual answers also have **file as analysis**.
- **Rename / delete** — the title is editable; delete asks once before removing the thread.

Each conversation has a URL (`/ask/<id>`), so it can be bookmarked or linked from a note.

## API

| Route / action | What it does |
|---|---|
| `GET /api/v1/threads` | List conversations (newest first) |
| `GET /api/v1/threads/:id` | One conversation with rendered answer HTML |
| `POST /actions/thread/new` | Create an empty conversation |
| `POST /actions/thread/ask` | `{ threadId?, question, forensic? }` → `{ job, threadId, created }` |
| `POST /actions/thread/rename` | `{ id, title }` |
| `POST /actions/thread/delete` | `{ id }` |
| `POST /actions/thread/save` | `{ id, title? }` → writes an analysis page |

`thread/ask` returns a job immediately and streams deltas over the job's SSE channel. The user turn is written before the model runs and the assistant turn when it settles, so a crash leaves a visible unanswered question instead of losing it. Read routes work in read-only mode; mutations require `--allow-write` and `X-Axiom-Write: 1`.

## Related

- [`query`](/commands/query) — the terminal conversation, including `--thread`.
- [`serve`](/commands/serve) — the web app and its API.
- [`maintain`](/commands/maintain) — keeps saved analyses tidy alongside the rest of the corpus.
