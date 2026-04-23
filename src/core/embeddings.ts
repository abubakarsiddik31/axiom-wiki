import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
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
    const { embedding } = await embed({
      model: google.embedding(modelId),
      value: text,
      apiKey,
    });
    return embedding;
  }

  if (provider === 'openai') {
    const { embedding } = await embed({
      model: openai.embedding(modelId),
      value: text,
      apiKey,
    });
    return embedding;
  }

  if (provider === 'ollama') {
    const baseUrl = config.ollamaBaseUrl || 'http://localhost:11434/v1';
    // We use OpenAI compatible endpoint for Ollama embeddings if possible, 
    // or direct Ollama API. Mastra/AI SDK openai provider can handle Ollama if baseURL is set.
    const ollama = openai(modelId, {
      baseURL: baseUrl,
      apiKey: 'ollama', // dummy
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
    const { embeddings: result } = await embedMany({
      model: google.embedding(modelId),
      values: texts,
      apiKey,
    });
    return result;
  }

  if (provider === 'openai') {
    const { embeddings: result } = await embedMany({
      model: openai.embedding(modelId),
      values: texts,
      apiKey,
    });
    return result;
  }

  if (provider === 'ollama') {
    const baseUrl = config.ollamaBaseUrl || 'http://localhost:11434/v1';
    const ollama = openai(modelId, {
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
