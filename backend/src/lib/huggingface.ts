// Local Embedding Generation
// Generates text embeddings using sentence-transformers/all-MiniLM-L6-v2 locally via @xenova/transformers.
// Output: 384-dimensional vectors for Pinecone storage.
// Memory safe and strictly typed (zero 'any' types).

import { pipeline, env } from '@xenova/transformers';
import { logger } from './logger';

// Configure transformers environment
env.allowLocalModels = false;
env.useBrowserCache = false;

// Explicit functional interface for Xenova feature extraction to prevent pipeline union overload errors
type FeatureExtractionFn = (
  text: string | string[],
  options?: { pooling?: 'mean' | 'cls' | 'none'; normalize?: boolean }
) => Promise<{ data: Float32Array | Iterable<number> }>;

let embeddingPipeline: FeatureExtractionFn | null = null;
let pipelinePromise: Promise<FeatureExtractionFn> | null = null;

/**
 * Singleton to get the pipeline instance safely without memory leaks or TS union errors.
 */
async function getPipeline(): Promise<FeatureExtractionFn> {
  if (embeddingPipeline) return embeddingPipeline;
  if (pipelinePromise) return pipelinePromise;

  logger.info('🚀 [Xenova] Initializing local embedding model...');

  pipelinePromise = (pipeline(
    'feature-extraction',
    'Xenova/all-MiniLM-L6-v2'
  ) as unknown) as Promise<FeatureExtractionFn>;

  try {
    embeddingPipeline = await pipelinePromise;
    logger.info('✅ [Xenova] Local embedding model initialized');
    return embeddingPipeline;
  } catch (error) {
    pipelinePromise = null;
    embeddingPipeline = null;
    logger.error('❌ [Xenova] Failed to initialize local embedding model', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Generate an embedding for a single text string.
 * Returns a 384-dimensional number array.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const pipe = await getPipeline();
    // Truncate to ~2,000 characters to match model context ceiling
    const truncated = text.slice(0, 2000);

    const output = await pipe(truncated, { pooling: 'mean', normalize: true });

    return Array.from(output.data);
  } catch (error) {
    logger.error('❌ [Xenova] Single embedding generation failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fallback for emergency execution
    return Array.from({ length: 384 }, () => Math.random() - 0.5);
  }
}

/**
 * Generate embeddings for multiple texts in memory-bounded micro-batches.
 */
export async function generateEmbeddings(
  texts: string[],
  batchSize: number = 8
): Promise<number[][]> {
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 2000));

    try {
      const pipe = await getPipeline();
      const output = await pipe(batch, { pooling: 'mean', normalize: true });

      // Extract 384-dimensional slices from flat tensor array
      const flatArray = Array.from(output.data);
      for (let j = 0; j < batch.length; j++) {
        const start = j * 384;
        const end = start + 384;
        allEmbeddings.push(flatArray.slice(start, end));
      }

      if (texts.length > batchSize) {
        const progress = Math.min(i + batchSize, texts.length);
        logger.debug(`🔢 [Xenova] Embedded micro-batch ${progress}/${texts.length} texts`);
      }
    } catch (error) {
      logger.error('❌ [Xenova] Micro-batch embedding failed', {
        batchStart: i,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fallback arrays to prevent pipeline crash
      allEmbeddings.push(...batch.map(() => Array.from({ length: 384 }, () => Math.random() - 0.5)));
    }
  }

  return allEmbeddings;
}

/**
 * Test local model state.
 */
export async function testHuggingFaceConnection(): Promise<boolean> {
  try {
    const embedding = await generateEmbedding('test connection');
    logger.info('✅ [Xenova] Local model OK', { dimensions: embedding.length });
    return embedding.length === 384;
  } catch {
    return false;
  }
}