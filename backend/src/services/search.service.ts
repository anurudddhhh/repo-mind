// Search Service
// Handles HYBRID semantic code search (Vector + PostgreSQL Keyword Fallback).
// Converts user query into an embedding, searches Pinecone, and falls back to
// direct PostgreSQL symbol match if vector similarity is low.

import { generateEmbedding } from '../lib/huggingface';
import { queryVectors } from '../lib/pinecone';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface SearchResult {
  score: number;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  content: string;
}

/**
 * Perform a hybrid search against a specific repository.
 */
export async function searchRepository(
  repositoryId: string,
  query: string,
  topK: number = 5
): Promise<SearchResult[]> {
  logger.info('🔍 [Search] Starting hybrid search', { repositoryId, topK });

  try {
    // 1. Convert user query into 384-dim vector
    const queryEmbedding = await generateEmbedding(query);

    // 2. Query Pinecone for vector matches
    const matches = await queryVectors(queryEmbedding, topK, { repositoryId });

    let results: SearchResult[] = matches.map((match) => ({
      score: match.score,
      filePath: match.metadata.filePath,
      startLine: match.metadata.startLine,
      endLine: match.metadata.endLine,
      language: match.metadata.language,
      content: match.metadata.content,
    }));

    // 3. HYBRID FALLBACK: If top match score is low (< 0.5) or 0 matches, search PostgreSQL directly
    const topScore = results[0]?.score || 0;
    if (results.length < 3 || topScore < 0.5) {
      logger.info('💡 [Search] Low vector score detected. Running PostgreSQL keyword fallback...', { topScore });

      // Extract key search terms (e.g. "chunking", "logic", "auth")
      const keywords = query
        .toLowerCase()
        .replace(/[^a-z0-9\s_]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !['where', 'what', 'how', 'does', 'this', 'code', 'file'].includes(w));

      if (keywords.length > 0) {
        const dbChunks = await prisma.codeChunk.findMany({
          where: {
            repositoryId,
            OR: keywords.flatMap((kw) => [
              { filePath: { contains: kw, mode: 'insensitive' } },
              { name: { contains: kw, mode: 'insensitive' } },
              { content: { contains: kw, mode: 'insensitive' } },
            ]),
          },
          take: topK,
          orderBy: { startLine: 'asc' },
        });

        const keywordResults: SearchResult[] = dbChunks.map((c) => ({
          score: 0.85, // Assigned strong synthetic relevance score for direct keyword match
          filePath: c.filePath,
          startLine: c.startLine,
          endLine: c.endLine,
          language: c.language,
          content: c.content,
        }));

        // Merge & deduplicate by file + line range
        const existingPaths = new Set(results.map((r) => `${r.filePath}:${r.startLine}`));
        for (const kr of keywordResults) {
          if (!existingPaths.has(`${kr.filePath}:${kr.startLine}`)) {
            results.push(kr);
          }
        }
      }
    }

    logger.info('✅ [Search] Hybrid search complete', {
      resultsFound: results.length,
      topScore: results[0]?.score || 0,
    });

    return results.slice(0, topK);
  } catch (error) {
    logger.error('❌ [Search] Failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    
    // Safety Fallback to direct DB query if Pinecone throws an exception
    try {
      const dbChunks = await prisma.codeChunk.findMany({
        where: { repositoryId },
        take: topK,
      });

      return dbChunks.map((c) => ({
        score: 0.5,
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        language: c.language,
        content: c.content,
      }));
    } catch {
      return [];
    }
  }
}