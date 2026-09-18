// =============================================================================
// GROQ AI CLIENT & COMPLETION SERVICE (WITH 429 BACKOFF & CLIENT-SIDE JSON EXTRACTION)
// =============================================================================
// Unified interface to execute AI prompts using Groq's high-speed engine.
// Bypasses brittle server-side JSON mode to prevent HTTP 400 json_validate_failed errors.
// =============================================================================

import Groq from 'groq-sdk';
import { logger } from './logger';

// --- Environment Validation ---
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

if (!GROQ_API_KEY) {
  logger.error('❌ [Groq] GROQ_API_KEY is missing from environment variables');
  throw new Error('GROQ_API_KEY is required in .env');
}

// --- Singleton Client ---
let groqClient: Groq | null = null;

export function getGroqClient(): Groq {
  if (!groqClient) {
    groqClient = new Groq({
      apiKey: GROQ_API_KEY,
    });
    logger.info('🤖 [Groq] Client initialized successfully', {
      defaultModel: DEFAULT_MODEL,
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
}

// Asynchronous sleep helper
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generate a text completion from Groq.
 * Automatically retries up to 3 times on 429 rate limit errors with backoff.
 */
export async function generateGroqCompletion(
  prompt: string,
  options: GroqCompletionOptions = {}
): Promise<string> {
  const client = getGroqClient();
  const model = options.model || DEFAULT_MODEL;
  const currentRetry = options.retryCount || 0;
  const MAX_RETRIES = 3;

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
      model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 2500,
    });

    const content = response.choices[0]?.message?.content || '';
    return content.trim();
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    const isRateLimit = errorMsg.includes('429') || errorMsg.toLowerCase().includes('rate limit');

    // 1. Handle 429 Rate Limits with exponential backoff
    if (isRateLimit && currentRetry < MAX_RETRIES) {
      const waitMatch = errorMsg.match(/try again in ([\d\.]+)s/i);
      const parsedWaitSec = waitMatch ? parseFloat(waitMatch[1]) : 6;
      const waitMs = Math.ceil(parsedWaitSec * 1000) + 1500;

      logger.warn(`⏳ [Groq] 429 Rate limit encountered (Attempt ${currentRetry + 1}/${MAX_RETRIES}). Pausing for ${(waitMs / 1000).toFixed(1)}s...`);
      
      await delay(waitMs);

      return generateGroqCompletion(prompt, {
        ...options,
        retryCount: currentRetry + 1,
      });
    }

    logger.error('❌ [Groq] Completion request failed:', {
      model,
      error: errorMsg,
    });

    throw error;
  }
}

/**
 * Convenience helper to generate and reliably parse JSON responses.
 * Avoids passing response_format: { type: "json_object" } to prevent Groq API 400 errors.
 */
export async function generateGroqJSON<T>(
  prompt: string,
  options: GroqCompletionOptions = {}
): Promise<T> {
  const jsonPrompt = `${prompt}\n\nCRITICAL: Respond ONLY with a valid JSON object starting with { and ending with }. Do NOT include any markdown formatting, text explanations, or code fences outside the JSON object.`;

  const rawText = await generateGroqCompletion(jsonPrompt, options);

  // Extract JSON string using robust regex matcher
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  const jsonString = jsonMatch ? jsonMatch[0] : rawText;

  try {
    return JSON.parse(jsonString) as T;
  } catch (firstErr) {
    // Light cleanup for common LLM JSON quirks (trailing commas, control characters)
    const cleaned = jsonString
      .replace(/,\s*([\]}])/g, '$1') // Remove trailing commas
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove unescaped control chars
      .trim();

    try {
      return JSON.parse(cleaned) as T;
    } catch (secondErr) {
      logger.error('❌ [Groq] Failed to parse JSON response:', {
        rawSnippet: rawText.slice(0, 200),
      });
      throw new Error(`Failed to parse AI JSON response`);
    }
  }
}

/**
 * Test the Groq connection with a minimal prompt.
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