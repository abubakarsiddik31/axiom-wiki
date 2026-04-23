import { create, insert, search, save, restore, remove, type AnyOrama } from '@orama/orama';
import fs from 'fs';
import path from 'path';
import type { AxiomConfig } from '../../config/index.js';
import { generateEmbedding } from '../embeddings.js';

export interface SearchDoc {
  id: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  category: string;
  embedding: number[];
}

let _orama: AnyOrama | null = null;

export async function getOrama(config: AxiomConfig): Promise<AnyOrama> {
  if (_orama) return _orama;

  const indexPath = getIndexPath(config);
  if (fs.existsSync(indexPath)) {
    try {
      const data = fs.readFileSync(indexPath);
      _orama = await restore('binary', data);
      return _orama!;
    } catch (err) {
      console.error(`[orama] Failed to restore index: ${err}. Recreating...`);
    }
  }

  const dimensions = config.embeddings?.dimensions || 768;

  _orama = await create({
    schema: {
      id: 'string',
      title: 'string',
      summary: 'string',
      content: 'string',
      tags: 'string[]',
      category: 'string',
      embedding: `vector[${dimensions}]`,
    } as const,
  });

  return _orama!;
}

export async function persistOrama(config: AxiomConfig): Promise<void> {
  if (!_orama) return;
  const indexPath = getIndexPath(config);
  const data = await save(_orama, 'binary');
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, Buffer.from(data));
}

export async function indexPage(config: AxiomConfig, doc: SearchDoc): Promise<void> {
  const db = await getOrama(config);
  // Orama 3 supports removing by ID if we use the internal ID or if we find it.
  // We'll use a search to find the internal ID first.
  const results = await search(db, {
    where: { id: doc.id },
  });

  if (results.hits.length > 0) {
    for (const hit of results.hits) {
      await remove(db, hit.id);
    }
  }

  await insert(db, doc as any);
}

export async function clearIndex(config: AxiomConfig): Promise<void> {
  const indexPath = getIndexPath(config);
  if (fs.existsSync(indexPath)) {
    fs.unlinkSync(indexPath);
  }
  _orama = null;
}

export async function hybridSearch(config: AxiomConfig, query: string, limit = 10) {
  const db = await getOrama(config);
  const { embeddings } = config;
  
  if (!embeddings || embeddings.provider === 'none') {
    return search(db, {
      term: query,
      limit,
    });
  }

  try {
    const vector = await generateEmbedding(config, query);
    return search(db, {
      term: query,
      limit,
      mode: 'hybrid',
      vector: {
        value: vector,
        property: 'embedding',
      },
      similarity: 0.1, // Minimum similarity threshold
    });
  } catch (err) {
    console.error(`[orama] Semantic search failed: ${err}. Falling back to keyword.`);
    return search(db, {
      term: query,
      limit,
    });
  }
}

function getIndexPath(config: AxiomConfig): string {
  return path.join(config.wikiDir, 'wiki/search.index');
}
