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
// Register `redis` on the global scope so we can cache the
// instance across nodemon reloads (same pattern as Prisma).
// ============================================================
declare global {
  // eslint-disable-next-line no-var
  var redis: Redis | undefined;
}

// ============================================================
// ENVIRONMENT VARIABLE VALIDATION
// Fail fast at startup if Redis credentials are missing.
// Better to crash on boot than to silently fail during a
// user request in production.
// ============================================================
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error('❌ [Redis] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN in .env');
  throw new Error('Redis configuration is incomplete. Check your .env file.');
}

// ============================================================
// DEFAULT TTL (TIME-TO-LIVE)
// Every cached value expires after this many seconds unless
// overridden. Prevents stale data from lingering forever.
// Read from .env, fallback to 1 hour (3600 seconds).
// ============================================================
const DEFAULT_TTL = parseInt(process.env.REDIS_TTL || '3600', 10);

// ============================================================
// CREATE THE REDIS CLIENT INSTANCE
// Wrapped in a function for reuse in the singleton pattern.
// ============================================================
const createRedisClient = (): Redis => {
  return new Redis({
    url: UPSTASH_URL,
    token: UPSTASH_TOKEN,

    // Automatic retry on transient failures (network hiccups)
    // Upstash SDK handles this internally with exponential backoff
    retry: {
      retries: 3,
      backoff: (retryCount) => Math.min(1000 * 2 ** retryCount, 5000), // 1s, 2s, 4s, capped at 5s
    },
  });
};

// ============================================================
// SINGLETON EXPORT
// In development: reuse cached instance across hot-reloads
// In production: create once at startup
// ============================================================
export const redis: Redis = globalThis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.redis = redis;
}

// ============================================================
// HELPER FUNCTIONS — Type-safe wrappers around raw Redis ops
// ============================================================
// Direct Upstash SDK usage returns `unknown` types which is
// painful to work with. These helpers give us proper types
// and encapsulate common patterns like JSON serialization.
// ============================================================

/**
 * Get a value from Redis and automatically deserialize JSON.
 *
 * @param key - The Redis key to fetch
 * @returns Parsed value of type T, or null if not found
 *
 * @example
 * const user = await cacheGet<User>('user:123');
 * if (user) console.log(user.name);
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const value = await redis.get<T>(key);
    return value ?? null;
  } catch (error) {
    console.error(`❌ [Redis] cacheGet failed for key "${key}":`, error);
    // Return null on failure so callers can fall back to DB/API
    // Never throw — cache failures should NEVER break the app
    return null;
  }
}

/**
 * Set a value in Redis with automatic JSON serialization and TTL.
 *
 * @param key - The Redis key
 * @param value - Any JSON-serializable value
 * @param ttlSeconds - How long to keep it (default: 1 hour)
 * @returns true if success, false if failed
 *
 * @example
 * await cacheSet('user:123', { name: 'Alice' }, 300); // 5 min TTL
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number = DEFAULT_TTL
): Promise<boolean> {
  try {
    // Upstash's `set` accepts objects and stringifies automatically
    // `ex` option sets expiration in seconds
    await redis.set(key, value, { ex: ttlSeconds });
    return true;
  } catch (error) {
    console.error(`❌ [Redis] cacheSet failed for key "${key}":`, error);
    // Cache failures should not break the app — return false silently
    return false;
  }
}

/**
 * Delete a key from Redis. Used for cache invalidation
 * (e.g., after a user updates their profile, delete cached copy).
 *
 * @param key - The Redis key to delete
 * @returns Number of keys actually deleted (0 or 1)
 */
export async function cacheDelete(key: string): Promise<number> {
  try {
    return await redis.del(key);
  } catch (error) {
    console.error(`❌ [Redis] cacheDelete failed for key "${key}":`, error);
    return 0;
  }
}

/**
 * Delete multiple keys matching a pattern.
 * Useful for invalidating all cache entries for a user or repo.
 *
 * WARNING: Uses SCAN under the hood, which is expensive on large
 * key spaces. Use sparingly. For MVP, we only use this for
 * specific known-small patterns.
 *
 * @param pattern - Redis glob pattern (e.g., "user:123:*")
 * @returns Number of keys deleted
 */
export async function cacheDeletePattern(pattern: string): Promise<number> {
  try {
    const keys: string[] = [];
    let cursor: string | number = 0;

    // SCAN through the keyspace in chunks (avoids blocking Redis)
    // Explicit type annotation required because Upstash's scan()
    // returns a complex tuple that TypeScript can't infer inline.
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
    console.error(`❌ [Redis] cacheDeletePattern failed for pattern "${pattern}":`, error);
    return 0;
  }
}

/**
 * Check if a key exists WITHOUT fetching its value.
 * More efficient than cacheGet when you only need existence check.
 *
 * @param key - The Redis key
 * @returns true if key exists, false otherwise
 */
export async function cacheExists(key: string): Promise<boolean> {
  try {
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (error) {
    console.error(`❌ [Redis] cacheExists failed for key "${key}":`, error);
    return false;
  }
}

/**
 * Increment a counter atomically. Used for rate limiting.
 * Atomic = safe from race conditions even under concurrent load.
 *
 * @param key - The counter key
 * @param ttlSeconds - TTL if key is newly created
 * @returns The new counter value after increment
 *
 * @example
 * const count = await cacheIncrement('ratelimit:user:123', 60);
 * if (count > 20) throw new Error('Rate limit exceeded');
 */
export async function cacheIncrement(key: string, ttlSeconds?: number): Promise<number> {
  try {
    const count = await redis.incr(key);
    // Only set TTL on first increment (when count === 1)
    if (count === 1 && ttlSeconds) {
      await redis.expire(key, ttlSeconds);
    }
    return count;
  } catch (error) {
    console.error(`❌ [Redis] cacheIncrement failed for key "${key}":`, error);
    return 0;
  }
}

// ============================================================
// KEY BUILDER — Enforces consistent key naming across the app
// ============================================================
// Redis keys should follow a namespace convention like:
//   user:123:profile
//   repo:456:chunks
//   ratelimit:api:789
//
// This prevents key collisions and makes debugging easier.
// Always use these builders instead of hardcoding key strings.
// ============================================================

export const cacheKeys = {
  // GitHub API caches
  githubRepos: (userId: string) => `github:repos:${userId}`,
  githubRepo: (fullName: string) => `github:repo:${fullName}`,
  githubFiles: (repoId: string) => `github:files:${repoId}`,

  // User caches
  user: (userId: string) => `user:${userId}`,
  userByGithubId: (githubId: string) => `user:github:${githubId}`,

  // Chat caches
  chatResponse: (repoId: string, queryHash: string) => `chat:${repoId}:${queryHash}`,

  // Rate limiting
  rateLimit: (identifier: string, action: string) => `ratelimit:${action}:${identifier}`,

  // Semantic search caches
  searchResult: (repoId: string, queryHash: string) => `search:${repoId}:${queryHash}`,
};

// ============================================================
// HEALTH CHECK
// Simple ping to verify Redis is reachable at startup.
// Called from a test route to confirm everything works.
// ============================================================
export async function redisHealthCheck(): Promise<boolean> {
  try {
    // 'set' + 'get' is more reliable than PING for HTTP-based Redis
    const testKey = '__health_check__';
    await redis.set(testKey, 'ok', { ex: 10 });
    const value = await redis.get(testKey);
    return value === 'ok';
  } catch (error) {
    console.error('❌ [Redis] Health check failed:', error);
    return false;
  }
}

// ============================================================
// DEFAULT EXPORT
// ============================================================
export default redis;