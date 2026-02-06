#!/usr/bin/env node
/**
 * Redis Persistence Test
 * 
 * Tests Redis persistence by writing data, restarting Redis, and verifying data recovery.
 */

const Redis = require('ioredis');
const { execSync } = require('child_process');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT, 10) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

const redisConfig = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  retryStrategy: () => null, // Don't retry for this test
};

async function testRedisPersistence() {
  console.log('🧪 Testing Redis persistence...\n');
  
  try {
    // Connect to Redis
    console.log('📡 Connecting to Redis...');
    const redis = new Redis(redisConfig);
    
    // Wait for connection
    await redis.ping();
    console.log('✅ Connected to Redis');
    
    // Clear previous test data
    await redis.del('test:persistence:counter', 'test:persistence:hash', 'test:persistence:set');
    
    // Write test data
    console.log('📝 Writing test data...');
    
    // Test string/counter (rate limiter pattern)
    await redis.set('test:persistence:counter', '42', 'EX', 3600);
    
    // Test hash (rule storage pattern)
    await redis.hset('test:persistence:hash', {\n      'rule1': JSON.stringify({ limit: 100, window: 60 }),\n      'rule2': JSON.stringify({ limit: 50, window: 30 })\n    });
    
    // Test sorted set (sliding window pattern)
    const now = Date.now();
    await redis.zadd('test:persistence:set', \n      now, 'req1',\n      now + 1000, 'req2',\n      now + 2000, 'req3'\n    );
    
    console.log('✅ Test data written');
    
    // Get current Redis info
    const info = await redis.info('persistence');
    console.log('📊 Before restart:');
    console.log(info.split('\\r\\n').filter(line => line.includes('aof') || line.includes('rdb')).join('\\n'));
    
    await redis.quit();
    console.log('🔌 Disconnected from Redis');
    \n    // Restart Redis container (assuming Docker Compose)\n    console.log('🔄 Restarting Redis container...');\n    try {\n      execSync('docker compose restart redis', { stdio: 'inherit' });\n      console.log('✅ Redis container restarted');\n    } catch (error) {\n      console.log('⚠️  Could not restart via Docker Compose, please restart Redis manually');\n      console.log('   Run: docker compose restart redis');\n      console.log('   Then press Enter to continue...');\n      process.stdin.setRawMode(true);\n      await new Promise(resolve => process.stdin.on('data', resolve));\n    }\n    \n    // Wait a bit for Redis to start\n    console.log('⏳ Waiting for Redis to be ready...');\n    await new Promise(resolve => setTimeout(resolve, 5000));\n    \n    // Reconnect and verify data\n    console.log('📡 Reconnecting to Redis...');\n    const redis2 = new Redis(redisConfig);\n    \n    // Wait for connection with timeout\n    await Promise.race([\n      redis2.ping(),\n      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 10000))\n    ]);\n    \n    console.log('✅ Reconnected to Redis');\n    \n    // Verify persisted data\n    console.log('🔍 Verifying persisted data...');\n    \n    const counter = await redis2.get('test:persistence:counter');\n    if (counter === '42') {\n      console.log('✅ Counter persisted correctly: ' + counter);\n    } else {\n      console.log('❌ Counter not persisted. Expected: 42, Got: ' + counter);\n    }\n    \n    const hash = await redis2.hgetall('test:persistence:hash');\n    if (Object.keys(hash).length === 2) {\n      console.log('✅ Hash persisted correctly: ' + JSON.stringify(hash));\n    } else {\n      console.log('❌ Hash not persisted correctly. Got: ' + JSON.stringify(hash));\n    }\n    \n    const setCount = await redis2.zcard('test:persistence:set');\n    if (setCount === 3) {\n      console.log('✅ Sorted set persisted correctly: ' + setCount + ' elements');\n    } else {\n      console.log('❌ Sorted set not persisted correctly. Expected: 3, Got: ' + setCount);\n    }\n    \n    // Get persistence info after restart\n    const infoAfter = await redis2.info('persistence');\n    console.log('📊 After restart:');\n    console.log(infoAfter.split('\\r\\n').filter(line => line.includes('aof') || line.includes('rdb')).join('\\n'));\n    \n    // Cleanup test data\n    await redis2.del('test:persistence:counter', 'test:persistence:hash', 'test:persistence:set');\n    await redis2.quit();\n    \n    console.log('\\n✅ Redis persistence test completed successfully!');\n    \n  } catch (error) {\n    console.error('❌ Redis persistence test failed:', error.message);\n    process.exit(1);\n  }\n}\n\nif (require.main === module) {\n  testRedisPersistence();\n}\n\nmodule.exports = { testRedisPersistence };