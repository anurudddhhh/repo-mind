// Pinecone Vector Database Client
// Handles storing, querying, and deleting code embeddings with auto-retry resilience.
// Index config: 384 dimensions, cosine metric, serverless.

import { Pinecone, Index, RecordMetadata } from '@pinecone-database/pinecone';
import { logger } from './logger';

// --- Environment validation ---
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'repo-mind-index';

if (!PINECONE_API_KEY) {
  throw new Error('PINECONE_API_KEY is not set in .env');
}

let pineconeClient: Pinecone | null = null;
let pineconeIndex: Index | null = null;

function getPineconeClient(): Pinecone {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({ apiKey: PINECONE_API_KEY! });
    logger.info('📌 [Pinecone] Client initialized');
  }
  return pineconeClient;
}

function getPineconeIndex(): Index {
  if (!pineconeIndex) {
    pineconeIndex = getPineconeClient().index(PINECONE_INDEX_NAME);
    logger.info('📌 [Pinecone] Connected to index', { index: PINECONE_INDEX_NAME });
  }
  return pineconeIndex;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Types ---

export interface ChunkMetadata extends RecordMetadata {
  repositoryId: string;
  filePath: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  language: string;
  content: string;
}

export interface VectorRecord {
  id: string;
  values: number[];
  metadata: ChunkMetadata;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: ChunkMetadata;
}

// --- Core operations ---

/**
 * Store embedding vectors in Pinecone.
 * Uses a safe batch size of 30 vectors with automatic retry backoff to handle network drops.
 */
export async function upsertVectors(
  vectors: VectorRecord[],
  namespace?: string
): Promise<void> {
  const index = getPineconeIndex();
  const ns = index.namespace(namespace || '');
  const BATCH_SIZE = 30; // Reduced from 100 for network safety over home Wi-Fi

  logger.info('📌 [Pinecone] Upserting vectors in resilient batches', {
    count: vectors.length,
    batchSize: BATCH_SIZE,
    namespace: namespace || 'default',
  });

  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    const batch = vectors.slice(i, i + BATCH_SIZE);
    let attempts = 0;
    let success = false;

    while (attempts < 3 && !success) {
      try {
        attempts++;
        await ns.upsert({ records: batch });
        success = true;
      } catch (err: any) {
        logger.warn(`⚠️ [Pinecone] Batch ${i / BATCH_SIZE + 1} upsert attempt ${attempts} failed. Retrying...`, {
          error: err?.message || String(err),
        });
        if (attempts < 3) {
          await delay(1500 * attempts); // Pause 1.5s, 3.0s before retrying
        }
      }
    }

    if (!success) {
      logger.error(`❌ [Pinecone] Batch ${i / BATCH_SIZE + 1} failed after 3 attempts. Continuing pipeline...`);
    }
  }

  logger.info('✅ [Pinecone] Vector upsert batching complete', { count: vectors.length });
}

/**
 * Query Pinecone for the most similar vectors to the given embedding.
 */
export async function queryVectors(
  queryEmbedding: number[],
  topK: number = 5,
  filter?: Record<string, unknown>,
  namespace?: string
): Promise<VectorSearchResult[]> {
  const index = getPineconeIndex();
  const ns = index.namespace(namespace || '');

  let attempts = 0;
  while (attempts < 3) {
    try {
      attempts++;
      const result = await ns.query({
        vector: queryEmbedding,
        topK,
        filter,
        includeMetadata: true,
      });

      return (result.matches || []).map((match) => ({
        id: match.id,
        score: match.score || 0,
        metadata: match.metadata as ChunkMetadata,
      }));
    } catch (error: any) {
      if (attempts >= 3) {
        logger.error('❌ [Pinecone] Vector query failed after 3 attempts:', { error: error?.message });
        throw error;
      }
      await delay(1000);
    }
  }

  return [];
}

/**
 * Delete all vectors for a specific repository.
 */
export async function deleteVectorsByRepository(
  repositoryId: string,
  namespace?: string
): Promise<void> {
  const index = getPineconeIndex();
  const ns = index.namespace(namespace || '');

  logger.info('🗑️ [Pinecone] Deleting vectors for repo', { repositoryId });

  try {
    await ns.deleteMany({ filter: { repositoryId } });
    logger.info('✅ [Pinecone] Vectors deleted', { repositoryId });
  } catch (error: any) {
    if (error?.message?.includes('404')) {
      logger.info('⚠️ [Pinecone] Vectors delete skipped (404 Not Found)', { repositoryId });
    } else {
      logger.warn('⚠️ [Pinecone] Delete failed non-critically:', { error: error?.message });
    }
  }
}

/**
 * Test the Pinecone connection by describing the index stats.
 */
export async function testPineconeConnection(): Promise<boolean> {
  try {
    const index = getPineconeIndex();
    const stats = await index.describeIndexStats();
    logger.info('✅ [Pinecone] Connection OK', {
      totalVectors: stats.totalRecordCount,
      dimensions: stats.dimension,
    });
    return true;
  } catch (error) {
    logger.error('❌ [Pinecone] Connection failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}