import { create, insert, search, save, load, remove, type AnyOrama, type Results } from '@orama/orama';
import fs from 'fs';
import path from 'path';
import type { AxiomConfig } from '../../config/index.js';
import { generateEmbedding, getDefaultModel } from '../embeddings.js';

export interface SearchDoc {
  id: string;
  pagePath: string;
  title: string;
  sectionTitle?: string;
  sectionAnchor?: string;
  summary: string;
  content: string;
  tags: string[];
  category: string;
  embedding: number[];
}

export interface SearchManifest {
  version: 1;
  provider: 'google' | 'openai' | 'ollama' | 'none';
  model: string;
  dimensions: number;
  lastReindexAt: string;
  pageCount?: number;
  chunkCount?: number;
  migratedFromLegacy?: boolean;
}

export interface ConsistencyCheckResult {
  consistent: boolean;
  reason?: 'missing_index' | 'missing_manifest' | 'provider_mismatch' | 'model_mismatch' | 'dimension_mismatch' | 'disabled';
  message?: string;
  manifest?: SearchManifest | null;
}

let _orama: AnyOrama | null = null;

export function resetOramaInMemory(): void {
  _orama = null;
}

export function getManifestPath(wikiDir: string): string {
  return path.join(wikiDir, 'wiki/search.manifest.json');
}

export function loadSearchManifest(wikiDir: string): SearchManifest | null {
  const manifestPath = getManifestPath(wikiDir);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as SearchManifest;
    if (parsed.version === 1) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveSearchManifest(wikiDir: string, manifest: SearchManifest): void {
  const manifestPath = getManifestPath(wikiDir);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const tmp = manifestPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(tmp, manifestPath);
}

export function checkEmbeddingConsistency(config: AxiomConfig): ConsistencyCheckResult {
  const { embeddings, wikiDir } = config;
  if (!embeddings || embeddings.provider === 'none') {
    return { consistent: true, reason: 'disabled' };
  }

  const indexPath = getIndexPath(config);
  if (!fs.existsSync(indexPath)) {
    return {
      consistent: false,
      reason: 'missing_index',
      message: 'No search index found. Run "axiom-wiki embed --reindex" to initialize.',
    };
  }

  const manifest = loadSearchManifest(wikiDir);
  const currentProvider = embeddings.provider;
  const currentModel = embeddings.model || getDefaultModel(currentProvider);
  const currentDims = embeddings.dimensions || 768;

  // Legacy index upgrade: index exists but manifest was not created yet
  if (!manifest) {
    const backfilledManifest: SearchManifest = {
      version: 1,
      provider: currentProvider,
      model: currentModel,
      dimensions: currentDims,
      lastReindexAt: new Date().toISOString(),
      migratedFromLegacy: true,
    };
    saveSearchManifest(wikiDir, backfilledManifest);
    return { consistent: true, manifest: backfilledManifest };
  }

  if (manifest.provider !== currentProvider) {
    return {
      consistent: false,
      reason: 'provider_mismatch',
      message: `Search index was built with provider "${manifest.provider}", but current config uses "${currentProvider}". Run "axiom-wiki embed --reindex" to synchronize.`,
      manifest,
    };
  }

  const manifestModel = manifest.model || getDefaultModel(manifest.provider);
  if (manifestModel !== currentModel) {
    return {
      consistent: false,
      reason: 'model_mismatch',
      message: `Search index was built with model "${manifestModel}", but current config uses "${currentModel}". Run "axiom-wiki embed --reindex" to synchronize.`,
      manifest,
    };
  }

  if (manifest.dimensions !== currentDims) {
    return {
      consistent: false,
      reason: 'dimension_mismatch',
      message: `Search index was built with ${manifest.dimensions}-dim vectors, but current config expects ${currentDims}-dim vectors. Run "axiom-wiki embed --reindex" to synchronize.`,
      manifest,
    };
  }

  return { consistent: true, manifest };
}

export async function getOrama(config: AxiomConfig): Promise<AnyOrama> {
  if (_orama) return _orama;

  const dimensions = config.embeddings?.dimensions || 768;
  const schema = {
    id: 'string',
    pagePath: 'string',
    title: 'string',
    sectionTitle: 'string',
    sectionAnchor: 'string',
    summary: 'string',
    content: 'string',
    tags: 'string[]',
    category: 'string',
    embedding: `vector[${dimensions}]`,
  } as const;

  const indexPath = getIndexPath(config);
  if (fs.existsSync(indexPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      _orama = await create({ schema });
      load(_orama, data);
      return _orama!;
    } catch (err) {
      console.error(`[orama] Failed to load index: ${err}.`);
      throw err;
    }
  }

  _orama = await create({ schema });
  return _orama!;
}

export async function persistOrama(config: AxiomConfig): Promise<void> {
  if (!_orama) return;
  const indexPath = getIndexPath(config);
  const data = save(_orama);
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const tmp = indexPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
  fs.renameSync(tmp, indexPath);
}

export async function deletePageChunks(config: AxiomConfig, pageRelPath: string): Promise<void> {
  const db = await getOrama(config);
  // Broad search by pagePath or id to find candidate hits in Orama
  const results = await search(db, {
    where: { pagePath: pageRelPath },
    limit: 1000,
  });

  // Filter with strict JS check to avoid false-positive deletions
  const exactHits = results.hits.filter(
    (hit) =>
      hit.document['pagePath'] === pageRelPath ||
      hit.document['id'] === pageRelPath ||
      (typeof hit.document['id'] === 'string' && hit.document['id'].startsWith(pageRelPath + '#'))
  );

  for (const hit of exactHits) {
    await remove(db, hit.id);
  }
}

export async function indexPageChunks(
  config: AxiomConfig,
  pageRelPath: string,
  docs: SearchDoc[],
): Promise<void> {
  const db = await getOrama(config);
  await deletePageChunks(config, pageRelPath);
  for (const doc of docs) {
    // Cast required because Orama's TypedDocument uses dynamic template string for vector dimensions
    await insert(db, doc as any);
  }
}

export async function indexPage(config: AxiomConfig, doc: SearchDoc): Promise<void> {
  await indexPageChunks(config, doc.pagePath || doc.id, [doc]);
}

export async function clearIndex(config: AxiomConfig): Promise<void> {
  const indexPath = getIndexPath(config);
  if (fs.existsSync(indexPath)) {
    fs.unlinkSync(indexPath);
  }
  const manifestPath = getManifestPath(config.wikiDir);
  if (fs.existsSync(manifestPath)) {
    fs.unlinkSync(manifestPath);
  }
  _orama = null;
}

export async function hybridSearch(config: AxiomConfig, query: string, limit = 10): Promise<Results<any>> {
  const db = await getOrama(config);
  const { embeddings } = config;
  
  if (!embeddings || embeddings.provider === 'none') {
    return search(db, {
      term: query,
      limit,
    });
  }

  // Check consistency before vector search
  const consistency = checkEmbeddingConsistency(config);
  if (!consistency.consistent) {
    console.warn(`[orama] Warning: ${consistency.message}. Falling back to keyword search.`);
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
