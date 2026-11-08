// =============================================================================
// HYBRID SEARCH SERVICE (VECTOR + KEYWORD + RRF MERGING)
// =============================================================================
// Combines three retrieval strategies for maximum recall and precision:
//   1. Semantic vector search via Pinecone (meaning-based)
//   2. Weighted keyword search via PostgreSQL (exact term matching)
//   3. Reciprocal Rank Fusion to merge both result lists by rank position
//
// Additional improvements over the original:
//   - Noise file filtering (excludes README, package.json, configs)
//   - Source file boosting (.ts/.tsx/.py score higher than .md/.json)
//   - Weighted field scoring (filePath match > name match > content match)
//   - Proper stop-word removal for cleaner keyword extraction
// =============================================================================

import { generateEmbedding } from '../lib/huggingface';
import { queryVectors } from '../lib/pinecone';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  score: number;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  content: string;
}

// ─── Configuration ───────────────────────────────────────────────────────────

// Files that pollute search results with generic keywords.
// These contain words like "auth", "search", "chat" in passing
// but never contain the actual implementation logic.
const NOISE_FILE_PATTERNS: RegExp[] = [
  /(^|\/)readme(\.mdx?|\.txt)?$/i,
  /(^|\/)package\.json$/i,
  /(^|\/)package-lock\.json$/i,
  /(^|\/)tsconfig.*\.json$/i,
  /(^|\/)\.env(\.\w+)?$/i,
  /(^|\/)render\.ya?ml$/i,
  /(^|\/)docker-compose.*\.ya?ml$/i,
  /(^|\/)\.gitignore$/i,
  /(^|\/)\.eslintrc.*$/i,
  /(^|\/)\.prettierrc.*$/i,
  /(^|\/)next\.config\.\w+$/i,
  /(^|\/)tailwind\.config\.\w+$/i,
  /(^|\/)postcss\.config\.\w+$/i,
  /(^|\/)jest\.config\.\w+$/i,
  /(^|\/)webpack\.config\.\w+$/i,
  /(^|\/)vite\.config\.\w+$/i,
  /(^|\/)env-loader\.\w+$/i,
  /(^|\/)globals\.css$/i,
  /(^|\/)\.github\//i,
];

// Source code extensions that should receive a relevance boost.
// These are the files developers actually want to find.
const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'rb', 'php', 'cs',
]);

// Comprehensive stop words to strip from queries before keyword search.
// These words appear in almost every code file and add zero signal.
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up', 'down',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he',
  'him', 'his', 'she', 'her', 'they', 'them', 'their', 'also', 'any',
  'get', 'got', 'make', 'like', 'use', 'using', 'work', 'works',
]);

// RRF constant — controls how much rank position matters.
// k=60 is the standard value from the original RRF paper.
const RRF_K = 60;

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Check if a file path matches any noise pattern.
 */
function isNoiseFile(filePath: string): boolean {
  return NOISE_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Check if a file is a source code file (deserves a relevance boost).
 */
function isSourceFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? SOURCE_EXTENSIONS.has(ext) : false;
}

/**
 * Extract meaningful keywords from a natural language query.
 * Removes stop words, short tokens, and deduplicates.
 */
function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')  // Keep underscores and hyphens (e.g., "rate_limit")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .filter((word, index, arr) => arr.indexOf(word) === index); // Deduplicate
}

/**
 * Score a single database chunk against the extracted keywords.
 * Uses weighted field matching:
 *   - filePath match: 3.0 points per keyword (strongest signal)
 *   - name match:     2.0 points per keyword
 *   - content match:  0.5 points per keyword (weakest, most noisy)
 *
 * Returns a score between 0 and 1 (normalized).
 */
function scoreChunkAgainstKeywords(
  chunk: { filePath: string; name: string; content: string },
  keywords: string[]
): number {
  if (keywords.length === 0) return 0;

  const filePathLower = chunk.filePath.toLowerCase();
  const nameLower = chunk.name.toLowerCase();
  const contentLower = chunk.content.toLowerCase();

  let rawScore = 0;

  for (const keyword of keywords) {
    if (filePathLower.includes(keyword)) rawScore += 3.0;
    if (nameLower.includes(keyword)) rawScore += 2.0;
    if (contentLower.includes(keyword)) rawScore += 0.5;
  }

  // Normalize: max possible score is keywords.length * (3.0 + 2.0 + 0.5) = 5.5 per keyword
  const maxPossible = keywords.length * 5.5;
  return Math.min(rawScore / maxPossible, 1.0);
}

/**
 * Reciprocal Rank Fusion (RRF).
 * Merges multiple ranked lists into a single ranked list.
 *
 * A document that appears at rank 1 in list A and rank 3 in list B gets:
 *   score = 1/(60+1) + 1/(60+3) = 0.0164 + 0.0159 = 0.0323
 *
 * A document that only appears at rank 1 in list A gets:
 *   score = 1/(60+1) = 0.0164
 *
 * So appearing in BOTH lists is always better than appearing in just one,
 * regardless of the original scoring scales (which may be incomparable).
 */
function reciprocalRankFusion(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  topK: number
): SearchResult[] {
  // Map from "filePath:startLine" to accumulated RRF score + best result data
  const rrfMap = new Map<string, { score: number; result: SearchResult }>();

  // Process vector results (rank 0, 1, 2, ...)
  vectorResults.forEach((result, rank) => {
    const key = `${result.filePath}:${result.startLine}`;
    const rrfScore = 1.0 / (RRF_K + rank + 1);
    const existing = rrfMap.get(key);

    if (existing) {
      existing.score += rrfScore;
    } else {
      rrfMap.set(key, { score: rrfScore, result: { ...result } });
    }
  });

  // Process keyword results (rank 0, 1, 2, ...)
  keywordResults.forEach((result, rank) => {
    const key = `${result.filePath}:${result.startLine}`;
    const rrfScore = 1.0 / (RRF_K + rank + 1);
    const existing = rrfMap.get(key);

    if (existing) {
      existing.score += rrfScore;
      // Keep the higher original score for display purposes
      if (result.score > existing.result.score) {
        existing.result.score = result.score;
      }
    } else {
      rrfMap.set(key, { score: rrfScore, result: { ...result } });
    }
  });

  // Sort by RRF score descending, apply source file boost, take top-K
  const merged = Array.from(rrfMap.values())
    .map(({ score, result }) => {
      const boost = isSourceFile(result.filePath) ? 1.2 : 1.0;
      return {
        ...result,
        score: score * boost,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return merged;
}

// ─── Main Search Function ────────────────────────────────────────────────────

/**
 * Perform a hybrid search against a specific repository.
 * Combines vector similarity, weighted keyword matching, and RRF merging.
 */
export async function searchRepository(
  repositoryId: string,
  query: string,
  topK: number = 5
): Promise<SearchResult[]> {
  logger.info('🔍 [Search] Starting hybrid search', { repositoryId, query: query.slice(0, 60), topK });

  let vectorResults: SearchResult[] = [];
  let keywordResults: SearchResult[] = [];

  // ── STRATEGY 1: Semantic Vector Search ──────────────────────────────────
  try {
    const queryEmbedding = await generateEmbedding(query);

    if (queryEmbedding && queryEmbedding.length > 0) {
      // Request more than topK from Pinecone so we have room after filtering
      const matches = await queryVectors(queryEmbedding, topK * 3, { repositoryId });

      vectorResults = matches
        .filter((match) => !isNoiseFile(match.metadata.filePath))
        .map((match) => ({
          score: match.score,
          filePath: match.metadata.filePath,
          startLine: match.metadata.startLine,
          endLine: match.metadata.endLine,
          language: match.metadata.language,
          content: match.metadata.content,
        }));

      logger.debug('🔍 [Search] Vector results', {
        rawCount: matches.length,
        filteredCount: vectorResults.length,
        topScore: vectorResults[0]?.score ?? 0,
      });
    }
  } catch (error) {
    logger.warn('⚠️ [Search] Vector search failed, relying on keyword search', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ── STRATEGY 2: Weighted Keyword Search ─────────────────────────────────
  try {
    const keywords = extractKeywords(query);

    if (keywords.length > 0) {
      // Build OR conditions for each keyword across filePath, name, and content
      const orConditions = keywords.flatMap((kw) => [
        { filePath: { contains: kw, mode: 'insensitive' as const } },
        { name: { contains: kw, mode: 'insensitive' as const } },
        { content: { contains: kw, mode: 'insensitive' as const } },
      ]);

      const dbChunks = await prisma.codeChunk.findMany({
        where: {
          repositoryId,
          OR: orConditions,
        },
        take: topK * 6, // Fetch extra for scoring and filtering
        orderBy: { startLine: 'asc' },
      });

      // Score, filter noise, boost source files, and sort
      keywordResults = dbChunks
        .filter((chunk) => !isNoiseFile(chunk.filePath))
        .map((chunk) => {
          const keywordScore = scoreChunkAgainstKeywords(chunk, keywords);
          const sourceBoost = isSourceFile(chunk.filePath) ? 1.2 : 1.0;
          return {
            score: keywordScore * sourceBoost,
            filePath: chunk.filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            language: chunk.language,
            content: chunk.content,
          };
        })
        .filter((result) => result.score > 0.05) // Drop near-zero matches
        .sort((a, b) => b.score - a.score)
        .slice(0, topK * 2);

      logger.debug('🔍 [Search] Keyword results', {
        keywords,
        rawCount: dbChunks.length,
        filteredCount: keywordResults.length,
        topScore: keywordResults[0]?.score ?? 0,
      });
    }
  } catch (error) {
    logger.warn('⚠️ [Search] Keyword search failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ── MERGE: Reciprocal Rank Fusion ───────────────────────────────────────
  // If we have results from both strategies, merge them with RRF.
  // If only one strategy produced results, use those directly.

  let finalResults: SearchResult[];

  if (vectorResults.length > 0 && keywordResults.length > 0) {
    finalResults = reciprocalRankFusion(vectorResults, keywordResults, topK);
    logger.info('✅ [Search] Hybrid RRF merge complete', {
      vectorCount: vectorResults.length,
      keywordCount: keywordResults.length,
      mergedCount: finalResults.length,
    });
  } else if (vectorResults.length > 0) {
    finalResults = vectorResults.slice(0, topK);
    logger.info('✅ [Search] Vector-only results', { count: finalResults.length });
  } else if (keywordResults.length > 0) {
    finalResults = keywordResults.slice(0, topK);
    logger.info('✅ [Search] Keyword-only results', { count: finalResults.length });
  } else {
    // ── SAFETY FALLBACK: Return any chunks from the repository ──────────
    logger.warn('⚠️ [Search] Both strategies returned empty, using safety fallback');
    try {
      const fallbackChunks = await prisma.codeChunk.findMany({
        where: { repositoryId },
        take: topK,
      });
      finalResults = fallbackChunks.map((c) => ({
        score: 0.1,
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        language: c.language,
        content: c.content,
      }));
    } catch {
      finalResults = [];
    }
  }

  logger.info('✅ [Search] Hybrid search complete', {
    resultsFound: finalResults.length,
    topScore: finalResults[0]?.score ?? 0,
    topFile: finalResults[0]?.filePath ?? 'none',
  });

  return finalResults;
}