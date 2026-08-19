// ============================================================
// ENV LOADER — Preloads .env before any TypeScript compiles
// ============================================================
// This file is required via node's -r flag in package.json:
//   ts-node -r ./env-loader.js -r tsconfig-paths/register src/index.ts
//
// Node.js runs this BEFORE ts-node starts compiling TypeScript,
// which guarantees process.env is fully populated before any
// application code executes.
//
// This is the industry-standard pattern for handling env vars
// with ts-node on complex path-aliased projects.
// ============================================================

const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error(`❌ [env-loader] Failed to load .env from: ${envPath}`);
  console.error(`   Error: ${result.error.message}`);
  process.exit(1);
}

console.log(`✅ [env-loader] Loaded .env from: ${envPath}`);