---
title: Supported File Types
description: File formats that Axiom Wiki can ingest.
---

| Extension | How it's processed |
|---|---|
| `.md`, `.txt` | Read as plain text |
| `.pdf` | Uploaded to the provider's Files API (Google) or sent as base64 |
| `.png`, `.jpg`, `.jpeg`, `.webp` | Uploaded to the provider's Files API (Google) or sent as base64 |
| `.html` | Converted to Markdown via node-html-markdown |
| `.docx` | Converted to Markdown via mammoth |

For Google Gemini, binary files (PDFs and images) are uploaded to the Google Files API before ingestion — the file bytes are hosted server-side and referenced by URI, bypassing the model's inline token limit.
