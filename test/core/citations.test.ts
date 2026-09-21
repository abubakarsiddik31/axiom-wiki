import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  parseLocator,
  parseInlineCitation,
  extractCitationsFromMarkdown,
  verifyLocatorInContent,
  verifyCitations,
  formatCitationAuditReport,
} from '../../src/core/citations.js';
import { writePage } from '../../src/core/wiki.js';

describe('Citation Locator Parser', () => {
  it('parses timestamps accurately', () => {
    const loc1 = parseLocator('#12:45');
    expect(loc1.type).toBe('timestamp');
    expect(loc1.value).toBe('12:45');

    const loc2 = parseLocator('01:23:45');
    expect(loc2.type).toBe('timestamp');
    expect(loc2.value).toBe('01:23:45');
  });

  it('parses page numbers in various formats', () => {
    expect(parseLocator('#p. 14')).toEqual({ type: 'page', value: '14', rawLocator: '#p. 14' });
    expect(parseLocator('p14')).toEqual({ type: 'page', value: '14', rawLocator: 'p14' });
    expect(parseLocator('page 42')).toEqual({ type: 'page', value: '42', rawLocator: 'page 42' });
    expect(parseLocator('page=99')).toEqual({ type: 'page', value: '99', rawLocator: 'page=99' });
  });

  it('parses line numbers', () => {
    expect(parseLocator('#L42')).toEqual({ type: 'line', value: '42', rawLocator: '#L42' });
    expect(parseLocator('line 100')).toEqual({ type: 'line', value: '100', rawLocator: 'line 100' });
  });

  it('parses quoted text locators', () => {
    const loc = parseLocator('#"founder sales"');
    expect(loc.type).toBe('quote');
    expect(loc.value).toBe('founder sales');
  });

  it('parses section headings / slugs', () => {
    const loc = parseLocator('#architecture-overview');
    expect(loc.type).toBe('heading');
    expect(loc.value).toBe('architecture-overview');
  });
});

describe('Inline Citation Parser', () => {
  it('parses simple citation without locator', () => {
    const c = parseInlineCitation('paper.pdf', 'wiki/pages/concepts/crypto.md', 0);
    expect(c.sourceFile).toBe('paper.pdf');
    expect(c.locator).toBeUndefined();
    expect(c.grade).toBe('unspecified');
  });

  it('parses citation with locator and claim grade', () => {
    const c = parseInlineCitation('interview.md#12:45 | grade: data', 'wiki/pages/entities/founder.md', 1);
    expect(c.sourceFile).toBe('interview.md');
    expect(c.locator?.type).toBe('timestamp');
    expect(c.locator?.value).toBe('12:45');
    expect(c.grade).toBe('data');
  });

  it('parses anecdote with n count grade', () => {
    const c = parseInlineCitation('article.md#p. 8 | grade: anecdote (n=3)', 'wiki/pages/concepts/pmf.md', 2);
    expect(c.sourceFile).toBe('article.md');
    expect(c.locator?.type).toBe('page');
    expect(c.locator?.value).toBe('8');
    expect(c.grade).toBe('anecdote');
  });

  it('extracts multiple citations from markdown paragraphs', () => {
    const md = `This is the first claim.^[source-a.pdf#p. 10]

This is a second claim with two citations.^[source-b.md#14:20] ^[source-c.md#"revenue doubled" | grade: data]`;

    const citations = extractCitationsFromMarkdown(md, 'wiki/pages/analyses/review.md');
    expect(citations).toHaveLength(3);
    expect(citations[0].sourceFile).toBe('source-a.pdf');
    expect(citations[1].sourceFile).toBe('source-b.md');
    expect(citations[2].grade).toBe('data');
  });
});

describe('Locator Content Verification (verifyLocatorInContent)', () => {
  const sampleTranscript = `
# Interview with Alex

**02:15** · Welcome to the show. Today we discuss founder-led sales.
**12:45** · When we reached 100 enterprise customers, revenue doubled.
Page 14 of the deck shows our retention curve.

## Architecture
We use a microservices approach.
`;

  it('verifies existing timestamps and rejects missing ones', () => {
    expect(verifyLocatorInContent({ type: 'timestamp', value: '12:45', rawLocator: '#12:45' }, sampleTranscript)).toBe(true);
    expect(verifyLocatorInContent({ type: 'timestamp', value: '02:15', rawLocator: '#02:15' }, sampleTranscript)).toBe(true);
    expect(verifyLocatorInContent({ type: 'timestamp', value: '55:30', rawLocator: '#55:30' }, sampleTranscript)).toBe(false);
  });

  it('verifies existing page numbers and rejects missing ones', () => {
    expect(verifyLocatorInContent({ type: 'page', value: '14', rawLocator: '#p. 14' }, sampleTranscript)).toBe(true);
    expect(verifyLocatorInContent({ type: 'page', value: '99', rawLocator: '#p. 99' }, sampleTranscript)).toBe(false);
  });

  it('verifies exact quotes and rejects hallucinated quotes', () => {
    expect(verifyLocatorInContent({ type: 'quote', value: 'revenue doubled', rawLocator: '#"revenue doubled"' }, sampleTranscript)).toBe(true);
    expect(verifyLocatorInContent({ type: 'quote', value: 'we raised 50 million dollars', rawLocator: '#"we raised 50 million dollars"' }, sampleTranscript)).toBe(false);
  });

  it('verifies heading slugs', () => {
    expect(verifyLocatorInContent({ type: 'heading', value: 'architecture', rawLocator: '#architecture' }, sampleTranscript)).toBe(true);
    expect(verifyLocatorInContent({ type: 'heading', value: 'pricing-model', rawLocator: '#pricing-model' }, sampleTranscript)).toBe(false);
  });
});

describe('Full Wiki Forensic Citation Audit (verifyCitations)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-citation-test-'));
    fs.mkdirSync(path.join(tmpDir, 'raw'), { recursive: true });

    // Write real source in raw/
    fs.writeFileSync(
      path.join(tmpDir, 'raw/interview.md'),
      `# Founder Interview\n\n**12:45** · Enterprise churn dropped to 2% after we launched custom SLAs.`
    );

    fs.writeFileSync(
      path.join(tmpDir, 'raw/paper.pdf.txt'),
      `Research Paper\n\n**p. 14** · Neural networks demonstrate high sample efficiency in discrete domains.`
    );
    // Write summary page for paper.pdf
    await writePage(
      tmpDir,
      'wiki/pages/sources/paper-pdf.md',
      `---
title: "Paper Summary"
summary: "Research paper"
category: sources
sources: ["paper.pdf"]
---
**p. 14** · Neural networks demonstrate high sample efficiency.`
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when citations and locators are 100% verified', async () => {
    await writePage(
      tmpDir,
      'wiki/pages/concepts/churn.md',
      `---
title: "Enterprise Churn"
summary: "Study of churn"
category: concepts
sources: ["interview.md"]
---
Enterprise churn dropped significantly after introducing SLAs.^[interview.md#12:45 | grade: data]`
    );

    const report = await verifyCitations(tmpDir);
    expect(report.passed).toBe(true);
    expect(report.verifiedCount).toBe(1);
    expect(report.missingSourceCount).toBe(0);
    expect(report.unverifiedLocatorCount).toBe(0);
    expect(report.gradeSummary.data).toBe(1);
  });

  it('catches hallucinated / missing source files', async () => {
    await writePage(
      tmpDir,
      'wiki/pages/concepts/fake.md',
      `---
title: "Fake Concept"
summary: "Testing missing source"
category: concepts
sources: ["ghost-article.pdf"]
---
This claim cites a non-existent document.^[ghost-article.pdf#p. 5]`
    );

    const report = await verifyCitations(tmpDir);
    expect(report.passed).toBe(false);
    expect(report.missingSourceCount).toBe(1);
    expect(report.results[0].status).toBe('missing_source');
  });

  it('catches hallucinated timestamps or locators in real sources', async () => {
    await writePage(
      tmpDir,
      'wiki/pages/concepts/hallucinated-time.md',
      `---
title: "Phantom Locator"
summary: "Real source but fake timestamp"
category: concepts
sources: ["interview.md"]
---
This claim cites a timestamp that does not exist in the transcript.^[interview.md#59:45]`
    );

    const report = await verifyCitations(tmpDir);
    expect(report.passed).toBe(false);
    expect(report.unverifiedLocatorCount).toBe(1);
    expect(report.results[0].status).toBe('unverified_locator');
    expect(report.results[0].message).toContain('59:45');
  });

  it('formats clean audit report string', async () => {
    await writePage(
      tmpDir,
      'wiki/pages/concepts/test.md',
      `---
title: "Test Page"
summary: "Testing audit formatting"
category: concepts
sources: ["interview.md"]
---
Verified claim here.^[interview.md#12:45 | grade: data]`
    );

    const report = await verifyCitations(tmpDir);
    const formatted = formatCitationAuditReport(report);
    expect(formatted).toContain('◈ Axiom Wiki — Forensic Citation Audit');
    expect(formatted).toContain('Verified Citations:   1 (100%)');
    expect(formatted).toContain('Audit Status: ✓ PASSED');
  });
});
