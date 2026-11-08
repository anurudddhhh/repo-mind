// ============================================================
// REDIS CLIENT SINGLETON
// ============================================================
// This file exports ONE shared Upstash Redis client used across
// the entire backend. Same singleton pattern as Prisma to avoid
// creating multiple client instances during nodemon hot-reloads.
//
// PURPOSE:
//   - Cache GitHub API responses (avoid rate limits)
//   - Cache AI chat responses (save costs, improve speed)
//   - Store rate-limiting counters
//   - Provide type-safe wrapper functions for common operations
//
// WHY UPSTASH?
//   - HTTP-based (works in serverless, no TCP config)
//   - Cloud-managed (no local Redis install)
//   - Free tier is generous (10K commands/day)
// ============================================================

import { Redis } from '@upstash/redis';

// ============================================================
// TYPESCRIPT DECLARATION MERGING
// ============================================================
declare global {
  // eslint-disable-next-line no-var
  var redis: Redis | undefined;
}

// ============================================================
// ENVIRONMENT VARIABLE VALIDATION
// ============================================================
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error('❌ [Redis] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN in .env');
  throw new Error('Redis configuration is incomplete. Check your .env file.');
}

// ============================================================
// DEFAULT TTL (TIME-TO-LIVE)
// ============================================================
const DEFAULT_TTL = parseInt(process.env.REDIS_TTL || '3600', 10);

// Helper function to check if an error is a DNS / Unreachable Host issue
function formatRedisError(action: string, key: string, error: unknown): void {
  const isNetworkErr =
    error instanceof Error &&
    ('code' in error || 'cause' in error) &&
    (String(error).includes('ENOTFOUND') || String(error).includes('ECONNREFUSED'));

  if (isNetworkErr) {
    console.warn(`⚠️ [Redis] Host unreachable (${action} "${key}") — bypassing cache.`);
  } else {
    console.error(`❌ [Redis] ${action} failed for key "${key}":`, error);
  }
}

// ============================================================
// CREATE THE REDIS CLIENT INSTANCE
// Fail fast (1 retry) on DNS / network failures
// ============================================================
const createRedisClient = (): Redis => {
  return new Redis({
    url: UPSTASH_URL,
    token: UPSTASH_TOKEN,
    retry: {
      retries: 1, // Fail fast on invalid host/DNS issues
      backoff: () => 200,
    },
  });
};

// ============================================================
// SINGLETON EXPORT
// ============================================================
export const redis: Redis = globalThis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.redis = redis;
}

// ============================================================
// HELPER FUNCTIONS — Type-safe wrappers around raw Redis ops
// ============================================================

/**
 * Get a value from Redis and automatically deserialize JSON.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const value = await redis.get<T>(key);
    return value ?? null;
  } catch (error) {
    formatRedisError('cacheGet', key, error);
    return null;
  }
}

/**
 * Set a value in Redis with automatic JSON serialization and TTL.
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number = DEFAULT_TTL
): Promise<boolean> {
  try {
    await redis.set(key, value, { ex: ttlSeconds });
    return true;
  } catch (error) {
    formatRedisError('cacheSet', key, error);
    return false;
  }
}

/**
 * Delete a key from Redis.
 */
export async function cacheDelete(key: string): Promise<number> {
  try {
    return await redis.del(key);
  } catch (error) {
    formatRedisError('cacheDelete', key, error);
    return 0;
  }
}

/**
 * Delete multiple keys matching a pattern.
 */
export async function cacheDeletePattern(pattern: string): Promise<number> {
  try {
    const keys: string[] = [];
    let cursor: string | number = 0;

    do {
      const result: [string | number, string[]] = await redis.scan(cursor, {
        match: pattern,
        count: 100,
      });
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== 0 && cursor !== '0');

    if (keys.length === 0) return 0;

    return await redis.del(...keys);
  } catch (error) {
    formatRedisError('cacheDeletePattern', pattern, error);
    return 0;
  }
}

/**
 * Check if a key exists WITHOUT fetching its value.
 */
export async function cacheExists(key: string): Promise<boolean> {
  try {
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (error) {
    formatRedisError('cacheExists', key, error);
    return false;
  }
}

/**
 * Increment a counter atomically. Used for rate limiting.
 */
export async function cacheIncrement(key: string, ttlSeconds?: number): Promise<number> {
  try {
    const count = await redis.incr(key);
    if (count === 1 && ttlSeconds) {
      await redis.expire(key, ttlSeconds);
    }
    return count;
  } catch (error) {
    formatRedisError('cacheIncrement', key, error);
    return 0;
  }
}

// ============================================================
// KEY BUILDER
// ============================================================
export const cacheKeys = {
  githubRepos: (userId: string) => `github:repos:${userId}`,
  githubRepo: (fullName: string) => `github:repo:${fullName}`,
  githubFiles: (repoId: string) => `github:files:${repoId}`,
  user: (userId: string) => `user:${userId}`,
  userByGithubId: (githubId: string) => `user:github:${githubId}`,
  chatResponse: (repoId: string, queryHash: string) => `chat:${repoId}:${queryHash}`,
  rateLimit: (identifier: string, action: string) => `ratelimit:${action}:${identifier}`,
  searchResult: (repoId: string, queryHash: string) => `search:${repoId}:${queryHash}`,
};

// ============================================================
// HEALTH CHECK
// ============================================================
export async function redisHealthCheck(): Promise<boolean> {
  try {
    const testKey = '__health_check__';
    await redis.set(testKey, 'ok', { ex: 10 });
    const value = await redis.get(testKey);
    return value === 'ok';
  } catch {
    console.warn('⚠️ [Redis] Health check skipped — host unreachable.');
    return false;
  }
}

export default redis;