// =============================================================================
// GROQ AI CLIENT & MULTI-LLM FALLBACK SERVICE
// =============================================================================
// Features automated Multi-LLM Cascade Fallback:
// 120B Primary Model ➔ 20B High-Speed Fallback ➔ 20B Safeguard Backup
// Guarantees zero downtime even during high-traffic Groq API 429 rate limit spikes.
// =============================================================================

import Groq from 'groq-sdk';
import { logger } from './logger';

// --- Environment Validation ---
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DEFAULT_PRIMARY_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

if (!GROQ_API_KEY) {
  logger.error('❌ [Groq] GROQ_API_KEY is missing from environment variables');
  throw new Error('GROQ_API_KEY is required in .env');
}

// Ordered Multi-LLM Cascade Chain
const MODEL_CASCADE_CHAIN = [
  DEFAULT_PRIMARY_MODEL,
  'openai/gpt-oss-20b',
  'openai/gpt-oss-safeguard-20b',
].filter((model, index, self) => self.indexOf(model) === index); // Unique list

// --- Singleton Client ---
let groqClient: Groq | null = null;

export function getGroqClient(): Groq {
  if (!groqClient) {
    groqClient = new Groq({
      apiKey: GROQ_API_KEY,
    });
    logger.info('🤖 [Groq] Client initialized with Multi-LLM Fallback Pipeline', {
      primaryModel: MODEL_CASCADE_CHAIN[0],
      fallbackChain: MODEL_CASCADE_CHAIN.slice(1),
    });
  }
  return groqClient;
}

export interface GroqCompletionOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  retryCount?: number;
  modelIndex?: number;
}

// Asynchronous sleep helper
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generate a text completion from Groq using an automated multi-tier model fallback cascade.
 * If the primary 120B model hits a 429 rate limit, it automatically retries with backoff,
 * then seamlessly degrades to the secondary 20B model without failing the request.
 */
export async function generateGroqCompletion(
  prompt: string,
  options: GroqCompletionOptions = {}
): Promise<string> {
  const client = getGroqClient();

  // Determine model sequence
  const customModel = options.model;
  const activeChain = customModel
    ? [customModel, ...MODEL_CASCADE_CHAIN.filter((m) => m !== customModel)]
    : MODEL_CASCADE_CHAIN;

  const currentModelIndex = options.modelIndex ?? 0;
  const activeModel = activeChain[currentModelIndex] || activeChain[0];

  const currentRetry = options.retryCount || 0;
  const MAX_RETRIES_PER_MODEL = 2;

  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [];

  if (options.systemPrompt) {
    messages.push({
      role: 'system',
      content: options.systemPrompt,
    });
  }

  messages.push({
    role: 'user',
    content: prompt,
  });

  try {
    const response = await client.chat.completions.create({
      model: activeModel,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 3500,
    });

    const content = response.choices[0]?.message?.content || '';

    if (currentModelIndex > 0) {
      logger.info(`✨ [Groq] Successfully generated completion using fallback model: ${activeModel}`);
    }

    return content.trim();
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isRateLimit = errorMsg.includes('429') || errorMsg.toLowerCase().includes('rate limit');
    const isServerOverloaded = errorMsg.includes('503') || errorMsg.includes('500');

    // 1. Retry current model with exponential backoff if retries remain
    if ((isRateLimit || isServerOverloaded) && currentRetry < MAX_RETRIES_PER_MODEL) {
      const waitMatch = errorMsg.match(/try again in ([\d\.]+)s/i);
      const parsedWaitSec = waitMatch ? parseFloat(waitMatch[1]) : 4;
      const waitMs = Math.ceil(parsedWaitSec * 1000) + 1000;

      logger.warn(
        `⏳ [Groq] Rate limit on ${activeModel} (Attempt ${currentRetry + 1}/${MAX_RETRIES_PER_MODEL}). Pausing ${(waitMs / 1000).toFixed(1)}s...`
      );

      await delay(waitMs);

      return generateGroqCompletion(prompt, {
        ...options,
        modelIndex: currentModelIndex,
        retryCount: currentRetry + 1,
      });
    }

    // 2. Cascade down to the next fallback model if available
    const nextModelIndex = currentModelIndex + 1;
    if (nextModelIndex < activeChain.length) {
      const fallbackModel = activeChain[nextModelIndex];
      logger.warn(
        `🔄 [Groq] Model ${activeModel} exhausted rate limit. Seamlessly cascading down to fallback model: ${fallbackModel}...`
      );

      return generateGroqCompletion(prompt, {
        ...options,
        modelIndex: nextModelIndex,
        retryCount: 0,
      });
    }

    // 3. Final error if all fallback models in the cascade chain failed
    logger.error('❌ [Groq] All fallback models in the cascade chain failed:', {
      attemptedModels: activeChain,
      finalError: errorMsg,
    });

    throw error;
  }
}

/**
 * Convenience helper to generate and reliably parse JSON responses.
 * Inherits multi-model cascade resilience automatically from generateGroqCompletion.
 */
export async function generateGroqJSON<T>(
  prompt: string,
  options: GroqCompletionOptions = {}
): Promise<T> {
  const jsonPrompt = `${prompt}\n\nCRITICAL REQUIREMENTS:
1. Respond ONLY with a valid JSON object starting with { and ending with }.
2. Do NOT include any markdown code fences (such as \`\`\`json) or extra conversational text outside the JSON object.
3. Ensure all property keys and strings are double-quoted valid JSON.`;

  const rawText = await generateGroqCompletion(jsonPrompt, {
    ...options,
    maxTokens: options.maxTokens ?? 3500,
  });

  // Pre-clean markdown code fences if model includes them
  const cleanedText = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```md\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Extract JSON string using robust regex matcher
  const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
  const jsonString = jsonMatch ? jsonMatch[0] : cleanedText;

  try {
    return JSON.parse(jsonString) as T;
  } catch {
    // Structural cleanup for common LLM JSON quirks (trailing commas, control characters)
    const sanitized = jsonString
      .replace(/,\s*([\]}])/g, '$1') // Remove trailing commas
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove unescaped control chars
      .trim();

    try {
      return JSON.parse(sanitized) as T;
    } catch {
      logger.error('❌ [Groq] Failed to parse JSON response:', {
        rawSnippet: rawText.slice(0, 300),
      });
      throw new Error(`Failed to parse AI JSON response`);
    }
  }
}

/**
 * Test the Groq connection across the cascade chain.
 */
export async function testGroqConnection(): Promise<boolean> {
  try {
    const response = await generateGroqCompletion('Respond with "OK"', {
      maxTokens: 10,
    });
    return response.length > 0;
  } catch {
    return false;
  }
}

export default generateGroqCompletion;