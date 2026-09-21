import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { listPages } from './wiki.js';

export type ClaimGrade = 'data' | 'anecdote' | 'outcome' | 'assertion' | 'unspecified';

export interface CitationLocator {
  type: 'page' | 'timestamp' | 'line' | 'heading' | 'quote' | 'unknown';
  value: string;
  rawLocator: string;
}

export interface ParsedCitation {
  raw: string;
  sourceFile: string;
  locator?: CitationLocator;
  grade?: ClaimGrade;
  pagePath: string;
  paragraphIndex: number;
}

export type CitationVerificationStatus =
  | 'verified'
  | 'missing_source'
  | 'unverified_locator'
  | 'unlisted_in_frontmatter'
  | 'uncited_paragraph';

export interface CitationVerificationResult {
  citation: ParsedCitation;
  status: CitationVerificationStatus;
  message?: string;
  sourcePath?: string;
}

export interface CitationAuditReport {
  timestamp: string;
  totalPages: number;
  totalCitations: number;
  verifiedCount: number;
  missingSourceCount: number;
  unverifiedLocatorCount: number;
  unlistedFrontmatterCount: number;
  uncitedParagraphCount: number;
  passed: boolean;
  results: CitationVerificationResult[];
  gradeSummary: Record<ClaimGrade, number>;
  unreferencedSources: string[];
}

export interface VerifyCitationsOptions {
  strict?: boolean; // if true, uncited factual paragraphs and unlisted frontmatter also count as failures
  requireLocators?: boolean; // if true, citations without locators are flagged
}

/**
 * Parses locators like:
 *   #p. 14, #page 14, #14
 *   #12:45, #01:23:45
 *   #L42
 *   #"exact quote"
 *   #heading-slug
 */
export function parseLocator(rawLocator: string): CitationLocator {
  const clean = rawLocator.trim().replace(/^#/, '');

  // 1. Timestamp: 12:45 or 01:23:45
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(clean)) {
    return { type: 'timestamp', value: clean, rawLocator };
  }

  // 2. Page: p. 14, p14, page 14, page=14
  const pageMatch = clean.match(/^(?:p\.?|page\s*=?)\s*(\d+)$/i);
  if (pageMatch) {
    return { type: 'page', value: pageMatch[1], rawLocator };
  }

  // 3. Line number: L42, line 42
  const lineMatch = clean.match(/^(?:L|line\s*)(\d+)$/i);
  if (lineMatch) {
    return { type: 'line', value: lineMatch[1], rawLocator };
  }

  // 4. Quote: "exact text" or 'exact text'
  const quoteMatch = clean.match(/^["'](.*)["']$/);
  if (quoteMatch) {
    return { type: 'quote', value: quoteMatch[1], rawLocator };
  }

  // 5. Heading or section slug
  if (/^[a-z0-9-]+$/i.test(clean)) {
    return { type: 'heading', value: clean, rawLocator };
  }

  return { type: 'unknown', value: clean, rawLocator };
}

/**
 * Parses an inline footnote citation string like:
 *   ^[paper.pdf#p. 14]
 *   ^[interview.md#12:45 | grade: data]
 *   ^[article.md#"quote" | grade: anecdote]
 */
export function parseInlineCitation(rawInside: string, pagePath: string, paragraphIndex: number): ParsedCitation {
  const raw = `^[${rawInside}]`;
  let text = rawInside.trim();

  // Extract optional claim grade: | grade: data
  let grade: ClaimGrade = 'unspecified';
  const gradeMatch = text.match(/\|\s*grade:\s*([a-z]+(?:\s*\([^)]*\))?)/i);
  if (gradeMatch) {
    const rawGrade = gradeMatch[1].toLowerCase();
    if (rawGrade.startsWith('data')) grade = 'data';
    else if (rawGrade.startsWith('anecdote')) grade = 'anecdote';
    else if (rawGrade.startsWith('outcome')) grade = 'outcome';
    else if (rawGrade.startsWith('assertion')) grade = 'assertion';
    text = text.replace(gradeMatch[0], '').trim();
  }

  // Split filename and locator
  let sourceFile = text;
  let locator: CitationLocator | undefined;

  const hashIdx = text.indexOf('#');
  const colonIdx = text.indexOf(':');

  if (hashIdx !== -1) {
    sourceFile = text.slice(0, hashIdx).trim();
    const locPart = text.slice(hashIdx);
    locator = parseLocator(locPart);
  } else if (colonIdx !== -1 && !text.startsWith('http')) {
    sourceFile = text.slice(0, colonIdx).trim();
    const locPart = text.slice(colonIdx + 1);
    locator = parseLocator(locPart);
  }

  return {
    raw,
    sourceFile,
    locator,
    grade,
    pagePath,
    paragraphIndex,
  };
}

/**
 * Extracts all inline citations from a markdown page body.
 */
export function extractCitationsFromMarkdown(content: string, pagePath: string): ParsedCitation[] {
  const citations: ParsedCitation[] = [];
  const paragraphs = content.split(/\n\s*\n/);

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const p = paragraphs[pIdx];
    const regex = /\^\[([^\]]+)\]/g;
    let match;
    while ((match = regex.exec(p)) !== null) {
      citations.push(parseInlineCitation(match[1], pagePath, pIdx));
    }
  }

  return citations;
}

/**
 * Verifies if a locator exists in a raw source file's text content.
 */
export function verifyLocatorInContent(locator: CitationLocator, content: string): boolean {
  const lower = content.toLowerCase();

  switch (locator.type) {
    case 'timestamp': {
      // Matches **mm:ss**, [mm:ss], or raw mm:ss
      const ts = locator.value;
      const tsRegex = new RegExp(`(?:\\*\\*|\\[|\\b)${escapeRegex(ts)}(?:\\*\\*|\\]|\\b)`);
      return tsRegex.test(content);
    }
    case 'page': {
      // Matches **p. 14**, [p. 14], Page 14, etc.
      const p = locator.value;
      const pageRegex = new RegExp(`(?:\\*\\*p\\.?\\s*${p}\\*\\*|\\[p\\.?\\s*${p}\\]|page\\s*${p}\\b|\\bp\\.?\\s*${p}\\b)`, 'i');
      return pageRegex.test(content);
    }
    case 'line': {
      const lineNum = parseInt(locator.value, 10);
      if (isNaN(lineNum)) return false;
      const totalLines = content.split('\n').length;
      return lineNum >= 1 && lineNum <= totalLines;
    }
    case 'quote': {
      const targetQuote = locator.value.toLowerCase().trim();
      return lower.includes(targetQuote);
    }
    case 'heading': {
      const slug = locator.value.toLowerCase().replace(/-/g, '[-\\s]');
      const headingRegex = new RegExp(`#{1,6}\\s+.*${slug}`, 'i');
      return headingRegex.test(content) || lower.includes(locator.value.toLowerCase());
    }
    case 'unknown':
    default: {
      return lower.includes(locator.value.toLowerCase());
    }
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Performs a deterministic forensic citation audit across all pages in the wiki.
 */
export async function verifyCitations(
  wikiDir: string,
  options?: VerifyCitationsOptions,
): Promise<CitationAuditReport> {
  const pages = await listPages(wikiDir);
  const rawDir = path.join(wikiDir, 'raw');
  const sourcePagesDir = path.join(wikiDir, 'wiki/pages/sources');

  const rawFiles = fs.existsSync(rawDir)
    ? fs.readdirSync(rawDir).filter((f) => !f.startsWith('.'))
    : [];

  const referencedSources = new Set<string>();
  const results: CitationVerificationResult[] = [];

  const gradeSummary: Record<ClaimGrade, number> = {
    data: 0,
    anecdote: 0,
    outcome: 0,
    assertion: 0,
    unspecified: 0,
  };

  let totalCitations = 0;
  let verifiedCount = 0;
  let missingSourceCount = 0;
  let unverifiedLocatorCount = 0;
  let unlistedFrontmatterCount = 0;
  let uncitedParagraphCount = 0;

  // Cache source file contents to avoid redundant reads
  const sourceContentCache = new Map<string, string | null>();

  function getSourceContent(filename: string): { content: string; fullPath: string } | null {
    if (sourceContentCache.has(filename)) {
      const cached = sourceContentCache.get(filename);
      if (!cached) return null;
      return { content: cached, fullPath: path.join(rawDir, filename) };
    }

    // Check raw/ directory first
    const rawPath = path.join(rawDir, filename);
    if (fs.existsSync(rawPath)) {
      try {
        const text = fs.readFileSync(rawPath, 'utf-8');
        sourceContentCache.set(filename, text);
        return { content: text, fullPath: rawPath };
      } catch {
        // Binary file (e.g. PDF/DOCX) - check if wiki/pages/sources summary page exists
      }
    }

    // Check wiki/pages/sources/ summary page as a proxy
    const sourceSlug = filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const possibleSummaryPaths = [
      path.join(sourcePagesDir, `${sourceSlug}.md`),
      path.join(sourcePagesDir, `${filename}.md`),
    ];

    for (const sp of possibleSummaryPaths) {
      if (fs.existsSync(sp)) {
        try {
          const text = fs.readFileSync(sp, 'utf-8');
          sourceContentCache.set(filename, text);
          return { content: text, fullPath: sp };
        } catch { /* skip */ }
      }
    }

    sourceContentCache.set(filename, null);
    return null;
  }

  for (const page of pages) {
    const absPath = path.join(wikiDir, page.path);
    if (!fs.existsSync(absPath)) continue;

    const rawMarkdown = fs.readFileSync(absPath, 'utf-8');
    const { data, content } = matter(rawMarkdown);
    const declaredSources = new Set(
      Array.isArray(data['sources']) ? (data['sources'] as string[]).map(String) : []
    );

    for (const s of declaredSources) {
      referencedSources.add(s);
    }

    const citations = extractCitationsFromMarkdown(content, page.path);
    const paragraphs = content.split(/\n\s*\n/).filter((p) => {
      const clean = p.trim();
      // Filter out headings, frontmatter blocks, blockquotes, horizontal rules
      return clean.length > 0 && !clean.startsWith('#') && !clean.startsWith('---') && !clean.startsWith('>');
    });

    // Check for uncited paragraphs in forensic mode
    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const p = paragraphs[pIdx];
      if (!p.includes('^[')) {
        uncitedParagraphCount++;
        if (options?.strict) {
          results.push({
            citation: {
              raw: '',
              sourceFile: '',
              pagePath: page.path,
              paragraphIndex: pIdx,
            },
            status: 'uncited_paragraph',
            message: `Paragraph ${pIdx + 1} has no source citation in forensic mode: "${p.slice(0, 60)}..."`,
          });
        }
      }
    }

    for (const citation of citations) {
      totalCitations++;
      referencedSources.add(citation.sourceFile);

      if (citation.grade) {
        gradeSummary[citation.grade] = (gradeSummary[citation.grade] ?? 0) + 1;
      }

      // Check 1: Is source listed in frontmatter?
      if (!declaredSources.has(citation.sourceFile)) {
        unlistedFrontmatterCount++;
        if (options?.strict) {
          results.push({
            citation,
            status: 'unlisted_in_frontmatter',
            message: `Source "${citation.sourceFile}" is cited in body but missing from frontmatter sources: [...]`,
          });
        }
      }

      // Check 2: Does source file exist?
      const source = getSourceContent(citation.sourceFile);
      if (!source) {
        missingSourceCount++;
        results.push({
          citation,
          status: 'missing_source',
          message: `Cited source file "${citation.sourceFile}" was not found in raw/ or wiki/pages/sources/`,
        });
        continue;
      }

      // Check 3: Locator verification
      if (citation.locator) {
        const locatorValid = verifyLocatorInContent(citation.locator, source.content);
        if (!locatorValid) {
          unverifiedLocatorCount++;
          results.push({
            citation,
            status: 'unverified_locator',
            sourcePath: source.fullPath,
            message: `Locator "${citation.locator.rawLocator}" (${citation.locator.type}) not found in source file "${citation.sourceFile}"`,
          });
          continue;
        }
      } else if (options?.requireLocators) {
        unverifiedLocatorCount++;
        results.push({
          citation,
          status: 'unverified_locator',
          message: `Citation "${citation.raw}" lacks an exact locator (#p. N, #mm:ss, or #"quote") required by forensic mode`,
        });
        continue;
      }

      // Passed verification
      verifiedCount++;
      results.push({
        citation,
        status: 'verified',
        sourcePath: source.fullPath,
        message: `Verified against ${citation.sourceFile}${citation.locator ? ' (' + citation.locator.rawLocator + ')' : ''}`,
      });
    }
  }

  // Find unreferenced raw files
  const unreferencedSources = rawFiles.filter((f) => !referencedSources.has(f));

  const passed = options?.strict
    ? missingSourceCount === 0 && unverifiedLocatorCount === 0 && unlistedFrontmatterCount === 0 && uncitedParagraphCount === 0
    : missingSourceCount === 0 && unverifiedLocatorCount === 0;

  return {
    timestamp: new Date().toISOString(),
    totalPages: pages.length,
    totalCitations,
    verifiedCount,
    missingSourceCount,
    unverifiedLocatorCount,
    unlistedFrontmatterCount,
    uncitedParagraphCount,
    passed,
    results,
    gradeSummary,
    unreferencedSources,
  };
}

/**
 * Formats a clean ASCII table report of the forensic citation audit.
 */
export function formatCitationAuditReport(report: CitationAuditReport): string {
  const divider = '─'.repeat(60);
  const lines: string[] = [
    '◈ Axiom Wiki — Forensic Citation Audit',
    divider,
    `Total Pages Audited:    ${report.totalPages}`,
    `Total Citations:        ${report.totalCitations}`,
    `✓ Verified Citations:   ${report.verifiedCount} (${report.totalCitations > 0 ? Math.round((report.verifiedCount / report.totalCitations) * 100) : 100}%)`,
    `✗ Missing Sources:      ${report.missingSourceCount}`,
    `✗ Unverified Locators:  ${report.unverifiedLocatorCount}`,
    `! Unlisted Frontmatter: ${report.unlistedFrontmatterCount}`,
    `! Uncited Paragraphs:   ${report.uncitedParagraphCount}`,
    divider,
    'Claim Grades:',
    `  • data:       ${report.gradeSummary.data}`,
    `  • anecdote:   ${report.gradeSummary.anecdote}`,
    `  • outcome:    ${report.gradeSummary.outcome}`,
    `  • assertion:  ${report.gradeSummary.assertion}`,
    `  • unspecified:${report.gradeSummary.unspecified}`,
    divider,
  ];

  if (report.unreferencedSources.length > 0) {
    lines.push(`Unreferenced Sources in raw/ (${report.unreferencedSources.length}):`);
    for (const s of report.unreferencedSources.slice(0, 5)) {
      lines.push(`  - ${s}`);
    }
    if (report.unreferencedSources.length > 5) {
      lines.push(`  ... (${report.unreferencedSources.length - 5} more)`);
    }
    lines.push(divider);
  }

  const failures = report.results.filter((r) => r.status !== 'verified');
  if (failures.length > 0) {
    lines.push('Citation Issues:');
    for (const f of failures.slice(0, 10)) {
      const loc = f.citation.pagePath ? `${f.citation.pagePath} (p.${f.citation.paragraphIndex + 1})` : 'global';
      lines.push(`  [${f.status.toUpperCase()}] ${loc}: ${f.message}`);
    }
    if (failures.length > 10) {
      lines.push(`  ... and ${failures.length - 10} more issues`);
    }
    lines.push(divider);
    lines.push('Audit Status: ✗ FAILED (Unverified or missing citations detected)');
  } else {
    lines.push('Audit Status: ✓ PASSED (Zero hallucinated citations)');
  }

  return lines.join('\n');
}
