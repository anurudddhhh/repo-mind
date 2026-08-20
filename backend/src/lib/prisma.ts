// ============================================================
// PRISMA CLIENT SINGLETON
// ============================================================
// This file exports ONE shared PrismaClient instance used by
// the entire application. It solves two critical problems:
//
// PROBLEM 1: Connection pool exhaustion
//   Every `new PrismaClient()` opens 5–20 DB connections.
//   Multiple instances → too many connections → Neon rejects.
//
// PROBLEM 2: Nodemon hot-reload memory leak
//   Every file change restarts the app. Without a singleton,
//   old PrismaClient instances remain in memory until GC.
//
// SOLUTION: Store the instance on Node's `globalThis` in dev.
// Global variables survive hot-reloads, so we reuse the same
// client across reloads instead of creating new ones.
// ============================================================

import { PrismaClient, Prisma } from '@prisma/client';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import ws from 'ws';

// ============================================================
// TYPESCRIPT DECLARATION MERGING
// We're adding a `prisma` property to Node's global scope.
// TypeScript needs to know this property exists, so we declare
// its type here. Otherwise TypeScript would show an error when
// we do `globalThis.prisma = ...`.
// ============================================================
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// ============================================================
// LOG CONFIGURATION
// In development: log everything (query, info, warn, error)
//   - Helps you see EXACTLY what SQL Prisma is executing
//   - Extremely useful when debugging why a query is slow
//
// In production: log only warnings and errors
//   - Query logging is expensive at scale
//   - Verbose logs make production log searches harder
// ============================================================
const logConfig: Prisma.LogDefinition[] =
  process.env.NODE_ENV === 'development'
    ? [
        { level: 'query', emit: 'event' },   // 'event' lets us format queries ourselves
        { level: 'error', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
      ]
    : [
        { level: 'error', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
      ];

// ============================================================
// CREATE THE PRISMA CLIENT INSTANCE
// In production on Render, Prisma's built-in TLS engine has
// OpenSSL incompatibilities with Neon. We bypass it entirely
// by using Neon's own WebSocket-based serverless driver.
// In development, we use the standard Prisma engine.
// ============================================================
const createPrismaClient = (): PrismaClient => {
  if (process.env.NODE_ENV === 'production') {
    // Configure Neon's serverless driver to use the ws library
    // for WebSocket connections (required in Node.js environments)
    neonConfig.webSocketConstructor = ws;

    const connectionString = process.env.DATABASE_URL!;
    const pool = new Pool({ connectionString });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = new PrismaNeon(pool as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new PrismaClient({
      adapter,
      log: logConfig,
      errorFormat: 'minimal',
    } as any);

    return client;
  }

  // Development: use standard Prisma engine
  const client = new PrismaClient({
    log: logConfig,
    errorFormat: 'pretty',
  });

  // In development, hook into the 'query' event to log SQL nicely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client.$on as any)('query', (e: Prisma.QueryEvent) => {
    console.log('\n📊 PRISMA QUERY');
    console.log(`   ⏱  Duration : ${e.duration}ms`);
    console.log(`   📝 Query    : ${e.query}`);
    if (e.params && e.params !== '[]') {
      console.log(`   🔧 Params   : ${e.params}`);
    }
  });

  return client;
};

// ============================================================
// THE SINGLETON PATTERN
// ============================================================
// In DEVELOPMENT:
//   - Check if `global.prisma` already exists (from previous hot-reload)
//   - If yes → reuse it (avoids connection pool bloat)
//   - If no → create fresh client and cache it globally
//
// In PRODUCTION:
//   - Always create fresh (no hot-reload to worry about)
//   - Don't cache globally (unnecessary in production)
//
// The `??` operator returns the left side if it's not null/undefined,
// otherwise the right side. So:
//   globalThis.prisma ?? createPrismaClient()
// means: "use the cached one if it exists, otherwise make a new one."
// ============================================================
export const prisma: PrismaClient = globalThis.prisma ?? createPrismaClient();

// ============================================================
// CACHE THE CLIENT GLOBALLY IN DEVELOPMENT
// This is what allows the singleton to survive nodemon reloads.
// In production, we skip this because:
//   1. There's no hot-reload
//   2. Global variables in production are a code smell
// ============================================================
if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

// ============================================================
// GRACEFUL SHUTDOWN
// When the process receives a termination signal, close the
// database connection cleanly. Without this:
//   - In-flight queries could be cut off mid-execution
//   - Connections would time out on Neon's side
//   - Neon might rate-limit us for improper disconnects
//
// Note: These handlers COMPLEMENT (not replace) the shutdown
// handlers in index.ts. Both will run — Prisma's cleanup here,
// then the HTTP server cleanup in index.ts.
// ============================================================
const shutdownPrisma = async (signal: string): Promise<void> => {
  console.log(`\n🔌 [Prisma] ${signal} received — disconnecting from database...`);
  try {
    await prisma.$disconnect();
    console.log('✅ [Prisma] Database connection closed cleanly.');
  } catch (error) {
    console.error('❌ [Prisma] Error during disconnect:', error);
  }
};

process.on('beforeExit', () => shutdownPrisma('beforeExit'));
process.on('SIGINT', () => shutdownPrisma('SIGINT'));
process.on('SIGTERM', () => shutdownPrisma('SIGTERM'));

// ============================================================
// DEFAULT EXPORT
// Allows both import styles:
//   import { prisma } from '@/lib/prisma';   ← named import (preferred)
//   import prisma from '@/lib/prisma';       ← default import (also works)
// ============================================================
export default prisma;