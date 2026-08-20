// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================
// Provides Express middleware functions that verify JWTs and
// attach the authenticated user to the request object.
//
// USAGE:
//   import { requireAuth } from './auth.middleware';
//   router.get('/protected', requireAuth, handler);
//
// AFTER MIDDLEWARE RUNS:
//   - req.user  → Full user object from database
//   - req.token → The verified JWT payload
//
// SECURITY LAYERS:
//   1. Extract JWT from Authorization header or cookie
//   2. Cryptographically verify signature
//   3. Check token hasn't expired
//   4. Verify user still exists in database
//   5. Attach fresh user data to request
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import { verifyToken, extractTokenFromRequest, AppJwtPayload } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { User as PrismaUser } from '@prisma/client';

// Ensures Express.Request type extensions (req.user, req.token) are available.
// The actual types are declared in @/types/index.ts — the single authoritative
// location. Do NOT redeclare them here.
import '../types';

// ============================================================
// requireAuth — STRICT AUTHENTICATION
// ============================================================
// Use this on routes that REQUIRE a logged-in user.
// Rejects the request with 401 if no valid token is present.
//
// ATTACHES ON SUCCESS:
//   req.user  → Full User object from database
//   req.token → Decoded JWT payload
//
// EXAMPLE:
//   router.get('/api/repositories', requireAuth, listRepositories);
// ============================================================
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // ─────────────────────────────────────────────────────
    // STEP 1: Extract JWT from request
    // ─────────────────────────────────────────────────────
    const token = extractTokenFromRequest(req);

    if (!token) {
      logger.debug('🚫 [Auth] No token provided', {
        path: req.path,
        method: req.method,
      });
      res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'No authentication token provided. Please log in.',
      });
      return;
    }

    // ─────────────────────────────────────────────────────
    // STEP 2: Verify JWT signature and expiry
    // ─────────────────────────────────────────────────────
    // verifyToken() throws if the token is invalid/expired.
    // We catch the error and return a clear 401 response.
    let payload: AppJwtPayload;
    try {
      payload = verifyToken(token);
    } catch (error) {
      logger.debug('🚫 [Auth] Token verification failed', {
        path: req.path,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(401).json({
        success: false,
        error: 'Invalid token',
        message: error instanceof Error ? error.message : 'Token verification failed',
      });
      return;
    }

    // ─────────────────────────────────────────────────────
    // STEP 3: Verify user still exists in database
    // ─────────────────────────────────────────────────────
    // Why? A user might have been deleted after their token was
    // issued. If we skip this check, deleted users could still
    // access the API until their token expires.
    //
    // Optimization: In high-traffic apps, cache this lookup in
    // Redis for 5 min to avoid a DB hit on every request.
    // For MVP, direct DB lookup is fine.
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      logger.warn('🚫 [Auth] Token valid but user not found in DB', {
        userId: payload.userId,
      });
      res.status(401).json({
        success: false,
        error: 'User not found',
        message: 'Your account no longer exists. Please log in again.',
      });
      return;
    }

    // ─────────────────────────────────────────────────────
    // STEP 4: Attach user and token to request
    // ─────────────────────────────────────────────────────
    // Now any route handler running after this middleware can
    // access req.user with full TypeScript type safety.
    req.user = user;
    req.token = payload;

    logger.debug('✅ [Auth] User authenticated', {
      userId: user.id,
      username: user.username,
      path: req.path,
    });

    // ─────────────────────────────────────────────────────
    // STEP 5: Pass control to the next middleware/handler
    // ─────────────────────────────────────────────────────
    next();
  } catch (error) {
    // Catch-all for unexpected errors (DB down, etc.)
    logger.error('❌ [Auth] Unexpected error in requireAuth', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      path: req.path,
    });
    res.status(500).json({
      success: false,
      error: 'Authentication error',
      message: 'An internal error occurred during authentication.',
    });
  }
}

// ============================================================
// optionalAuth — LENIENT AUTHENTICATION
// ============================================================
// Use this on routes that work FOR BOTH logged-in and anonymous
// users, but behave differently for each.
//
// If a valid token is present → attach user to req
// If no token or invalid token → set req.user = undefined, continue
//
// EXAMPLE USE CASES:
//   - Public repo view that shows extra info for owner
//   - Homepage that greets logged-in users differently
//
// This is here for future flexibility — MVP mainly uses requireAuth.
// ============================================================
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractTokenFromRequest(req);

    // No token at all? Continue as anonymous user.
    if (!token) {
      req.user = undefined;
      req.token = undefined;
      return next();
    }

    // Try to verify — but don't fail the request if invalid
    try {
      const payload = verifyToken(token);
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (user) {
        req.user = user;
        req.token = payload;
      }
    } catch {
      // Silently ignore invalid tokens — treat as anonymous
      req.user = undefined;
      req.token = undefined;
    }

    next();
  } catch (error) {
    // Even on unexpected errors, don't block the request
    logger.error('❌ [Auth] Error in optionalAuth', {
      error: error instanceof Error ? error.message : String(error),
    });
    next();
  }
}

// ============================================================
// requireOwnership — RESOURCE-LEVEL AUTHORIZATION
// ============================================================
// A HIGHER-ORDER FUNCTION that returns middleware. Verifies the
// authenticated user OWNS the resource they're trying to access.
//
// Prevents User A from accessing User B's repositories, chats, etc.
//
// USAGE:
//   router.get(
//     '/api/repositories/:id',
//     requireAuth,
//     requireOwnership('repository', 'id'),
//     getRepository
//   );
//
// PARAMETERS:
//   - resourceType: 'repository' | 'chatSession'
//   - paramName:    The URL parameter containing the resource ID
//
// This is here for future protection when we build repo/chat routes.
// ============================================================
type OwnableResource = 'repository' | 'chatSession';

export function requireOwnership(resourceType: OwnableResource, paramName: string = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Must run AFTER requireAuth
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
          message: 'requireOwnership must be used after requireAuth',
        });
        return;
      }

      const resourceId = req.params[paramName];

      if (!resourceId) {
        res.status(400).json({
          success: false,
          error: 'Missing resource ID',
          message: `URL parameter "${paramName}" is required`,
        });
        return;
      }

      // Look up the resource and check ownership
      let isOwner = false;

      if (resourceType === 'repository') {
        const repo = await prisma.repository.findUnique({
          where: { id: resourceId },
          select: { userId: true },
        });
        isOwner = repo?.userId === req.user.id;
      } else if (resourceType === 'chatSession') {
        const session = await prisma.chatSession.findUnique({
          where: { id: resourceId },
          select: { userId: true },
        });
        isOwner = session?.userId === req.user.id;
      }

      if (!isOwner) {
        logger.warn('🚫 [Auth] Ownership check failed', {
          userId: req.user.id,
          resourceType,
          resourceId,
        });
        res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: `You do not have permission to access this ${resourceType}.`,
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('❌ [Auth] Error in requireOwnership', {
        error: error instanceof Error ? error.message : String(error),
        resourceType,
      });
      res.status(500).json({
        success: false,
        error: 'Authorization error',
        message: 'An internal error occurred during authorization check.',
      });
    }
  };
}