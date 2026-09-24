// Embedding Service (Streaming Micro-Batched & Memory Optimized)
// Orchestrates: chunks → HuggingFace/Xenova embeddings → Immediate Pinecone streaming.
// Memory safe for 512 MB RAM cloud environments (Render Free Tier).

import { ChunkData } from './chunking.service';
import { generateEmbeddings } from '../lib/huggingface';
import { upsertVectors, VectorRecord, ChunkMetadata } from '../lib/pinecone';
import { logger } from '../lib/logger';

// Reduced micro-batch size to keep RAM usage bounded under 512 MB ceiling
const EMBEDDING_MICRO_BATCH_SIZE = 8;

/**
 * Generate embeddings for all chunks and stream them immediately to Pinecone in micro-batches.
 * Returns the total number of vectors successfully stored.
 */
export async function embedAndStoreChunks(
  chunks: ChunkData[],
  onProgress?: (processed: number, total: number) => void
): Promise<number> {
  if (chunks.length === 0) {
    logger.warn('⚠️ [Embedding] No chunks to embed');
    return 0;
  }

  logger.info('🔢 [Embedding] Starting memory-optimized embedding pipeline', {
    totalChunks: chunks.length,
    microBatchSize: EMBEDDING_MICRO_BATCH_SIZE,
  });

  let totalStoredVectors = 0;

  // Process and stream in micro-batches to allow V8 Garbage Collector to reclaim RAM
  for (let i = 0; i < chunks.length; i += EMBEDDING_MICRO_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_MICRO_BATCH_SIZE);
    const texts = batch.map((chunk) => chunk.content);

    try {
      const embeddings = await generateEmbeddings(texts, EMBEDDING_MICRO_BATCH_SIZE);
      const batchVectors: VectorRecord[] = [];

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

        batchVectors.push({
          id: chunk.id,
          values: embedding,
          metadata,
        });
      }

      // Stream micro-batch vectors immediately to Pinecone instead of accumulating in memory
      if (batchVectors.length > 0) {
        await upsertVectors(batchVectors);
        totalStoredVectors += batchVectors.length;
      }

      // Report progress
      const processed = Math.min(i + EMBEDDING_MICRO_BATCH_SIZE, chunks.length);
      if (onProgress) {
        onProgress(processed, chunks.length);
      }

      logger.debug(`🔢 [Embedding] Micro-batch complete: stored ${processed}/${chunks.length}`);
    } catch (error) {
      logger.error('❌ [Embedding] Micro-batch embedding failed', {
        batchStart: i,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with next micro-batch instead of aborting the entire pipeline
    }
  }

  logger.info('✅ [Embedding] Memory-optimized pipeline complete', {
    inputChunks: chunks.length,
    storedVectors: totalStoredVectors,
  });

  return totalStoredVectors;
}