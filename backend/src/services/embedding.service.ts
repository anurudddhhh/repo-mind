// Embedding Service
// Orchestrates: chunks → HuggingFace embeddings → Pinecone storage.
// Called by the indexing pipeline to process a repository's code.

import { ChunkData } from './chunking.service';
import { generateEmbeddings } from '../lib/huggingface';
import { upsertVectors, VectorRecord, ChunkMetadata } from '../lib/pinecone';
import { logger } from '../lib/logger';

// --- Configuration ---
const EMBEDDING_BATCH_SIZE = 16; // Texts sent to HF per API call

/**
 * Generate embeddings for all chunks and store them in Pinecone.
 * Returns the number of vectors successfully stored.
 */
export async function embedAndStoreChunks(
  chunks: ChunkData[],
  onProgress?: (processed: number, total: number) => void
): Promise<number> {
  if (chunks.length === 0) {
    logger.warn('⚠️ [Embedding] No chunks to embed');
    return 0;
  }

  logger.info('🔢 [Embedding] Starting embedding pipeline', {
    totalChunks: chunks.length,
  });

  const vectors: VectorRecord[] = [];

  // Process in batches to avoid overwhelming HF API
  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const texts = batch.map((chunk) => chunk.content);

    try {
      const embeddings = await generateEmbeddings(texts, EMBEDDING_BATCH_SIZE);

      // Pair each embedding with its chunk metadata
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const embedding = embeddings[j];

        if (!embedding || embedding.length === 0) {
          logger.warn('⚠️ [Embedding] Empty embedding for chunk', { id: chunk.id });
          continue;
        }

        const metadata: ChunkMetadata = {
          repositoryId: chunk.repositoryId,
          filePath: chunk.filePath,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          language: chunk.language,
          content: chunk.content.slice(0, 3500), // Pinecone metadata limit ~40KB
        };

        vectors.push({
          id: chunk.id,
          values: embedding,
          metadata,
        });
      }

      // Report progress
      const processed = Math.min(i + EMBEDDING_BATCH_SIZE, chunks.length);
      if (onProgress) onProgress(processed, chunks.length);

      logger.debug(`🔢 [Embedding] Embedded ${processed}/${chunks.length} chunks`);
    } catch (error) {
      logger.error('❌ [Embedding] Batch embedding failed', {
        batchStart: i,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with next batch instead of failing entirely
    }
  }

  // Store all vectors in Pinecone
  if (vectors.length > 0) {
    logger.info('📌 [Embedding] Storing vectors in Pinecone', { count: vectors.length });
    await upsertVectors(vectors);
  }

  logger.info('✅ [Embedding] Pipeline complete', {
    inputChunks: chunks.length,
    storedVectors: vectors.length,
  });

  return vectors.length;
}
