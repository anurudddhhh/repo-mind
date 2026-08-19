// ============================================================
// JWT UTILITY — Token generation, verification, and extraction
// ============================================================
// This file provides all JWT-related functions used across the app.
// It abstracts away the raw jsonwebtoken library so route handlers
// have a clean, type-safe API to work with.
//
// USAGE PATTERN:
//   1. After successful OAuth → generateToken(user) → JWT string
//   2. Frontend stores JWT in localStorage
//   3. Frontend sends JWT in Authorization header:
//      Authorization: Bearer <jwt>
//   4. Auth middleware extracts + verifies JWT on every request
// ============================================================

import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { logger } from '@/lib/logger';

// ============================================================
// ENVIRONMENT VARIABLE VALIDATION
// Fail fast at startup if JWT_SECRET is missing.
// A missing secret = ANY token would be considered valid = disaster.
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!JWT_SECRET) {
  logger.error('❌ [JWT] JWT_SECRET is not set in .env');
  throw new Error(
    'JWT_SECRET is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
  );
}

// Additional safety check: JWT_SECRET should be reasonably long
// A short secret = brute-forceable in seconds
if (JWT_SECRET.length < 32) {
  logger.warn('⚠️ [JWT] JWT_SECRET is shorter than 32 characters — this is insecure!');
}

// ============================================================
// JWT PAYLOAD TYPE
// ============================================================
// Defines the shape of the data we store in every JWT.
// Keep this MINIMAL — JWTs are transmitted on every request,
// so bloated payloads increase bandwidth and latency.
//
// - userId    → Our internal user ID (Prisma cuid)
// - githubId  → GitHub's user ID (for reference)
// - username  → For display purposes without hitting DB
// - iat/exp   → Standard JWT fields (added automatically by jwt.sign)
// ============================================================
export interface AppJwtPayload {
  userId: string;
  githubId: string;  // BigInt serialized as string
  username: string;
  // Standard JWT claims (added by jsonwebtoken automatically)
  iat?: number;      // Issued at (Unix timestamp in seconds)
  exp?: number;      // Expiration (Unix timestamp in seconds)
}

// ============================================================
// GENERATE A JWT FOR A USER
// ============================================================
// Called after successful OAuth login in the auth controller.
// Returns a signed JWT string that the client should store and
// send with every subsequent request.
//
// @param user - The User object from Prisma
// @returns Signed JWT string
//
// @example
//   const token = generateToken(user);
//   res.cookie('token', token, { httpOnly: true });
// ============================================================
export function generateToken(user: User): string {
  const payload: AppJwtPayload = {
    userId: user.id,
    githubId: user.githubId.toString(), // BigInt must be converted to string
    username: user.username,
  };

  const options: SignOptions = {
    // JWT_EXPIRES_IN can be '7d', '1h', '30m', or seconds as number
    expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'],

    // HS256 is symmetric — same secret signs and verifies.
    // For our single-server setup, this is perfect. If we ever
    // split auth into a separate microservice, we'd use RS256
    // (asymmetric: private key signs, public key verifies).
    algorithm: 'HS256',

    // 'iss' (issuer) helps identify tokens if we later run multiple
    // services (e.g., dev + staging + prod all issuing tokens)
    issuer: 'repo-mind-api',
  };

  try {
    const token = jwt.sign(payload, JWT_SECRET as string, options);

    logger.debug('🔑 [JWT] Token generated', {
      userId: user.id,
      username: user.username,
      expiresIn: JWT_EXPIRES_IN,
    });

    return token;
  } catch (error) {
    logger.error('❌ [JWT] Failed to generate token', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to generate authentication token');
  }
}

// ============================================================
// VERIFY A JWT AND EXTRACT PAYLOAD
// ============================================================
// Called by the auth middleware on every protected request.
// Returns the decoded payload if valid, or throws if invalid.
//
// VERIFICATION CHECKS (done by jwt.verify automatically):
//   1. Signature matches JWT_SECRET (not tampered with)
//   2. Token has not expired (exp > now)
//   3. Token is not from before it was issued (nbf check)
//   4. Algorithm matches what we expect (prevents alg=none attack)
//   5. Issuer matches our expected value
//
// @param token - The JWT string from Authorization header or cookie
// @returns Decoded payload with user info
// @throws Error if token is invalid, expired, or tampered
// ============================================================
export function verifyToken(token: string): AppJwtPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET as string, {
      algorithms: ['HS256'],  // Explicitly allow only HS256 (defense in depth)
      issuer: 'repo-mind-api',
    }) as AppJwtPayload;

    // Sanity check — verify all required fields are present
    // (defensive coding in case someone forges a token with weird payload)
    if (!decoded.userId || !decoded.githubId || !decoded.username) {
      throw new Error('JWT payload is missing required fields');
    }

    return decoded;
  } catch (error) {
    // Log different failure modes for easier debugging
    if (error instanceof jwt.TokenExpiredError) {
      logger.debug('⏰ [JWT] Token expired', { expiredAt: error.expiredAt });
      throw new Error('Token has expired. Please log in again.');
    }

    if (error instanceof jwt.JsonWebTokenError) {
      logger.warn('🚫 [JWT] Invalid token', {
        reason: error.message,
      });
      throw new Error('Invalid authentication token.');
    }

    // Re-throw anything else (should be rare)
    throw error;
  }
}

// ============================================================
// DECODE A JWT WITHOUT VERIFYING
// ============================================================
// Reads the JWT payload without checking the signature or expiry.
// ⚠️ ONLY USE FOR DEBUGGING/LOGGING — never trust the result!
//
// USE CASE: You want to log which user made a request even if
// their token is expired (for analytics).
// ============================================================
export function decodeToken(token: string): AppJwtPayload | null {
  try {
    const decoded = jwt.decode(token) as AppJwtPayload | null;
    return decoded;
  } catch {
    return null;
  }
}

// ============================================================
// EXTRACT JWT FROM AN EXPRESS REQUEST
// ============================================================
// Looks for the JWT in two places (in order of priority):
//   1. Authorization header: "Authorization: Bearer <token>"
//   2. Cookie: "token=<token>"
//
// The auth middleware calls this to find the JWT wherever
// the client sent it.
//
// @param req - Express Request object
// @returns JWT string or null if not found
// ============================================================
export function extractTokenFromRequest(req: Request): string | null {
  // ─────────────────────────────────────────────────────
  // METHOD 1: Authorization header (preferred for APIs)
  // ─────────────────────────────────────────────────────
  // Format: "Authorization: Bearer eyJhbGciOi..."
  // This is the standard for REST APIs and mobile apps.
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7); // Remove "Bearer " prefix
  }

  // ─────────────────────────────────────────────────────
  // METHOD 2: Cookie (fallback for browser-based flows)
  // ─────────────────────────────────────────────────────
  // Useful when the frontend prefers httpOnly cookies for
  // XSS protection (JavaScript can't read httpOnly cookies).
  //
  // req.cookies is populated by cookie-parser middleware.
  const cookieToken = req.cookies?.token;
  if (cookieToken && typeof cookieToken === 'string') {
    return cookieToken;
  }

  // No token found in either location
  return null;
}

// ============================================================
// GET TOKEN EXPIRY TIME IN SECONDS (for cookie maxAge)
// ============================================================
// Parses the JWT_EXPIRES_IN string (e.g., '7d', '2h') and returns
// the equivalent number of MILLISECONDS. Useful for setting cookie
// maxAge to match the token expiry exactly.
//
// Supports: <number>s (seconds), <number>m (minutes),
//           <number>h (hours), <number>d (days)
// ============================================================
export function getTokenExpiryMs(): number {
  const value = JWT_EXPIRES_IN.trim();
  const match = value.match(/^(\d+)([smhd])$/);

  if (!match) {
    // Fallback to 7 days if format is unrecognized
    logger.warn(`⚠️ [JWT] Could not parse JWT_EXPIRES_IN "${JWT_EXPIRES_IN}", defaulting to 7 days`);
    return 7 * 24 * 60 * 60 * 1000;
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
}