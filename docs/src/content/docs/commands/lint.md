---
title: lint
description: Check wiki health and audit forensic citation proofs.
---

```bash
axiom-wiki lint [options]
```

Scans your wiki for structural health issues and deterministic citation proofs.

## Options

| Option | Description |
|---|---|
| *(no flags)* | Run full AI-agent wiki lint (checks orphans, broken links, contradictions, and citation health) |
| `--forensic` | Run deterministic mechanical citation audit (verifies every cited locator against raw source files; exits with code `1` on failures) |
| `--strict` | Strict mode: enforces that every factual paragraph has a citation and every source is declared in frontmatter |

---

## Forensic Citation Proof Mode

In standard AI tools, citations can be hallucinated or drift over time. Axiom's **Forensic Citation Mode** provides mechanical, zero-hallucination verification by directly checking your citations against the raw files in `raw/`:

```bash
axiom-wiki lint --forensic
```

### What It Verifies:
1. **Source File Existence:** Ensures that every cited file exists in `raw/` or as a compiled source summary.
2. **Deterministic Locators:**
   - **Timestamps:** Checks that cited timestamps (`^[interview.md#12:45]`) match markers (`**12:45**` or `[12:45]`) in transcripts.
   - **Page Numbers:** Checks that cited pages (`^[paper.pdf#p. 14]`) match page markers in documents.
   - **Line Numbers:** Checks that `#L42` resolves to a real, non-empty line.
   - **Exact Quotes:** Checks that quoted fragments (`^[doc.md#"exact quote"]`) appear verbatim in the source.
3. **Claim Grades:** Audits empirical claim types (`data`, `anecdote`, `outcome`, `assertion`).
4. **Frontmatter Consistency:** Verifies that body citations match `sources: [...]` in YAML frontmatter.

### Sample Audit Output

```
◈ Axiom Wiki — Forensic Citation Audit
────────────────────────────────────────────────────────────
Total Pages Audited:    115
Total Citations:        248
✓ Verified Citations:   248 (100%)
✗ Missing Sources:      0
✗ Unverified Locators:  0
! Unlisted Frontmatter: 0
! Uncited Paragraphs:   0
────────────────────────────────────────────────────────────
Claim Grades:
  • data:        42
  • anecdote:    18
  • outcome:     14
  • assertion:   6
  • unspecified: 168
────────────────────────────────────────────────────────────
Audit Status: ✓ PASSED (Zero hallucinated citations)
```

---

## Pre-Commit Git Hook & CI Integration

Because `axiom-wiki lint --forensic` runs deterministically (0 LLM tokens, milliseconds execution), it exits with code `1` if unverified citations are detected.

Add it to your `.git/hooks/pre-commit`:

```bash
#!/bin/sh
axiom-wiki lint --forensic
```

Now, any hallucinated citation or non-existent source file will block commits before they enter git history.
