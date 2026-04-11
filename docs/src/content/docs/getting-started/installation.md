---
title: Installation
description: Install Axiom Wiki via npm, yarn, pnpm, or Docker.
---

## npm / yarn / pnpm

```bash
npm install -g axiom-wiki
```

```bash
yarn global add axiom-wiki
```

```bash
pnpm add -g axiom-wiki
```

**Run without installing:**

```bash
npx axiom-wiki init
```

Both `axiom-wiki` and the shorthand `axwiki` are available after install.

## From source

```bash
git clone https://github.com/abubakarsiddik31/axiom-wiki.git
cd axiom-wiki
pnpm install && pnpm build
pnpm link --global
axiom-wiki init
```

## Docker

```bash
docker run -it -v $(pwd):/wiki axiomwiki/axiom-wiki init
```

See the [Docker section](#docker-compose) below for Compose examples.

## Docker Compose

**Cloud provider:**

```yaml
services:
  axiom-wiki:
    image: axiomwiki/axiom-wiki
    volumes:
      - ./my-wiki:/wiki
    environment:
      - GOOGLE_GENERATIVE_AI_API_KEY=${GOOGLE_GENERATIVE_AI_API_KEY}
```

**With Ollama (fully offline):**

```yaml
services:
  axiom-wiki:
    image: axiomwiki/axiom-wiki
    volumes:
      - ./wiki:/app/wiki
      - ./raw:/app/raw
    environment:
      - OLLAMA_BASE_URL=http://ollama:11434/api
  ollama:
    image: ollama/ollama
    volumes:
      - ollama_data:/root/.ollama
volumes:
  ollama_data:
```
