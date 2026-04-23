import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { generateEmbedding } from './embeddings.js';
import { indexPage, persistOrama, clearIndex, type SearchDoc } from './search/orama-store.js';
import { listPages } from './wiki.js';
import type { AxiomConfig } from '../config/index.js';

export { persistOrama } from './search/orama-store.js';

export async function reindexWiki(config: AxiomConfig): Promise<{ count: number }> {
  const { embeddings, wikiDir } = config;
  if (!embeddings || embeddings.provider === 'none') {
    return { count: 0 };
  }

  await clearIndex(config);
  const pages = await listPages(wikiDir);
  let count = 0;

  for (const page of pages) {
    try {
      await indexWikiPage(config, page.path);
      count++;
    } catch (err) {
      console.error(`[indexing] Failed to index ${page.path}: ${err}`);
    }
  }

  await persistOrama(config);
  return { count };
}

export async function indexWikiPage(config: AxiomConfig, pageRelPath: string): Promise<void> {
  const { wikiDir } = config;
  const absPath = path.join(wikiDir, pageRelPath);
  if (!fs.existsSync(absPath)) return;

  const raw = fs.readFileSync(absPath, 'utf-8');
  const { data, content } = matter(raw);

  const title = String(data['title'] ?? path.basename(pageRelPath, '.md'));
  const summary = String(data['summary'] ?? '');
  const tags = Array.isArray(data['tags']) ? data['tags'] : [];
  const category = String(data['category'] ?? pageRelPath.split('/')[2] ?? '');

  // Generate embedding for the content (or title + summary + content)
  const textToIndex = `${title}\n${summary}\n${content}`;
  const embedding = await generateEmbedding(config, textToIndex);

  const doc: SearchDoc = {
    id: pageRelPath,
    title,
    summary,
    content,
    tags,
    category,
    embedding,
  };

  await indexPage(config, doc);
}
