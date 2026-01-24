#!/usr/bin/env node
/**
 * Manual Integration Testing Script
 * 
 * Tests all API endpoints and validates system behavior
 */

const axios = require('axios');
const chalk = require('chalk');

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

/**
 * Log test result
 */
function logTest(name, passed, details = '') {
  if (passed) {
    console.log(chalk.green(`✓ ${name}`));
    results.passed++;
  } else {
    console.log(chalk.red(`✗ ${name}`));
    if (details) console.log(chalk.gray(`  ${details}`));
    results.failed++;
  }
  results.tests.push({ name, passed, details });
}

/**
 * Test health check endpoints
 */
async function testHealthChecks() {
  console.log(chalk.blue.bold('\n=== Health Check Endpoints ===\n'));

  try {
    // Basic health check
    const health = await axios.get(`${BASE_URL}/health`);
    logTest('GET /health returns 200', health.status === 200);
    logTest('Health response has status field', health.data.status === 'healthy');
    logTest('Health response has uptime', typeof health.data.uptime === 'number');

    // Detailed health check
    const detailed = await axios.get(`${BASE_URL}/health/detailed`);
    logTest('GET /health/detailed returns 200 or 503', [200, 503].includes(detailed.status));
    logTest('Detailed health has components', detailed.data.components !== undefined);
    logTest('Detailed health has Redis status', detailed.data.components.redis !== undefined);
    logTest('Detailed health has memory info', detailed.data.memory !== undefined);

    // Liveness probe
    const liveness = await axios.get(`${BASE_URL}/health/live`);
    logTest('GET /health/live returns 200', liveness.status === 200);
    logTest('Liveness status is alive', liveness.data.status === 'alive');

    // Readiness probe
    const readiness = await axios.get(`${BASE_URL}/health/ready`);
    logTest('GET /health/ready returns 200 or 503', [200, 503].includes(readiness.status));

  } catch (error) {
    logTest('Health checks', false, error.message);
  }
}

/**
 * Test API endpoints
 */
async function testAPIEndpoints() {
  console.log(chalk.blue.bold('\n=== API Endpoints ===\n'));

  try {
    // General data endpoint
    const data = await axios.get(`${BASE_URL}/api/data`);
    logTest('GET /api/data returns 200', data.status === 200);
    logTest('Data endpoint has success flag', data.data.success === true);
    logTest('Data endpoint sets rate limit headers', data.headers['x-ratelimit-limit'] !== undefined);

    // Search endpoint
    const search = await axios.get(`${BASE_URL}/api/search?q=test`);
    logTest('GET /api/search returns 200', search.status === 200);
    logTest('Search accepts query parameter', search.data.data.query === 'test');
    logTest('Search returns results array', Array.isArray(search.data.data.results));

    // Expensive operation
    const expensive = await axios.get(`${BASE_URL}/api/expensive`);
    logTest('GET /api/expensive returns 200', expensive.status === 200);
    logTest('Expensive has computation time', expensive.data.data.computationTime !== undefined);

    // Upload endpoint
    const upload = await axios.post(`${BASE_URL}/api/upload`, {});
    logTest('POST /api/upload returns 200', upload.status === 200);
    logTest('Upload generates file ID', upload.data.data.fileId !== undefined);

    // Status endpoint
    const status = await axios.get(`${BASE_URL}/api/status`);
    logTest('GET /api/status returns 200', status.status === 200);
    logTest('Status shows client info', status.data.data.clientInfo !== undefined);
    logTest('Status shows rate limit info', status.data.data.rateLimit !== undefined);
    logTest('Status lists available presets', status.data.data.availablePresets !== undefined);

  } catch (error) {
    logTest('API endpoints', false, error.message);
  }
}

/**
 * Test rate limiting
 */
async function testRateLimiting() {
  console.log(chalk.blue.bold('\n=== Rate Limiting ===\n'));

  try {
    // Make multiple requests quickly
    const requests = [];
    for (let i = 0; i < 5; i++) {
      requests.push(axios.get(`${BASE_URL}/api/data`));
    }

    const responses = await Promise.all(requests);
    logTest('Multiple requests succeed', responses.every(r => r.status === 200));

    // Check rate limit headers change
    const first = responses[0].headers['x-ratelimit-remaining'];
    const last = responses[responses.length - 1].headers['x-ratelimit-remaining'];
    
    if (first && last) {
      const decreased = parseInt(last) < parseInt(first);
      logTest('Rate limit remaining decreases', decreased);
    } else {
      logTest('Rate limit headers present', false, 'Headers not set (Redis may be down)');
    }

    // Test that requests still work even if Redis is down
    logTest('System handles Redis unavailability gracefully', responses.every(r => r.status === 200));

  } catch (error) {
    if (error.response && error.response.status === 429) {
      logTest('Rate limit enforced (429 response)', true);
    } else {
      logTest('Rate limiting', false, error.message);
    }
  }
}

/**
 * Test error handling
 */
async function testErrorHandling() {
  console.log(chalk.blue.bold('\n=== Error Handling ===\n'));

  try {
    // Test 404
    try {
      await axios.get(`${BASE_URL}/api/nonexistent`);
      logTest('404 for invalid route', false, 'Should have returned 404');
    } catch (error) {
      logTest('404 for invalid route', error.response && error.response.status === 404);
      logTest('404 has error structure', error.response.data.error !== undefined);
    }

    // Test malformed JSON
    try {
      await axios.post(`${BASE_URL}/api/upload`, 'invalid json', {
        headers: { 'Content-Type': 'application/json' }
      });
      logTest('400 for malformed JSON', false, 'Should have returned 400');
    } catch (error) {
      logTest('400 for malformed JSON', error.response && error.response.status === 400);
    }

  } catch (error) {
    logTest('Error handling', false, error.message);
  }
}

/**
 * Test request logging
 */
async function testRequestLogging() {
  console.log(chalk.blue.bold('\n=== Request Logging ===\n'));

  try {
    const response = await axios.get(`${BASE_URL}/api/data`);
    
    logTest('Request ID header present', response.headers['x-request-id'] !== undefined);
    logTest('Request ID is UUID format', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(response.headers['x-request-id']));

    // Make another request to verify unique IDs
    const response2 = await axios.get(`${BASE_URL}/api/data`);
    logTest('Request IDs are unique', response.headers['x-request-id'] !== response2.headers['x-request-id']);

  } catch (error) {
    logTest('Request logging', false, error.message);
  }
}

/**
 * Test Redis failure scenarios
 */
async function testRedisFailure() {
  console.log(chalk.blue.bold('\n=== Redis Failure Scenarios ===\n'));

  try {
    // Check detailed health to see Redis status
    const health = await axios.get(`${BASE_URL}/health/detailed`);
    const redisStatus = health.data.components.redis.status;

    if (redisStatus === 'unhealthy') {
      logTest('System detects Redis unavailability', true);
      logTest('Health shows degraded status', ['degraded', 'unhealthy'].includes(health.data.status));
      
      // Verify requests still work in open mode
      const data = await axios.get(`${BASE_URL}/api/data`);
      logTest('Requests work in open failure mode', data.status === 200);
    } else {
      logTest('Redis is connected', true);
      logTest('Redis ping latency measured', health.data.components.redis.latency !== undefined);
    }

  } catch (error) {
    logTest('Redis failure scenarios', false, error.message);
  }
}

/**
 * Test performance
 */
async function testPerformance() {
  console.log(chalk.blue.bold('\n=== Performance ===\n'));

  try {
    // Health check should be fast
    const healthStart = Date.now();
    await axios.get(`${BASE_URL}/health`);
    const healthTime = Date.now() - healthStart;
    logTest('Health check responds quickly (< 100ms)', healthTime < 100, `${healthTime}ms`);

    // API endpoint should be reasonably fast
    const apiStart = Date.now();
    await axios.get(`${BASE_URL}/api/data`);
    const apiTime = Date.now() - apiStart;
    logTest('API endpoint responds reasonably (< 500ms)', apiTime < 500, `${apiTime}ms`);

    // Test concurrent requests
    const concurrentStart = Date.now();
    await Promise.all([
      axios.get(`${BASE_URL}/api/data`),
      axios.get(`${BASE_URL}/api/search`),
      axios.get(`${BASE_URL}/api/expensive`),
    ]);
    const concurrentTime = Date.now() - concurrentStart;
    logTest('Handles concurrent requests', concurrentTime < 1000, `${concurrentTime}ms`);

  } catch (error) {
    logTest('Performance tests', false, error.message);
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log(chalk.yellow.bold('\n╔════════════════════════════════════════╗'));
  console.log(chalk.yellow.bold('║   Rate Limiter Integration Tests      ║'));
  console.log(chalk.yellow.bold('╚════════════════════════════════════════╝'));
  console.log(chalk.gray(`\nTesting: ${BASE_URL}\n`));

  // Check if server is running
  try {
    await axios.get(`${BASE_URL}/health`);
  } catch (error) {
    console.log(chalk.red.bold('\n✗ Server is not running!'));
    console.log(chalk.gray(`  Make sure the server is running on ${BASE_URL}`));
    console.log(chalk.gray('  Run: npm run dev\n'));
    process.exit(1);
  }

  // Run all test suites
  await testHealthChecks();
  await testAPIEndpoints();
  await testRateLimiting();
  await testErrorHandling();
  await testRequestLogging();
  await testRedisFailure();
  await testPerformance();

  // Print summary
  console.log(chalk.yellow.bold('\n╔════════════════════════════════════════╗'));
  console.log(chalk.yellow.bold('║          Test Summary                  ║'));
  console.log(chalk.yellow.bold('╚════════════════════════════════════════╝\n'));

  const total = results.passed + results.failed;
  const percentage = ((results.passed / total) * 100).toFixed(1);

  console.log(chalk.green(`  Passed: ${results.passed}/${total} (${percentage}%)`));
  console.log(chalk.red(`  Failed: ${results.failed}/${total}`));

  if (results.failed === 0) {
    console.log(chalk.green.bold('\n  ✓ All tests passed!\n'));
    process.exit(0);
  } else {
    console.log(chalk.red.bold('\n  ✗ Some tests failed\n'));
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error(chalk.red.bold('\nTest suite failed:'), error.message);
  process.exit(1);
});
