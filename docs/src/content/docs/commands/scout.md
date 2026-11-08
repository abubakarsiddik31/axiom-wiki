---
title: scout
description: Always-on intake — hand the wiki a link or a note, tag it @scout.
---

```bash
axiom-wiki scout                          # start the listener
axiom-wiki scout --share https://youtu.be/… --tags read-later
axiom-wiki scout --status
axiom-wiki scout --once                   # drain the queue and exit
```

**Scout** is the wiki's front door. It is an always-on intake agent: you hand it a link or a note, from wherever you are, and it queues the hand-off, clips it, and compiles it into the wiki. There is no platform integration to maintain — a share sheet, `curl`, a dropped file, a pasted thread, or another agent all produce the same thing: a queue item.

Mention it as **`@scout`**. Tags in the shared text (`#read-later`) become page tags.

## Why a queue

Scout separates *capturing* from *compiling*. A phone share should return in milliseconds, not wait for a transcript download and an LLM pass. The queue is an append-only event log at `scout/queue.jsonl`, so:

- a share is durable the moment it returns;
- a crash mid-drain leaves a visible `running` item, not a lost one;
- the same link shared twice is one item;
- `--status` and the web page replay the log into the current view.

The compilation lock is still respected. If `ingest`/`watch`/`clip` is running, Scout leaves the rest of the queue for the next pass instead of racing it.

## Starting the listener

```bash
# Loopback only (a shortcut or curl on this machine)
axiom-wiki scout

# Accept shares from your phone on the same network
axiom-wiki scout --host 0.0.0.0

# Run it alongside the web UI
axiom-wiki serve --allow-write --scout
```

On start it prints the share endpoint, the token, and the drop folder. The token is generated on first use and stored at `scout/token` (mode `0600`). **Every request except `/healthz` needs it.**

| Option | Description |
|---|---|
| `--status` | Show the queue, the listener heartbeat, and the last 25 items |
| `--share <value>` | Queue a URL (or a note) and exit |
| `--text <text>` | Extra context for `--share`, or a note on its own |
| `--file <path>` | Queue a file to ingest |
| `--tags <a,b>` | Comma-separated tags |
| `--once` | Scan the drop folder, drain the queue once, and exit |
| `--no-ingest` | Clip links into `raw/` but do not compile them |
| `--port <port>` | Listener port (default `1719`) |
| `--host <host>` | Listener host (default `127.0.0.1`) |
| `--limit <n>` | Maximum items per drain (default `5`) |
| `--json` | Machine-readable output |

## Sharing from a phone

The listener speaks plain HTTP, so any share sheet that can POST works. On iOS or Android, make a Shortcut that:

1. receives a URL from the share sheet;
2. sends `POST http://<your-machine>:1719/share` with the header
   `X-Scout-Token: <token>` and the JSON body `{"url": "…"}`;
3. optionally adds tags.

The equivalent from a terminal:

```bash
curl -X POST http://127.0.0.1:1719/share \
  -H "X-Scout-Token: $(cat axiom/scout/token)" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://youtu.be/dQw4w9WgXcQ","tags":["read-later"]}'
```

For phone → laptop, bind `--host 0.0.0.0`. The token is the only credential; keep it out of screenshots. On a shared network, prefer a VPN or a local-only shortcut.

## Pasting a thread or a doc

Post the text to `/text` (or paste it into **Scout → Share** in the web app):

```bash
curl -X POST http://127.0.0.1:1719/text \
  -H "X-Scout-Token: $(cat axiom/scout/token)" \
  -H 'Content-Type: application/json' \
  -d '{"text":"@scout this thread is worth keeping #read-later\nhttps://example.com/post"}'
```

Scout extracts every link, treats the surrounding prose as ingest context, and applies every `#tag` to the resulting source page. Text with **no** link becomes an inbox note, so a thought and a link take the same path.

## Dropping a file

Anything placed in `scout/drop/` is picked up within a few seconds (or by `--once`):

- `.md`, `.txt` — parsed as a note or a set of links;
- `.url`, `.webloc` — the URL inside is extracted;
- any other supported source extension (`.pdf`, `.docx`, `.html`, images, CSV) — queued as a file ingest.

Processed files move to `scout/processed/`. A drop is already an explicit hand-off, so no `@scout` mention is needed.

## Agents and MCP

Agents get two tools:

- `scout_share` — `{ url?, text?, tags?, note? }` queues a hand-off.
- `scout_queue` — returns the queue summary and recent items.

They are available to the wiki agent (`axiom-wiki query`) and to any MCP client connected with `axiom-wiki mcp`. An agent that finds something worth keeping can hand it over without blocking its own turn.

## Failures

A failed clip or ingest is marked `failed` with the error, never silently dropped. The web page and `--status` show it; **Retry** (or `scout/retry`) puts it back in the queue. The most common causes are a missing transcript, an unreachable URL, and an LLM authentication error — the last one means the source was clipped but not compiled, so fixing the key and retrying does not re-download it.

## Related

- [`watch`](/commands/watch) — the older folder watcher for `raw/`.
- [`clip`](/commands/clip) — one-off URL clipping.
- [`serve`](/commands/serve) — the web app, including the Scout page.
