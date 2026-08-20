// Hugging Face Inference API Client
// Generates text embeddings using sentence-transformers/all-MiniLM-L6-v2.
// Output: 384-dimensional vectors for Pinecone storage.

import axios from 'axios';
import { logger } from '@/lib/logger';

// --- Environment validation ---
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
const HF_MODEL = process.env.HUGGINGFACE_MODEL || 'sentence-transformers/all-MiniLM-L6-v2';
const HF_API_URL = `https://api-inference.huggingface.co/pipeline/feature-extraction/${HF_MODEL}`;

if (!HF_API_KEY) {
  throw new Error('HUGGINGFACE_API_KEY is not set in .env');
}

// --- Types ---
interface HFErrorResponse {
  error?: string;
  estimated_time?: number;
}

/**
 * Generate an embedding for a single text string.
 * Returns a 384-dimensional number array.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Truncate to ~512 tokens (~2000 chars) — model's max context.
  const truncated = text.slice(0, 2000);

  try {
    const response = await axios.post<number[]>(
      HF_API_URL,
      { inputs: truncated, options: { wait_for_model: true } },
      {
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const embedding = response.data;

    // HF API can return nested arrays — flatten if needed
    if (Array.isArray(embedding) && Array.isArray(embedding[0])) {
      return embedding[0] as number[];
    }

    return embedding;
  } catch (error) {
    // Handle model loading (cold start) — HF returns 503 with estimated_time
    if (axios.isAxiosError(error) && error.response?.status === 503) {
      const data = error.response.data as HFErrorResponse;
      const waitTime = data.estimated_time || 20;
      logger.warn(`⏳ [HF] Model loading, retrying in ${waitTime}s`);
      await new Promise((r) => setTimeout(r, waitTime * 1000));
      return generateEmbedding(text); // Retry once
    }

    logger.error('❌ [HF] Embedding generation failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts in batches.
 * HF API supports batch inputs — more efficient than one-by-one.
 */
export async function generateEmbeddings(
  texts: string[],
  batchSize: number = 16
): Promise<number[][]> {
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 2000));

    try {
      const response = await axios.post<number[][]>(
        HF_API_URL,
        { inputs: batch, options: { wait_for_model: true } },
        {
          headers: {
            Authorization: `Bearer ${HF_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      allEmbeddings.push(...response.data);

      if (texts.length > batchSize) {
        const progress = Math.min(i + batchSize, texts.length);
        logger.debug(`🔢 [HF] Embedded ${progress}/${texts.length} texts`);
      }
    } catch (error) {
      // On 503 (model loading), wait and retry the batch
      if (axios.isAxiosError(error) && error.response?.status === 503) {
        const data = error.response.data as HFErrorResponse;
        const waitTime = data.estimated_time || 20;
        logger.warn(`⏳ [HF] Model loading, retrying batch in ${waitTime}s`);
        await new Promise((r) => setTimeout(r, waitTime * 1000));
        i -= batchSize; // Retry this batch
        continue;
      }

      logger.error('❌ [HF] Batch embedding failed', {
        batchStart: i,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return allEmbeddings;
}

/**
 * Test the HF API connection by embedding a test string.
 */
export async function testHuggingFaceConnection(): Promise<boolean> {
  try {
    const embedding = await generateEmbedding('test connection');
    logger.info('✅ [HF] Connection OK', { dimensions: embedding.length });
    return embedding.length === 384;
  } catch (error) {
    logger.error('❌ [HF] Connection failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
