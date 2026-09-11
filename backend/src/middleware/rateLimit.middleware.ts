// =============================================================================
// UPSTASH REDIS SLIDING-WINDOW RATE LIMITING MIDDLEWARE
// =============================================================================
// Feature 10:
//   - Protects AI endpoints (Groq) and database against abuse and DDoS attacks.
//   - Identifies users by authenticated User ID (or IP address if unauthenticated).
//   - Uses Upstash Redis sliding window algorithm for accurate, burst-resistant limiting.
//   - Returns standard HTTP 429 status code and X-RateLimit headers.
// =============================================================================

import type { Request, Response, NextFunction } from 'express';
import { Ratelimit } from '@upstash/ratelimit';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

// ─────────────────────────────────────────────────────────────
// RATE LIMIT TIERS & CONFIGURATION
// ─────────────────────────────────────────────────────────────

// 1. AI Rate Limiter: For compute-heavy AI operations (Analysis, Chat, Embeddings)
//    Allowance: 20 requests per 1 minute window per user
export const aiRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '1 m'),
  analytics: true,
  prefix: 'ratelimit:ai',
});

// 2. Standard API Rate Limiter: For standard queries (Searching, Repo listing, Trees)
//    Allowance: 60 requests per 1 minute window per user
export const standardRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, '1 m'),
  analytics: true,
  prefix: 'ratelimit:standard',
});

// 3. Auth & Sensitive Rate Limiter: For login / callback endpoints
//    Allowance: 10 requests per 1 minute window per IP
export const authRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  analytics: true,
  prefix: 'ratelimit:auth',
});

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Creates an Express middleware handler that enforces a specific Ratelimit instance.
 *
 * @param limiter - An initialized Ratelimit instance
 * @param tierName - Human-readable label for logging ('AI' | 'Standard' | 'Auth')
 */
export function createRateLimitMiddleware(limiter: Ratelimit, tierName: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 1. Determine unique client identifier:
    //    Prefer authenticated User ID -> Fallback to client IP
    const user = req.user as { id?: string } | undefined;
    const identifier = user?.id || req.ip || req.headers['x-forwarded-for'] || 'anonymous';

    const cleanIdentifier = String(identifier).replace(/^::ffff:/, ''); // Clean IPv6-mapped IPv4

    try {
      const { success, limit, remaining, reset } = await limiter.limit(cleanIdentifier);

      // Set standard HTTP rate limit headers for client transparency
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', reset);

      if (!success) {
        const retryAfterSeconds = Math.ceil((reset - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfterSeconds);

        logger.warn(`⏱️ [RateLimit] ${tierName} limit exceeded`, {
          identifier: cleanIdentifier,
          path: req.originalUrl,
          retryAfter: retryAfterSeconds,
        });

        res.status(429).json({
          success: false,
          error: 'Too Many Requests',
          message: `Rate limit exceeded for ${tierName} operations. Please slow down and try again in ${retryAfterSeconds} seconds.`,
          retryAfter: retryAfterSeconds,
        });
        return;
      }

      // Rate limit check passed — continue to the controller
      next();
    } catch (error) {
      logger.error(`❌ [RateLimit] Error checking rate limit for ${cleanIdentifier}:`, error);
      // FAIL-OPEN POLICY: Never block legitimate users if Redis is temporarily unreachable
      next();
    }
  };
}

// ─────────────────────────────────────────────────────────────
// CONVENIENCE EXPORTS
// ─────────────────────────────────────────────────────────────
export const rateLimitAI = createRateLimitMiddleware(aiRateLimiter, 'AI Analysis');
export const rateLimitStandard = createRateLimitMiddleware(standardRateLimiter, 'Standard API');
export const rateLimitAuth = createRateLimitMiddleware(authRateLimiter, 'Authentication');