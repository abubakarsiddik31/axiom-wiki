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
    const { embedding } = await embed({
      model: ollama.embedding(modelId),
      value: text,
    });
    return embedding;
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
    const { embeddings: result } = await embedMany({
      model: ollama.embedding(modelId),
      values: texts,
    });
    return result;
  }

  throw new Error(`Unsupported embedding provider: ${provider}`);
}

function getDefaultModel(provider: string): string {
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
