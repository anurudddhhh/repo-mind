// Search Service
// Handles semantic code search.
// Converts a user query into an embedding, searches Pinecone,
// and returns the most relevant code chunks.

import { generateEmbedding } from '../lib/huggingface';
import { queryVectors } from '../lib/pinecone';
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
 * Perform a semantic search against a specific repository.
 */
export async function searchRepository(
  repositoryId: string,
  query: string,
  topK: number = 5
): Promise<SearchResult[]> {
  logger.info('🔍 [Search] Starting semantic search', { repositoryId, topK });

  try {
    // 1. Convert the user's text query into a 384-dimensional vector
    const queryEmbedding = await generateEmbedding(query);

    // 2. Query Pinecone for the closest matches in this repository
    const matches = await queryVectors(queryEmbedding, topK, { repositoryId });

    // 3. Map the Pinecone matches to our clean SearchResult interface.
    // Because we store the chunk content directly in Pinecone metadata,
    // we don't need to do a secondary lookup in PostgreSQL.
    const results = matches.map((match) => ({
      score: match.score,
      filePath: match.metadata.filePath,
      startLine: match.metadata.startLine,
      endLine: match.metadata.endLine,
      language: match.metadata.language,
      content: match.metadata.content,
    }));

    logger.info('✅ [Search] Search complete', {
      resultsFound: results.length,
      topScore: results[0]?.score || 0,
    });

    return results;
  } catch (error) {
    logger.error('❌ [Search] Failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
