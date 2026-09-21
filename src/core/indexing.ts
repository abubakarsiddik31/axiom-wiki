import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { insert } from '@orama/orama';
import { generateEmbedding, generateEmbeddings, getDefaultModel } from './embeddings.js';
import {
  getOrama,
  indexPageChunks,
  persistOrama,
  clearIndex,
  saveSearchManifest,
  type SearchDoc,
  type SearchManifest,
} from './search/orama-store.js';
import { listPages } from './wiki.js';
import { loadMapState, saveMapState, markPageVectorSynced } from './sync.js';
import type { AxiomConfig } from '../config/index.js';

export { persistOrama } from './search/orama-store.js';

export interface MarkdownChunk {
  id: string;
  pagePath: string;
  title: string;
  sectionTitle?: string;
  sectionAnchor?: string;
  summary: string;
  content: string;
  tags: string[];
  category: string;
  embeddingText: string;
}

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

export function chunkMarkdownPage(
  pageRelPath: string,
  title: string,
  summary: string,
  tags: string[],
  category: string,
  rawContent: string,
): MarkdownChunk[] {
  const content = rawContent.trim();

  // If content is concise (< 2000 chars), keep it as a single chunk
  if (content.length < 2000) {
    const embeddingText = `${title}\n${summary}\n\n${content}`.trim();
    return [
      {
        id: pageRelPath,
        pagePath: pageRelPath,
        title,
        summary,
        content,
        tags,
        category,
        embeddingText,
      },
    ];
  }

  const chunks: MarkdownChunk[] = [];
  const lines = content.split('\n');

  interface RawSection {
    title: string;
    anchor: string;
    lines: string[];
  }

  const sections: RawSection[] = [];
  let currentSection: RawSection = {
    title: 'Overview',
    anchor: 'overview',
    lines: [],
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,3})\s+(.+)$/);
    if (headingMatch) {
      if (currentSection.lines.some((l) => l.trim().length > 0)) {
        sections.push(currentSection);
      }
      const headingText = headingMatch[2].trim();
      currentSection = {
        title: headingText,
        anchor: slugifyHeading(headingText),
        lines: [],
      };
    } else {
      currentSection.lines.push(line);
    }
  }
  if (currentSection.lines.some((l) => l.trim().length > 0)) {
    sections.push(currentSection);
  }

  // If no sections were found (no headings), treat entire content as one section to be paragraph-split
  if (sections.length === 0) {
    sections.push({
      title: 'Content',
      anchor: 'content',
      lines: [content],
    });
  }

  for (const section of sections) {
    const sectionBody = section.lines.join('\n').trim();
    if (!sectionBody) continue;

    // If section body is within limit (<= 2500 chars), create 1 chunk
    if (sectionBody.length <= 2500) {
      const isOverview = section.anchor === 'overview';
      const chunkId = isOverview ? pageRelPath : `${pageRelPath}#${section.anchor}`;
      const headerPrefix = isOverview ? `[${title}]` : `[${title} > ${section.title}]`;
      const embeddingText = `${headerPrefix}\n${summary ? 'Summary: ' + summary + '\n\n' : ''}${sectionBody}`;

      chunks.push({
        id: chunkId,
        pagePath: pageRelPath,
        title,
        sectionTitle: isOverview ? undefined : section.title,
        sectionAnchor: isOverview ? undefined : section.anchor,
        summary,
        content: sectionBody,
        tags,
        category,
        embeddingText,
      });
    } else {
      // Long section: split by paragraphs with sliding window
      const paragraphs = sectionBody.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
      let subIndex = 1;
      let buffer: string[] = [];
      let bufferLen = 0;

      for (let i = 0; i < paragraphs.length; i++) {
        const para = paragraphs[i].trim();
        buffer.push(para);
        bufferLen += para.length;

        // When buffer reaches ~1500 chars or it's the last paragraph
        if (bufferLen >= 1500 || i === paragraphs.length - 1) {
          const chunkContent = buffer.join('\n\n');
          const chunkId = `${pageRelPath}#${section.anchor}-${subIndex}`;
          const headerPrefix = `[${title} > ${section.title} (part ${subIndex})]`;
          const embeddingText = `${headerPrefix}\n${summary ? 'Summary: ' + summary + '\n\n' : ''}${chunkContent}`;

          chunks.push({
            id: chunkId,
            pagePath: pageRelPath,
            title,
            sectionTitle: `${section.title} (part ${subIndex})`,
            sectionAnchor: `${section.anchor}-${subIndex}`,
            summary,
            content: chunkContent,
            tags,
            category,
            embeddingText,
          });

          subIndex++;
          // Overlap: keep last paragraph if there are more
          if (i < paragraphs.length - 1 && buffer.length > 1) {
            const lastPara = buffer[buffer.length - 1];
            buffer = [lastPara];
            bufferLen = lastPara.length;
          } else {
            buffer = [];
            bufferLen = 0;
          }
        }
      }
    }
  }

  // Edge case: if somehow no chunks were produced, produce at least one
  if (chunks.length === 0) {
    chunks.push({
      id: pageRelPath,
      pagePath: pageRelPath,
      title,
      summary,
      content,
      tags,
      category,
      embeddingText: `${title}\n${summary}\n\n${content}`.trim(),
    });
  }

  return chunks;
}

export async function reindexWiki(
  config: AxiomConfig,
  options?: { batchSize?: number; onProgress?: (indexed: number, total: number) => void }
): Promise<{ count: number; chunksCount: number }> {
  const { embeddings, wikiDir } = config;
  if (!embeddings || embeddings.provider === 'none') {
    return { count: 0, chunksCount: 0 };
  }

  await clearIndex(config);
  const pages = await listPages(wikiDir);
  if (pages.length === 0) {
    return { count: 0, chunksCount: 0 };
  }

  const batchSize = options?.batchSize ?? 50;
  const allChunks: MarkdownChunk[] = [];

  for (const page of pages) {
    const absPath = path.join(wikiDir, page.path);
    if (!fs.existsSync(absPath)) continue;
    try {
      const raw = fs.readFileSync(absPath, 'utf-8');
      const { data, content } = matter(raw);
      const title = String(data['title'] ?? path.basename(page.path, '.md'));
      const summary = String(data['summary'] ?? '');
      const tags = Array.isArray(data['tags']) ? data['tags'] : [];
      const category = String(data['category'] ?? page.path.split('/')[2] ?? '');

      const chunks = chunkMarkdownPage(page.path, title, summary, tags, category, content);
      allChunks.push(...chunks);
    } catch (err) {
      console.error(`[indexing] Failed to parse ${page.path}: ${err}`);
    }
  }

  const db = await getOrama(config);
  let indexedChunks = 0;

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    try {
      const texts = batch.map((c) => c.embeddingText);
      const vectors = await generateEmbeddings(config, texts);

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const vector = vectors[j];
        const doc: SearchDoc = {
          id: chunk.id,
          pagePath: chunk.pagePath,
          title: chunk.title,
          sectionTitle: chunk.sectionTitle,
          sectionAnchor: chunk.sectionAnchor,
          summary: chunk.summary,
          content: chunk.content,
          tags: chunk.tags,
          category: chunk.category,
          embedding: vector,
        };
        // Cast required because Orama's TypedDocument uses dynamic template string for vector dimensions
        await insert(db, doc as any);
        indexedChunks++;
      }

      options?.onProgress?.(indexedChunks, allChunks.length);

      // Rate pacing for Google Gemini free tier (stay below 15 RPM)
      if (embeddings.provider === 'google' && i + batchSize < allChunks.length) {
        await new Promise((resolve) => setTimeout(resolve, 3500));
      }
    } catch (err) {
      console.error(`[indexing] Batch embedding failed at offset ${i}: ${err}`);
    }
  }

  await persistOrama(config);

  // Save the manifest with accurate chunk and page counts
  const currentProvider = embeddings.provider;
  const currentModel = embeddings.model || getDefaultModel(currentProvider);
  const currentDims = embeddings.dimensions || 768;

  const manifest: SearchManifest = {
    version: 1,
    provider: currentProvider,
    model: currentModel,
    dimensions: currentDims,
    lastReindexAt: new Date().toISOString(),
    pageCount: pages.length,
    chunkCount: indexedChunks,
  };
  saveSearchManifest(wikiDir, manifest);

  return { count: pages.length, chunksCount: indexedChunks };
}

export async function indexWikiPage(config: AxiomConfig, pageRelPath: string): Promise<void> {
  const { wikiDir, embeddings } = config;
  if (!embeddings || embeddings.provider === 'none') {
    return;
  }
  const absPath = path.join(wikiDir, pageRelPath);
  if (!fs.existsSync(absPath)) {
    console.error(`[indexing] File not found: ${absPath}`);
    return;
  }

  const raw = fs.readFileSync(absPath, 'utf-8');
  const { data, content } = matter(raw);

  const title = String(data['title'] ?? path.basename(pageRelPath, '.md'));
  const summary = String(data['summary'] ?? '');
  const tags = Array.isArray(data['tags']) ? data['tags'] : [];
  const category = String(data['category'] ?? pageRelPath.split('/')[2] ?? '');

  const chunks = chunkMarkdownPage(pageRelPath, title, summary, tags, category, content);

  if (chunks.length === 1) {
    const embedding = await generateEmbedding(config, chunks[0].embeddingText);
    const doc: SearchDoc = {
      id: chunks[0].id,
      pagePath: chunks[0].pagePath,
      title: chunks[0].title,
      summary: chunks[0].summary,
      content: chunks[0].content,
      tags: chunks[0].tags,
      category: chunks[0].category,
      embedding,
    };
    await indexPageChunks(config, pageRelPath, [doc]);
  } else {
    const texts = chunks.map((c) => c.embeddingText);
    const vectors = await generateEmbeddings(config, texts);
    const docs: SearchDoc[] = chunks.map((c, i) => ({
      id: c.id,
      pagePath: c.pagePath,
      title: c.title,
      sectionTitle: c.sectionTitle,
      sectionAnchor: c.sectionAnchor,
      summary: c.summary,
      content: c.content,
      tags: c.tags,
      category: c.category,
      embedding: vectors[i],
    }));
    await indexPageChunks(config, pageRelPath, docs);
  }

  // Mark as synced in map-state
  const mapState = loadMapState(wikiDir);
  if (mapState) {
    const parts = pageRelPath.replace('wiki/pages/', '').replace('.md', '').split('/');
    const pageSlug = parts.slice(1).join('/') || parts[0] || 'unknown';
    markPageVectorSynced(mapState, pageSlug);
    saveMapState(wikiDir, mapState);
  }

  if (process.env['AXIOM_DEBUG'] === '1') {
    console.error(`[indexing] Indexed ${pageRelPath} (${chunks.length} chunks)`);
  }
}
