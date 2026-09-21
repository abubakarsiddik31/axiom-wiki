import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { chunkMarkdownPage, slugifyHeading } from '../../src/core/indexing.js';
import { getKnownDimensions } from '../../src/core/embeddings.js';
import {
  saveSearchManifest,
  loadSearchManifest,
  checkEmbeddingConsistency,
  type SearchManifest,
} from '../../src/core/search/orama-store.js';
import { listPages, getWikiTreeOutline, writePage } from '../../src/core/wiki.js';
import { getBacklinks } from '../../src/core/graph.js';
import type { AxiomConfig } from '../../src/config/index.js';

describe('chunkMarkdownPage & section chunker', () => {
  it('keeps short pages (<2000 chars) as a single chunk', () => {
    const pagePath = 'wiki/pages/entities/alan-turing.md';
    const title = 'Alan Turing';
    const summary = 'British computer scientist';
    const tags = ['computing', 'math'];
    const category = 'entities';
    const content = 'Alan Turing was born in London. He was a mathematician.';

    const chunks = chunkMarkdownPage(pagePath, title, summary, tags, category, content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe(pagePath);
    expect(chunks[0].pagePath).toBe(pagePath);
    expect(chunks[0].sectionTitle).toBeUndefined();
    expect(chunks[0].sectionAnchor).toBeUndefined();
    expect(chunks[0].embeddingText).toContain('Alan Turing');
    expect(chunks[0].embeddingText).toContain('British computer scientist');
  });

  it('splits multi-section large documents by headings', () => {
    const pagePath = 'wiki/pages/concepts/cryptography.md';
    const title = 'Cryptography';
    const summary = 'The practice and study of secure communication';
    const tags = ['security', 'math'];
    const category = 'concepts';

    const longSection1 = 'History of cryptography details. '.repeat(50);
    const longSection2 = 'Public key cryptography algorithms. '.repeat(50);
    const content = `Introduction to cryptography.

## Historical Ciphers
${longSection1}

## Modern Cryptography
${longSection2}
`;

    const chunks = chunkMarkdownPage(pagePath, title, summary, tags, category, content);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const historical = chunks.find((c) => c.sectionAnchor === 'historical-ciphers');
    expect(historical).toBeDefined();
    expect(historical?.sectionTitle).toBe('Historical Ciphers');
    expect(historical?.pagePath).toBe(pagePath);
    expect(historical?.id).toBe(`${pagePath}#historical-ciphers`);
    expect(historical?.embeddingText).toContain('[Cryptography > Historical Ciphers]');

    const modern = chunks.find((c) => c.sectionAnchor === 'modern-cryptography');
    expect(modern).toBeDefined();
    expect(modern?.sectionTitle).toBe('Modern Cryptography');
    expect(modern?.pagePath).toBe(pagePath);
    expect(modern?.id).toBe(`${pagePath}#modern-cryptography`);
    expect(modern?.embeddingText).toContain('[Cryptography > Modern Cryptography]');
  });

  it('splits very long sections by paragraphs with part suffixes', () => {
    const pagePath = 'wiki/pages/sources/spec.md';
    const title = 'Large Specification';
    const summary = 'A massive document';
    const tags = ['spec'];
    const category = 'sources';

    // Create a section with 5 large paragraphs totaling > 4000 characters
    const p1 = 'Paragraph 1 discussing architecture in detail. '.repeat(30);
    const p2 = 'Paragraph 2 discussing data models and types. '.repeat(30);
    const p3 = 'Paragraph 3 discussing deployment strategy. '.repeat(30);
    const content = `## Comprehensive Architecture\n\n${p1}\n\n${p2}\n\n${p3}`;

    const chunks = chunkMarkdownPage(pagePath, title, summary, tags, category, content);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].sectionAnchor).toContain('comprehensive-architecture');
    expect(chunks[0].id).toContain('#comprehensive-architecture-1');
  });

  it('slugifyHeading sanitizes special characters and casing', () => {
    expect(slugifyHeading('Section 1: The Beginning!')).toBe('section-1-the-beginning');
    expect(slugifyHeading('What is RAG? (Retrieval-Augmented Generation)')).toBe(
      'what-is-rag-retrieval-augmented-generation'
    );
  });
});

describe('getKnownDimensions lookup', () => {
  it('correctly maps known models to dimensions', () => {
    expect(getKnownDimensions('text-embedding-004')).toBe(768);
    expect(getKnownDimensions('text-embedding-3-small')).toBe(1536);
    expect(getKnownDimensions('text-embedding-3-large')).toBe(3072);
    expect(getKnownDimensions('text-embedding-ada-002')).toBe(1536);
    expect(getKnownDimensions('nomic-embed-text')).toBe(768);
    expect(getKnownDimensions('all-minilm')).toBe(384);
    expect(getKnownDimensions('bge-large')).toBe(1024);
  });

  it('falls back based on provider when model is unknown', () => {
    expect(getKnownDimensions('custom-openai-model', 'openai')).toBe(1536);
    expect(getKnownDimensions('custom-google-model', 'google')).toBe(768);
    expect(getKnownDimensions('unknown-ollama-model', 'ollama')).toBeNull();
  });
});

describe('SearchManifest and checkEmbeddingConsistency', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-manifest-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads search manifest accurately', () => {
    const manifest: SearchManifest = {
      version: 1,
      provider: 'google',
      model: 'text-embedding-004',
      dimensions: 768,
      lastReindexAt: '2026-09-21T12:00:00.000Z',
      pageCount: 50,
      chunkCount: 120,
    };

    saveSearchManifest(tmpDir, manifest);
    const loaded = loadSearchManifest(tmpDir);
    expect(loaded).toEqual(manifest);
  });

  it('reports disabled when embeddings provider is none', () => {
    const config: AxiomConfig = {
      provider: 'google',
      apiKey: 'test-key',
      model: 'gemini-1.5-flash',
      wikiDir: tmpDir,
      rawDir: path.join(tmpDir, 'raw'),
      embeddings: { provider: 'none' },
    };
    const check = checkEmbeddingConsistency(config);
    expect(check.consistent).toBe(true);
    expect(check.reason).toBe('disabled');
  });

  it('reports missing_index when search.index does not exist', () => {
    const config: AxiomConfig = {
      provider: 'google',
      apiKey: 'test-key',
      model: 'gemini-1.5-flash',
      wikiDir: tmpDir,
      rawDir: path.join(tmpDir, 'raw'),
      embeddings: {
        provider: 'google',
        model: 'text-embedding-004',
        dimensions: 768,
      },
    };
    const check = checkEmbeddingConsistency(config);
    expect(check.consistent).toBe(false);
    expect(check.reason).toBe('missing_index');
  });

  it('auto-adopts legacy index when search.index exists but manifest is missing', () => {
    const indexPath = path.join(tmpDir, 'wiki/search.index');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, '{}', 'utf-8');

    const config: AxiomConfig = {
      provider: 'google',
      apiKey: 'test-key',
      model: 'gemini-1.5-flash',
      wikiDir: tmpDir,
      rawDir: path.join(tmpDir, 'raw'),
      embeddings: {
        provider: 'google',
        model: 'text-embedding-004',
        dimensions: 768,
      },
    };
    const check = checkEmbeddingConsistency(config);
    expect(check.consistent).toBe(true);
    expect(check.manifest?.migratedFromLegacy).toBe(true);

    const loaded = loadSearchManifest(tmpDir);
    expect(loaded?.model).toBe('text-embedding-004');
  });

  it('detects model and provider mismatches strictly', () => {
    const indexPath = path.join(tmpDir, 'wiki/search.index');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, '{}', 'utf-8');

    const initialManifest: SearchManifest = {
      version: 1,
      provider: 'google',
      model: 'text-embedding-004',
      dimensions: 768,
      lastReindexAt: new Date().toISOString(),
    };
    saveSearchManifest(tmpDir, initialManifest);

    // Switch config to OpenAI
    const openAiConfig: AxiomConfig = {
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o',
      wikiDir: tmpDir,
      rawDir: path.join(tmpDir, 'raw'),
      embeddings: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 1536,
      },
    };

    const check = checkEmbeddingConsistency(openAiConfig);
    expect(check.consistent).toBe(false);
    expect(check.reason).toBe('provider_mismatch');
    expect(check.message).toContain('Run "axiom-wiki embed --reindex"');
  });
});

describe('Structural Navigation: getWikiTreeOutline, tag filtering, and getBacklinks', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-structure-test-'));

    // Create a mini wiki structure
    await writePage(
      tmpDir,
      'wiki/pages/entities/alan-turing.md',
      `---
title: "Alan Turing"
summary: "Computer science pioneer"
tags: [cryptography, computing]
category: entities
---
Worked on [[concepts/cryptanalysis]] and [[entities/bletchley-park]].`
    );

    await writePage(
      tmpDir,
      'wiki/pages/entities/bletchley-park.md',
      `---
title: "Bletchley Park"
summary: "British codebreaking center"
tags: [cryptography, history]
category: entities
---
Station X. Associated with [[concepts/cryptanalysis]].`
    );

    await writePage(
      tmpDir,
      'wiki/pages/concepts/cryptanalysis.md',
      `---
title: "Cryptanalysis"
summary: "Deciphering codes"
tags: [cryptography, math]
category: concepts
---
The study of ciphers.`
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('filters pages by tag', async () => {
    const cryptoPages = await listPages(tmpDir, undefined, undefined, 'cryptography');
    expect(cryptoPages).toHaveLength(3);

    const historyPages = await listPages(tmpDir, undefined, undefined, 'history');
    expect(historyPages).toHaveLength(1);
    expect(historyPages[0].title).toBe('Bletchley Park');

    const missingTagPages = await listPages(tmpDir, undefined, undefined, 'nonexistent');
    expect(missingTagPages).toHaveLength(0);
  });

  it('generates compact wiki tree outline with category counts, top tags, and hubs', async () => {
    const outline = await getWikiTreeOutline(tmpDir);
    expect(outline.totalPages).toBe(3);
    expect(outline.categories.entities).toBe(2);
    expect(outline.categories.concepts).toBe(1);

    const topTagNames = outline.topTags.map((t) => t.tag);
    expect(topTagNames).toContain('cryptography');

    // Cryptanalysis is linked by both Alan Turing and Bletchley Park, so it should be a top hub
    const hubIds = outline.hubPages.map((h) => h.path);
    expect(hubIds.some((p) => p.includes('cryptanalysis'))).toBe(true);
  });

  it('resolves backlinks accurately ("what links here")', () => {
    const backlinks = getBacklinks(tmpDir, 'concepts/cryptanalysis');
    expect(backlinks.length).toBe(2);
    const linkTitles = backlinks.map((b) => b.fromTitle);
    expect(linkTitles).toContain('Alan Turing');
    expect(linkTitles).toContain('Bletchley Park');
  });
});
