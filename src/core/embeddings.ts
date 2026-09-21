import { google, createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { embed, embedMany } from 'ai';
import type { AxiomConfig } from '../config/index.js';

export interface EmbeddingResult {
  embedding: number[];
}

export interface EmbedManyResult {
  embeddings: number[][];
}

export async function generateEmbedding(config: AxiomConfig, text: string): Promise<number[]> {
  const { embeddings } = config;
  if (!embeddings || embeddings.provider === 'none') {
    throw new Error('Embeddings not configured');
  }

  const provider = embeddings.provider;
  const modelId = embeddings.model || getDefaultModel(provider);
  const apiKey = embeddings.apiKey || config.apiKey;

  if (provider === 'google') {
    const googleProvider = createGoogleGenerativeAI({ apiKey });
    const { embedding } = await embed({
      model: googleProvider.embedding(modelId),
      value: text,
    });
    return embedding;
  }

  if (provider === 'openai') {
    const openaiProvider = createOpenAI({ apiKey });
    const { embedding } = await embed({
      model: openaiProvider.embedding(modelId),
      value: text,
    });
    return embedding;
  }

  if (provider === 'ollama') {
    const baseUrl = config.ollamaBaseUrl || 'http://localhost:11434/v1';
    const ollama = createOpenAI({
      baseURL: baseUrl,
      apiKey: 'ollama',
    });
    try {
      const { embedding } = await embed({
        model: ollama.embedding(modelId),
        value: text,
      });
      return embedding;
    } catch (err: any) {
      if (err.message?.includes('404') || err.message?.includes('not found')) {
        throw new Error(`Ollama model "${modelId}" not found. Run "ollama pull ${modelId}" first.`);
      }
      if (err.message?.includes('ECONNREFUSED')) {
        throw new Error(`Could not connect to Ollama at ${baseUrl}. Is Ollama running?`);
      }
      throw err;
    }
  }

  throw new Error(`Unsupported embedding provider: ${provider}`);
}

export async function generateEmbeddings(config: AxiomConfig, texts: string[]): Promise<number[][]> {
  const { embeddings } = config;
  if (!embeddings || embeddings.provider === 'none') {
    throw new Error('Embeddings not configured');
  }

  const provider = embeddings.provider;
  const modelId = embeddings.model || getDefaultModel(provider);
  const apiKey = embeddings.apiKey || config.apiKey;

  if (provider === 'google') {
    const googleProvider = createGoogleGenerativeAI({ apiKey });
    const { embeddings: result } = await embedMany({
      model: googleProvider.embedding(modelId),
      values: texts,
    });
    return result;
  }

  if (provider === 'openai') {
    const openaiProvider = createOpenAI({ apiKey });
    const { embeddings: result } = await embedMany({
      model: openaiProvider.embedding(modelId),
      values: texts,
    });
    return result;
  }

  if (provider === 'ollama') {
    const baseUrl = config.ollamaBaseUrl || 'http://localhost:11434/v1';
    const ollama = createOpenAI({
      baseURL: baseUrl,
      apiKey: 'ollama',
    });
    try {
      const { embeddings: result } = await embedMany({
        model: ollama.embedding(modelId),
        values: texts,
      });
      return result;
    } catch (err: any) {
      if (err.message?.includes('404') || err.message?.includes('not found')) {
        throw new Error(`Ollama model "${modelId}" not found. Run "ollama pull ${modelId}" first.`);
      }
      if (err.message?.includes('ECONNREFUSED')) {
        throw new Error(`Could not connect to Ollama at ${baseUrl}. Is Ollama running?`);
      }
      throw err;
    }
  }

  throw new Error(`Unsupported embedding provider: ${provider}`);
}

export function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'google':
      return 'text-embedding-004';
    case 'openai':
      return 'text-embedding-3-small';
    case 'ollama':
      return 'nomic-embed-text';
    default:
      return '';
  }
}

export const KNOWN_DIMENSIONS: Record<string, number> = {
  // Google
  'text-embedding-004': 768,
  'gemini-embedding-001': 3072,
  'gemini-embedding-2': 3072,
  'gemini-embedding-2-preview': 3072,
  // OpenAI
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  // Ollama / open source standard
  'nomic-embed-text': 768,
  'all-minilm': 384,
  'all-minilm:l6-v2': 384,
  'bge-small-en': 384,
  'bge-base-en': 768,
  'bge-large-en': 1024,
  'bge-large': 1024,
  'mxbai-embed-large': 1024,
  'snowflake-arctic-embed': 1024,
  'snowflake-arctic-embed:m': 768,
  'snowflake-arctic-embed:s': 384,
};

export function getKnownDimensions(modelId: string, provider?: string): number | null {
  const norm = modelId.toLowerCase().trim();
  if (KNOWN_DIMENSIONS[norm]) return KNOWN_DIMENSIONS[norm];
  for (const [key, dim] of Object.entries(KNOWN_DIMENSIONS)) {
    if (norm.includes(key)) return dim;
  }
  if (provider === 'openai') return 1536;
  if (provider === 'google') return 768;
  return null;
}

export async function probeEmbeddingDimensions(config: AxiomConfig, timeoutMs = 3000): Promise<number> {
  const { embeddings } = config;
  if (!embeddings || embeddings.provider === 'none') {
    return 768;
  }

  const modelId = embeddings.model || getDefaultModel(embeddings.provider);
  const known = getKnownDimensions(modelId, embeddings.provider);

  try {
    const probePromise = generateEmbedding(config, 'probe');
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Embedding probe timed out')), timeoutMs)
    );
    const vector = await Promise.race([probePromise, timeoutPromise]);
    if (Array.isArray(vector) && vector.length > 0) {
      return vector.length;
    }
  } catch {
    if (known) return known;
    return 768;
  }

  return known || 768;
}
