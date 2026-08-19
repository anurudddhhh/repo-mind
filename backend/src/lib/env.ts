// ============================================================
// ENVIRONMENT LOADER — Must be imported FIRST in index.ts
// ============================================================
// This file has ZERO imports except dotenv itself, so it can
// be safely imported at the top of index.ts BEFORE any file
// that reads process.env variables (like redis.ts, prisma.ts).
//
// WHY THIS EXISTS:
//   ES6 `import` statements are hoisted — they all run before
//   any regular code in the file. So even if dotenv.config()
//   is written above other imports, those imports still execute
//   first if they don't depend on dotenv.
//
//   By putting dotenv.config() inside an imported file that
//   has NO other dependencies, we guarantee it runs before
//   any other module can access process.env.
// ============================================================

import dotenv from 'dotenv';
import path from 'path';

// Resolve absolute path to the root .env file
// __dirname = D:\repo-mind\backend\src\lib
// ../../../.env = D:\repo-mind\.env
const envPath = path.resolve(__dirname, '../../../.env');

const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error(`❌ Failed to load .env file from: ${envPath}`);
  console.error(`   Error: ${result.error.message}`);
  process.exit(1);
}

console.log(`✅ Environment variables loaded from: ${envPath}`);