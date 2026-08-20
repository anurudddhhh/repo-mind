// ============================================================
// AUTHENTICATION ROUTES
// ============================================================
// Maps URL paths to authentication controller functions.
// This file is PURE WIRING — no business logic lives here.
//
// All routes are mounted under /api/auth in index.ts, so:
//   router.get('/github') → GET /api/auth/github
//   router.get('/me')     → GET /api/auth/me
//   ...etc.
//
// ROUTE MAP:
//   GET  /api/auth/github           → Redirect to GitHub OAuth
//   GET  /api/auth/github/callback  → Handle GitHub's response
//   GET  /api/auth/me               → Get current user info
//   POST /api/auth/logout           → Log out (clear cookie)
//   GET  /api/auth/failure          → OAuth failure handler
// ============================================================

import { Router } from 'express';
import passport from 'passport';

// Controller functions — contain the actual business logic
import { githubCallback, getMe, logout, authFailure } from '../controllers/auth.controller';

// Middleware — checks JWT and attaches user to req
import { requireAuth } from '../middleware/auth.middleware';

// ============================================================
// CREATE THE ROUTER
// ============================================================
// Router() creates a mini Express application that can have its
// own set of routes. Think of it as a "sub-app" that we'll plug
// into the main app later with app.use('/api/auth', authRouter).
//
// Why use Router() instead of putting routes directly on `app`?
//   1. Organization — auth routes grouped in one file
//   2. Reusability  — can mount the same router on different prefixes
//   3. Testability  — can test routes in isolation
// ============================================================
const authRouter = Router();

// ============================================================
// ROUTE 1: GET /api/auth/github
// ============================================================
// PURPOSE: Start the GitHub OAuth flow.
//
// WHAT HAPPENS WHEN USER HITS THIS ROUTE:
//   1. passport.authenticate('github', ...) intercepts the request
//   2. Passport generates a GitHub authorization URL with our client_id
//   3. Passport REDIRECTS the user's browser to:
//      https://github.com/login/oauth/authorize?client_id=...&scope=...
//   4. The user sees GitHub's "Authorize this app?" page
//   5. No controller function is needed — Passport does everything
//
// The { scope } option tells GitHub what permissions we need.
// These must match the scopes defined in passport.ts.
// ============================================================
authRouter.get(
  '/github',
  passport.authenticate('github', {
    scope: ['user:email', 'read:user', 'repo'],
  })
);

// ============================================================
// ROUTE 2: GET /api/auth/github/callback
// ============================================================
// PURPOSE: Handle GitHub's response after the user authorizes us.
//
// WHAT HAPPENS:
//   1. After user clicks "Authorize" on GitHub, their browser is
//      redirected to: /api/auth/github/callback?code=XXXXXX
//   2. passport.authenticate('github') intercepts this request
//   3. Passport takes the ?code= and exchanges it with GitHub for
//      an access token (server-to-server call, invisible to user)
//   4. Passport calls our verifyGithubUser function (in passport.ts)
//   5. verifyGithubUser creates/updates user in DB
//   6. Passport attaches the user to req.user
//   7. If success → calls githubCallback controller (next handler)
//   8. If failure → redirects to /api/auth/failure
//
// failureRedirect: Where to send user if OAuth fails at any step.
//   This covers: user denied access, GitHub API error, our DB error.
// ============================================================
authRouter.get(
  '/github/callback',
  passport.authenticate('github', {
    failureRedirect: '/api/auth/failure',
    // session: false would skip session entirely, but we need it
    // briefly for the OAuth state parameter verification.
    // After this route, we switch to JWT (stateless).
  }),
  // This handler ONLY runs if Passport successfully authenticated.
  // At this point, req.user is populated with our DB user object.
  githubCallback
);

// ============================================================
// ROUTE 3: GET /api/auth/me
// ============================================================
// PURPOSE: Return the currently authenticated user's profile.
//
// MIDDLEWARE CHAIN:
//   requireAuth → verifies JWT → attaches req.user → getMe runs
//
// Used by the frontend on app load to check:
//   "Do I have a valid token? If yes, who am I?"
//
// If the JWT is invalid/expired/missing, requireAuth returns 401
// and getMe never runs.
// ============================================================
authRouter.get('/me', requireAuth, getMe);

// ============================================================
// ROUTE 4: POST /api/auth/logout
// ============================================================
// PURPOSE: Log the user out by clearing the JWT cookie.
//
// WHY POST instead of GET?
//   - GET requests should be "safe" (no side effects)
//   - Logout has a side effect (clearing the cookie)
//   - Using POST prevents accidental logout via browser prefetch
//     or link crawlers hitting the URL
//
// No auth middleware required — logging out should always succeed,
// even if the token has already expired.
// ============================================================
authRouter.post('/logout', logout);

// ============================================================
// ROUTE 5: GET /api/auth/failure
// ============================================================
// PURPOSE: Handle OAuth failure scenarios.
//
// This is the failureRedirect target from the callback route.
// When GitHub OAuth fails (user denied, API error, etc.),
// Passport redirects here instead of calling githubCallback.
//
// Our authFailure controller redirects to the frontend login
// page with an error query parameter.
// ============================================================
authRouter.get('/failure', authFailure);

// ============================================================
// EXPORT THE ROUTER
// ============================================================
// index.ts will import this and mount it:
//   app.use('/api/auth', authRouter);
// ============================================================
export default authRouter;
