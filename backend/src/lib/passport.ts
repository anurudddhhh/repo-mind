// ============================================================
// PASSPORT GITHUB OAUTH STRATEGY
// ============================================================
// Configures Passport with the GitHub OAuth 2.0 strategy.
// Handles the exchange of authorization codes for access tokens
// and the creation/updating of users in our database.
//
// This file EXPORTS a configured passport instance.
// It is IMPORTED and INITIALIZED in index.ts.
// It is USED via authentication routes in auth.routes.ts (Step 20).
//
// FLOW SUMMARY:
//   1. User clicks "Login with GitHub" on our frontend
//   2. Backend redirects to GitHub's authorization page
//   3. User approves → GitHub redirects back to our callback URL
//   4. Passport exchanges the code for a GitHub access token
//   5. Passport calls the "verify function" defined below
//   6. Verify function creates/updates user in our database
//   7. User object is attached to req.user for the route handler
// ============================================================

import passport from 'passport';
import { Strategy as GitHubStrategy, Profile } from 'passport-github2';
import { prisma } from './prisma';
import { logger } from './logger';
import type { User } from '@prisma/client';

// ============================================================
// ENVIRONMENT VARIABLE VALIDATION
// Fail fast at startup if OAuth credentials are missing.
// A missing credential in production = broken login for everyone.
// ============================================================
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL;

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_CALLBACK_URL) {
  logger.error('❌ [Passport] Missing GitHub OAuth credentials in .env', {
    hasClientId: !!GITHUB_CLIENT_ID,
    hasClientSecret: !!GITHUB_CLIENT_SECRET,
    hasCallbackUrl: !!GITHUB_CALLBACK_URL,
  });
  throw new Error(
    'GitHub OAuth configuration is incomplete. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and GITHUB_CALLBACK_URL in .env'
  );
}

// ============================================================
// OAUTH SCOPES
// Scopes control what data GitHub allows us to access on the
// user's behalf. Request the MINIMUM scopes needed — asking for
// too many will scare users away.
//
// - 'user:email'   → Read user's email addresses (public + private)
// - 'read:user'    → Read profile info (name, avatar, bio)
// - 'repo'         → Full access to public AND private repositories
//                    (needed because Repo-Mind must index private repos)
//
// If we only wanted public repos, we could use 'public_repo' instead.
// ============================================================
const GITHUB_SCOPES = ['user:email', 'read:user', 'repo'];

// ============================================================
// THE VERIFY CALLBACK
// ============================================================
// This is the CRITICAL function Passport calls after GitHub
// authenticates the user. It receives:
//   - accessToken  → Used to call GitHub API on user's behalf
//   - refreshToken → Not used by GitHub OAuth (empty string)
//   - profile      → User's GitHub data (id, username, email, avatar)
//   - done         → Callback: done(null, user) on success
//                              done(error) on failure
//                              done(null, false) on rejection
//
// OUR JOB HERE:
//   1. Extract user info from the GitHub profile
//   2. Look up user in our DB by their GitHub ID
//   3. If found → update their info (name/avatar might have changed)
//   4. If not found → create a new user record
//   5. Return the user via done(null, user)
// ============================================================
const verifyGithubUser = async (
  accessToken: string,
  _refreshToken: string,
  profile: Profile,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  done: (error: Error | null, user?: User | false) => void
): Promise<void> => {
  try {
    logger.info('🔐 [Auth] GitHub OAuth callback received', {
      githubId: profile.id,
      username: profile.username,
    });

    // ─────────────────────────────────────────────────────
    // STEP 1: Extract fields from GitHub profile
    // ─────────────────────────────────────────────────────
    // GitHub returns emails as an array of objects like:
    //   [{ value: 'user@example.com', primary: true, verified: true }]
    // We pick the primary email if available, else first, else null.
    const primaryEmail = profile.emails?.find((e) => (e as { primary?: boolean }).primary)?.value
      ?? profile.emails?.[0]?.value
      ?? null;

    // Avatar URL is inside the photos array
    const avatarUrl = profile.photos?.[0]?.value ?? null;

    // GitHub's user ID is a STRING in profile.id but numeric on their servers.
    // We store as BigInt because IDs can exceed 2^32.
    const githubId = BigInt(profile.id);

    // ─────────────────────────────────────────────────────
    // STEP 2: Upsert user in database
    // ─────────────────────────────────────────────────────
    // `upsert` = update if exists, insert if not.
    // Atomic operation — no race condition even under concurrent logins.
    const user = await prisma.user.upsert({
      // WHERE clause — find by unique githubId
      where: { githubId },

      // If found, UPDATE these fields (in case they changed on GitHub)
      update: {
        username: profile.username || 'unknown',
        email: primaryEmail,
        name: profile.displayName || null,
        avatarUrl,
        accessToken, // ← Refresh the token on every login
        lastLoginAt: new Date(),
      },

      // If NOT found, CREATE a new user with these fields
      create: {
        githubId,
        username: profile.username || 'unknown',
        email: primaryEmail,
        name: profile.displayName || null,
        avatarUrl,
        accessToken,
        lastLoginAt: new Date(),
      },
    });

    logger.info('✅ [Auth] User authenticated successfully', {
      userId: user.id,
      username: user.username,
      isNewUser: user.createdAt.getTime() === user.updatedAt.getTime(),
    });

    // ─────────────────────────────────────────────────────
    // STEP 3: Return user to Passport via done() callback
    // ─────────────────────────────────────────────────────
    // done(error, user):
    //   - First arg is error (null on success)
    //   - Second arg is the user object (attached to req.user)
    done(null, user);
  } catch (error) {
    logger.error('❌ [Auth] GitHub OAuth verification failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      githubId: profile?.id,
    });
    done(error instanceof Error ? error : new Error(String(error)));
  }
};

// ============================================================
// REGISTER THE GITHUB STRATEGY WITH PASSPORT
// ============================================================
// This tells Passport: "when someone uses the 'github' strategy,
// use these settings and this verify function."
//
// The route handler will trigger this via:
//   passport.authenticate('github', { scope: GITHUB_SCOPES })
// ============================================================
passport.use(
  new GitHubStrategy(
    {
      clientID: GITHUB_CLIENT_ID,
      clientSecret: GITHUB_CLIENT_SECRET,
      callbackURL: GITHUB_CALLBACK_URL,
      scope: GITHUB_SCOPES,
    },
    verifyGithubUser
  )
);

// ============================================================
// SESSION SERIALIZATION
// ============================================================
// Passport supports session-based auth (stateful) AND token-based
// auth (stateless via JWT). We use SESSIONS ONLY for the OAuth
// handshake, then IMMEDIATELY switch to JWT for API calls.
//
// serialize:   Called after successful login. Stores minimal data
//              in the session cookie (just the user ID).
//              Small session = less overhead.
//
// deserialize: Called on subsequent requests. Uses the stored user
//              ID to look up the full user object and attach it
//              to req.user.
//
// Why not store the full user in the session?
//   1. Session cookies have a 4KB limit
//   2. If we update the user in DB, cached session data goes stale
//   3. Best practice: session stores IDs, DB stores everything else
// ============================================================
passport.serializeUser((user, done) => {
  // Cast because Passport's types don't know our user shape
  const typedUser = user as User;
  done(null, typedUser.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return done(new Error(`User not found for ID: ${id}`));
    }
    done(null, user);
  } catch (error) {
    logger.error('❌ [Auth] deserializeUser failed', {
      userId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    done(error instanceof Error ? error : new Error(String(error)));
  }
});

// ============================================================
// EXPORT THE CONFIGURED PASSPORT INSTANCE
// ============================================================
// index.ts will import this and register it as middleware.
// ============================================================
export default passport;