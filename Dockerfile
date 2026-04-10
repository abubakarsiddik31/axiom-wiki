FROM node:22-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install dependencies (prod only)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output
COPY dist/ ./dist/

# Make binary executable
RUN chmod +x dist/bin/axiom-wiki.js

# V2: For Ollama provider — set to your Ollama host (e.g. http://ollama:11434/api in compose)
ENV OLLAMA_BASE_URL=""

ENTRYPOINT ["node", "dist/bin/axiom-wiki.js"]
CMD ["--help"]
