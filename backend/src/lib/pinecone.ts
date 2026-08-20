// Pinecone Vector Database Client
// Handles storing, querying, and deleting code embeddings.
// Index config: 384 dimensions, cosine metric, serverless.

import { Pinecone, Index, RecordMetadata } from '@pinecone-database/pinecone';
import { logger } from '@/lib/logger';

// --- Environment validation ---
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'repo-mind-index';

if (!PINECONE_API_KEY) {
  throw new Error('PINECONE_API_KEY is not set in .env');
}

// --- Singleton client ---
// Pinecone SDK handles connection pooling internally.
// We create one client and reuse it across the app.
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

// --- Types ---

/** Metadata stored alongside each vector in Pinecone */
export interface ChunkMetadata extends RecordMetadata {
  repositoryId: string;
  filePath: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  language: string;
  content: string; // Store raw text for retrieval without a second DB call
}

/** A vector record ready to upsert into Pinecone */
export interface VectorRecord {
  id: string;
  values: number[];       // 384-dimensional embedding
  metadata: ChunkMetadata;
}

/** A search result from Pinecone with score + metadata */
export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: ChunkMetadata;
}

// --- Core operations ---

/**
 * Store embedding vectors in Pinecone.
 * Processes in batches of 100 (Pinecone's recommended max per upsert).
 */
export async function upsertVectors(
  vectors: VectorRecord[],
  namespace?: string
): Promise<void> {
  const index = getPineconeIndex();
  const ns = index.namespace(namespace || '');
  const BATCH_SIZE = 100;

  logger.info('📌 [Pinecone] Upserting vectors', {
    count: vectors.length,
    namespace: namespace || 'default',
  });

  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    const batch = vectors.slice(i, i + BATCH_SIZE);
    await ns.upsert({ records: batch });

    if (vectors.length > BATCH_SIZE) {
      const progress = Math.min(i + BATCH_SIZE, vectors.length);
      logger.debug(`📌 [Pinecone] Upserted ${progress}/${vectors.length}`);
    }
  }

  logger.info('✅ [Pinecone] Upsert complete', { count: vectors.length });
}

/**
 * Query Pinecone for the most similar vectors to the given embedding.
 * Returns top-K results with metadata.
 */
export async function queryVectors(
  queryEmbedding: number[],
  topK: number = 5,
  filter?: Record<string, unknown>,
  namespace?: string
): Promise<VectorSearchResult[]> {
  const index = getPineconeIndex();
  const ns = index.namespace(namespace || '');

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
}

/**
 * Delete all vectors for a specific repository.
 * Used when re-indexing a repo to avoid stale data.
 */
export async function deleteVectorsByRepository(
  repositoryId: string,
  namespace?: string
): Promise<void> {
  const index = getPineconeIndex();
  const ns = index.namespace(namespace || '');

  logger.info('🗑️ [Pinecone] Deleting vectors for repo', { repositoryId });

  try {
    // Pinecone serverless supports deleteMany with metadata filter
    await ns.deleteMany({ filter: { repositoryId } });
    logger.info('✅ [Pinecone] Vectors deleted', { repositoryId });
  } catch (error: any) {
    // Ignore 404s (e.g. index is empty or namespace doesn't exist yet)
    if (error?.message?.includes('404')) {
      logger.info('⚠️ [Pinecone] Vectors delete skipped (404 Not Found)', { repositoryId });
    } else {
      throw error;
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
