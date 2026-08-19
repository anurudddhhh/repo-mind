// ============================================================
// ENVIRONMENT LOADER (safety net)
// ============================================================
// Env vars are now loaded via env-loader.js in the npm scripts.
// This file exists as a backup + import point for TypeScript files.
// ============================================================

// Verify env vars were loaded (should always pass at this point)
if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
  console.error('❌ Critical environment variables are missing.');
  console.error('   Ensure env-loader.js runs before this file.');
  process.exit(1);
}