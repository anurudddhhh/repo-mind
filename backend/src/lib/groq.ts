// =============================================================================
// GROQ AI CLIENT & COMPLETION SERVICE
// =============================================================================
// Provides a unified interface to execute AI prompts using Groq's high-speed
// inference engine. Supports standard text generation and structured JSON output.
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
  jsonMode?: boolean;
  model?: string;
}

/**
 * Generate a text completion or structured JSON from Groq.
 *
 * @param prompt - The user prompt or code context
 * @param options - Additional parameters (system prompt, temperature, jsonMode)
 * @returns Generated string response
 */
export async function generateGroqCompletion(
  prompt: string,
  options: GroqCompletionOptions = {}
): Promise<string> {
  const client = getGroqClient();
  const model = options.model || DEFAULT_MODEL;

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
      temperature: options.temperature ?? 0.2, // Low temperature for deterministic analysis
      max_tokens: options.maxTokens ?? 4096,
      response_format: options.jsonMode ? { type: 'json_object' } : undefined,
    });

    const content = response.choices[0]?.message?.content || '';
    return content.trim();
  } catch (error: any) {
    logger.error('❌ [Groq] Completion request failed:', {
      model,
      error: error?.message || String(error),
    });

    // Fallback: If 120B model fails, fallback to 20B
    if (model !== 'openai/gpt-oss-20b') {
      logger.warn('⚠️ [Groq] Attempting fallback to openai/gpt-oss-20b...');
      return generateGroqCompletion(prompt, {
        ...options,
        model: 'openai/gpt-oss-20b',
      });
    }

    throw error;
  }
}

/**
 * Convenience helper to generate and automatically parse JSON responses.
 *
 * @param prompt - The user prompt requesting JSON output
 * @param options - Additional parameters
 * @returns Parsed JSON object of type T
 */
export async function generateGroqJSON<T>(
  prompt: string,
  options: Omit<GroqCompletionOptions, 'jsonMode'> = {}
): Promise<T> {
  const rawText = await generateGroqCompletion(prompt, {
    ...options,
    jsonMode: true,
  });

  try {
    return JSON.parse(rawText) as T;
  } catch (error) {
    // If wrapped in Markdown triple backticks ```json ... ```, clean it
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      logger.error('❌ [Groq] Failed to parse JSON response:', { rawText });
      throw new Error(`Groq returned invalid JSON: ${rawText.slice(0, 100)}...`);
    }
  }
}

/**
 * Test the Groq connection with a minimal prompt.
 */
export async function testGroqConnection(): Promise<boolean> {
  try {
    const response = await generateGroqCompletion('Respond with "OK"', {
      maxTokens: 50,
    });
    return response.length > 0;
  } catch {
    return false;
  }
}

export default generateGroqCompletion;