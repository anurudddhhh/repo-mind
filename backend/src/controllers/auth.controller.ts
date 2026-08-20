// ============================================================
// AUTHENTICATION CONTROLLER
// ============================================================
// Contains the business logic for all auth-related endpoints.
// Called by auth.routes.ts, which wires HTTP paths to these functions.
//
// ENDPOINTS HANDLED:
//   githubCallback  → After GitHub OAuth succeeds, issue JWT + redirect
//   getMe           → Return the currently authenticated user's info
//   logout          → Clear the JWT cookie
//
// NOTE: The initial /github redirect is handled directly by Passport
// middleware (no controller function needed — Passport does it all).
// ============================================================

import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { generateToken, getTokenExpiryMs } from '../lib/jwt';
import { logger } from '../lib/logger';

// Ensures Express.Request type extensions (req.user, req.token) are available.
// The actual types are declared in @/types/index.ts.
import '@/types';

// ============================================================
// ENVIRONMENT VARIABLES
// ============================================================
let FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
if (!FRONTEND_URL.startsWith('http://') && !FRONTEND_URL.startsWith('https://')) {
  FRONTEND_URL = `https://${FRONTEND_URL}`;
}
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============================================================
// COOKIE CONFIGURATION
// ============================================================
// Consistent cookie settings used when setting/clearing JWT cookies.
// Centralized here so we don't accidentally use mismatched settings
// (which would prevent the browser from properly deleting the cookie).
// ============================================================
const JWT_COOKIE_NAME = 'token';

const getCookieOptions = () => ({
  // httpOnly: JavaScript on the frontend CANNOT read this cookie.
  // This is critical XSS protection. If an attacker injects JS,
  // they can't steal the token.
  httpOnly: true,

  // secure: In production, only send this cookie over HTTPS.
  // In development (http://localhost), this must be false or the
  // browser won't set the cookie at all.
  secure: NODE_ENV === 'production',

  // sameSite: Controls when the cookie is sent with cross-site requests.
  //   'strict' → Never sent from other sites (best security)
  //   'lax'    → Sent on top-level navigations (needed for OAuth redirects)
  //   'none'   → Always sent (least secure, needs secure:true)
  // We use 'lax' because OAuth redirects come from github.com to us.
  sameSite: 'lax' as const,

  // maxAge: How long the cookie lives (matches JWT expiry)
  maxAge: getTokenExpiryMs(),

  // path: Cookie is sent for ALL paths on this domain
  path: '/',
});

// ============================================================
// CONTROLLER: githubCallback
// ============================================================
// Called by Express AFTER Passport has successfully authenticated
// the user via GitHub OAuth. At this point:
//   - Passport has already created/updated the user in our DB
//   - req.user contains the full User object (from passport.ts verify callback)
//
// OUR JOB:
//   1. Generate a JWT for this user
//   2. Set it as an httpOnly cookie
//   3. Also pass it in the URL for the frontend to store in localStorage
//      (this dual approach = works whether frontend uses cookies OR headers)
//   4. Redirect the user to the frontend's post-login page
//
// FLOW:
//   User → GitHub → GET /api/auth/github/callback?code=...
//     → Passport exchanges code for token
//     → Passport calls verifyGithubUser (in passport.ts)
//     → verifyGithubUser creates/updates User in DB
//     → Passport attaches user to req.user
//     → This function runs
//     → Redirects to http://localhost:3000/auth/success?token=...
// ============================================================
export async function githubCallback(req: Request, res: Response): Promise<void> {
  try {
    // Passport attaches the user to req.user after successful OAuth.
    // If req.user is missing, something went wrong during OAuth.
    if (!req.user) {
      logger.error('❌ [Auth] githubCallback called without req.user');
      res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
      return;
    }

    const user = req.user;

    // ─────────────────────────────────────────────────────
    // STEP 1: Generate JWT
    // ─────────────────────────────────────────────────────
    const token = generateToken(user);

    // ─────────────────────────────────────────────────────
    // STEP 2: Set httpOnly cookie
    // ─────────────────────────────────────────────────────
    res.cookie(JWT_COOKIE_NAME, token, getCookieOptions());

    logger.info('✅ [Auth] User login successful via GitHub OAuth', {
      userId: user.id,
      username: user.username,
    });

    // ─────────────────────────────────────────────────────
    // STEP 3: Redirect to frontend with token in URL
    // ─────────────────────────────────────────────────────
    const safeUser = {
      id: user.id,
      githubId: user.githubId.toString(),
      username: user.username,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };
    
    const redirectUrl = `${FRONTEND_URL}/auth/success?token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify(safeUser))}`;

    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('❌ [Auth] Error in githubCallback', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // On error, send user back to login page with an error flag
    res.redirect(`${FRONTEND_URL}/login?error=server_error`);
  }
}

// ============================================================
// CONTROLLER: getMe
// ============================================================
// Returns the currently authenticated user's info.
// Used by the frontend to:
//   - Verify a stored JWT is still valid
//   - Get up-to-date user data (in case name/avatar changed on GitHub)
//   - Show user profile info in the UI
//
// AUTH: Requires valid JWT (enforced by requireAuth middleware)
//
// RESPONSE:
//   {
//     "success": true,
//     "user": { id, username, email, name, avatarUrl, ... }
//   }
// ============================================================
export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    // req.user is guaranteed by requireAuth middleware
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    // Return user data (excluding sensitive fields like accessToken)
    // We DO NOT expose accessToken — that's for server-side GitHub API calls only
    const safeUser = {
      id: req.user.id,
      githubId: req.user.githubId.toString(), // BigInt → string for JSON
      username: req.user.username,
      email: req.user.email,
      name: req.user.name,
      avatarUrl: req.user.avatarUrl,
      createdAt: req.user.createdAt,
      lastLoginAt: req.user.lastLoginAt,
    };

    res.json({
      success: true,
      user: safeUser,
    });
  } catch (error) {
    logger.error('❌ [Auth] Error in getMe', {
      userId: req.user?.id,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user data',
    });
  }
}

// ============================================================
// CONTROLLER: logout
// ============================================================
// Logs the user out by clearing the JWT cookie.
//
// NOTE: Because JWTs are stateless, there's no server-side "session"
// to invalidate. The token remains valid until it expires. This is
// a known JWT tradeoff.
//
// If you need to invalidate tokens before their natural expiry
// (e.g., after password change or "logout everywhere"), you'd need
// a token blacklist in Redis. That's a Phase 2 feature — for MVP,
// we simply clear the cookie so this browser session forgets the token.
//
// AUTH: Optionally checks req.user for logging purposes.
//       Doesn't strictly require auth — logging out an already
//       logged-out user should still succeed silently.
// ============================================================
export async function logout(req: Request, res: Response): Promise<void> {
  try {
    // Log who's logging out (if we can tell)
    if (req.user) {
      logger.info('👋 [Auth] User logged out', {
        userId: req.user.id,
        username: req.user.username,
      });
    }

    // Clear the JWT cookie
    // IMPORTANT: Cookie clearing requires SAME options as when it was set.
    // If maxAge/path/sameSite differ, browser won't recognize/clear it.
    res.clearCookie(JWT_COOKIE_NAME, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('❌ [Auth] Error in logout', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: 'Logout failed',
    });
  }
}

// ============================================================
// CONTROLLER: authFailure
// ============================================================
// Called by Passport when authentication FAILS at any point.
// This is a fallback for when Passport can't complete OAuth
// (user denied access, GitHub API error, etc.)
// ============================================================
export function authFailure(_req: Request, res: Response): void {
  logger.warn('⚠️ [Auth] GitHub OAuth failed — user denied access or error occurred');
  res.redirect(`${FRONTEND_URL}/login?error=auth_failed`);
}