// ============================================================
// PRISMA CLIENT SINGLETON
// ============================================================
// This file exports ONE shared PrismaClient instance used by
// the entire application. Uses the "binary" engine type
// (set in schema.prisma) which is compatible with Neon on Render.
// ============================================================

import { PrismaClient, Prisma } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const logConfig: Prisma.LogDefinition[] =
  process.env.NODE_ENV === 'development'
    ? [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
      ]
    : [
        { level: 'error', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
      ];

const createPrismaClient = (): PrismaClient => {
  const client = new PrismaClient({
    log: logConfig,
    errorFormat: process.env.NODE_ENV === 'development' ? 'pretty' : 'minimal',
  });

  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.$on as any)('query', (e: Prisma.QueryEvent) => {
      console.log('\n📊 PRISMA QUERY');
      console.log(`   ⏱  Duration : ${e.duration}ms`);
      console.log(`   📝 Query    : ${e.query}`);
      if (e.params && e.params !== '[]') {
        console.log(`   🔧 Params   : ${e.params}`);
      }
    });
  }

  return client;
};

export const prisma: PrismaClient = globalThis.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

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

export default prisma;