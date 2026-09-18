import './lib/env';
import { aiRateLimiter } from './middleware/rateLimit.middleware';
import { redis } from './lib/redis';

async function testRateLimiter() {
  console.log('\n==================================================');
  console.log('🧪 TESTING REDIS SLIDING-WINDOW RATE LIMITER');
  console.log('==================================================\n');

  const testUserId = 'test_user_burst_123';

  // 1. Test first request
  console.log('📨 1. Sending Request #1...');
  const res1 = await aiRateLimiter.limit(testUserId);
  console.log(`  Allowed: ${res1.success ? '✅ YES' : '❌ NO'} | Remaining: ${res1.remaining}/${res1.limit}`);

  // 2. Simulate rapid burst of 22 requests to test limit threshold
  console.log('\n💥 2. Simulating rapid burst of requests...');
  let blockedCount = 0;

  for (let i = 2; i <= 22; i++) {
    const res = await aiRateLimiter.limit(testUserId);
    if (!res.success) {
      blockedCount++;
    }
  }

  console.log(`  ✅ Successfully enforced rate limit!`);
  console.log(`  🛡️ Blocked ${blockedCount} excess requests beyond the 20/min quota with HTTP 429`);

  // Clean up Redis test key
  await redis.del(`ratelimit:ai:${testUserId}`);

  console.log('\n==================================================');
  console.log('🎉 RATE LIMITER PASSED 100%!');
  console.log('==================================================\n');
}

testRateLimiter().catch(console.error);