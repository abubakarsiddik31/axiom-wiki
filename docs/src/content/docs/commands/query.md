---
title: query
description: Interactive chat against your wiki.
---

```bash
axiom-wiki query
axiom-wiki query --thread thr_4bb9d23dc2a3   # resume a saved conversation
```

Opens an interactive chat where you can ask questions about your wiki content. The agent searches relevant pages, synthesizes an answer, and cites sources.

Every conversation is saved. The first question names the thread, each turn is persisted under `<wikiDir>/chat/threads/`, and the footer prints the resume command. Reopen it with `--thread <id>`, or list what you have with [`axiom-wiki threads`](/commands/threads). The web **Ask** page reads the same threads, so a conversation can start in the terminal and continue in the browser.

You can also type questions directly in the interactive shell without the `/query` prefix:

```
> What did Alan Turing say about intelligence?
```

After answering, the agent offers to file the answer as an analysis page in `wiki/pages/analyses/`.

## Reranking

Before the agent sees evidence, the query pipeline over-fetches candidates from hybrid search, rescores each `(query, page)` pair with the configured reranker, and keeps the best few before expanding the link graph. The default is a **local cross-encoder** (`Xenova/bge-reranker-base`), so nothing leaves the machine. You can switch to the chat model, Cohere Rerank, or turn it off with `axiom-wiki rerank --provider …` or **Settings → Reranker** in the web app.

If the local model is not downloaded yet, retrieval falls back to the hybrid order and the Ask preview shows why. Run `axiom-wiki rerank --setup` once to download it. See [Rerankers](/reference/rerankers) for the model table and trade-offs.

## Analyses-first search

The agent checks `wiki/pages/analyses/` first to see if the question has already been answered. Previously filed analysis pages receive a 1.5x boost in search ranking, so they surface ahead of raw entity or concept pages. This means repeat questions are answered faster and more consistently.

## Structural tree search

For large wikis with thousands of pages, the query agent avoids dumping the entire catalog into context. Instead, it navigates structurally:
- Inspects high-level category and tag trees using `list_pages({ mode: "tree" })`.
- Runs targeted hybrid searches with section-level anchor resolution.
- Explores graph connections and backlinks (`get_backlinks`) to trace relationships between concepts and entities.

## Strict Forensic Grounded Mode (Zero Trained Knowledge)

To enforce strict, zero-hallucination answers where the AI is **strictly barred from using pre-trained parametric knowledge**:

```bash
# Launch interactive chat in forensic grounded mode:
axiom-wiki query --forensic
# Or using the -g alias:
axiom-wiki query -g
# Or pass a question directly:
axiom-wiki query --forensic "What was the initial revenue in paper 1?"
```

Inside the interactive shell or Query screen:
- Type `/forensic [question]` or press `Ctrl+G` to toggle Strict Grounded Mode on and off.
- The UI displays a `🛡️ STRICT GROUNDED (Zero trained knowledge)` status banner.

### Grounding Rules Enforced:
1. **Absolute Pre-Training Ban**: The model is forbidden from using outside world knowledge or guessing facts not explicitly in the wiki.
2. **Mandatory Inline Proof**: Every claim must directly cite a retrieved wiki page or source locator: `(→ [[page]], source: doc#locator)`.
3. **Refusal on Insufficient Evidence**: If the retrieved documents do not contain the answer, the model explicitly states:
   *"The wiki does not contain sufficient information to answer this question."*
   and states what sources would be needed. Never guesses from memory.
