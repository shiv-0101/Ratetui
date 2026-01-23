/**
 * Health Check Routes Tests
 * 
 * Integration tests for health check endpoints
 */

const request = require('supertest');
const express = require('express');
const healthRoutes = require('../../routes/health');
const { connectRedis, closeRedis } = require('../../config/redis');

// Create test app
const createTestApp = () => {
  const app = express();
  app.use('/health', healthRoutes);
  return app;
};

describe('Health Check Endpoints', () => {
  let app;

  beforeAll(async () => {
    app = createTestApp();
    // Try to connect to Redis (may fail, that's okay)
    try {
      await connectRedis();
    } catch (error) {
      // Ignore connection errors for tests
    }
  });

  afterAll(async () => {
    await closeRedis();
  });

  describe('GET /health - Basic Health Check', () => {
    test('should return 200 status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
    });

    test('should return JSON response', async () => {
      const response = await request(app).get('/health');
      expect(response.type).toBe('application/json');
    });

    test('should include status field', async () => {
      const response = await request(app).get('/health');
      expect(response.body).toHaveProperty('status');
      expect(response.body.status).toBe('healthy');
    });

    test('should include timestamp', async () => {
      const response = await request(app).get('/health');
      expect(response.body).toHaveProperty('timestamp');
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
    });

    test('should include uptime', async () => {
      const response = await request(app).get('/health');
      expect(response.body).toHaveProperty('uptime');
      expect(typeof response.body.uptime).toBe('number');
      expect(response.body.uptime).toBeGreaterThan(0);
    });

    test('should include version', async () => {
      const response = await request(app).get('/health');
      expect(response.body).toHaveProperty('version');
      expect(typeof response.body.version).toBe('string');
    });

    test('should have correct response structure', async () => {
      const response = await request(app).get('/health');
      expect(response.body).toEqual({
        status: 'healthy',
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        version: expect.any(String),
      });
    });
  });

  describe('GET /health/detailed - Detailed Health Check', () => {
    test('should return 200 or 503 status', async () => {
      const response = await request(app).get('/health/detailed');
      expect([200, 503]).toContain(response.status);
    });

    test('should return JSON response', async () => {
      const response = await request(app).get('/health/detailed');
      expect(response.type).toBe('application/json');
    });

    test('should include overall status', async () => {
      const response = await request(app).get('/health/detailed');
      expect(response.body).toHaveProperty('status');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(response.body.status);
    });

    test('should include components section', async () => {
      const response = await request(app).get('/health/detailed');
      expect(response.body).toHaveProperty('components');
      expect(response.body.components).toHaveProperty('redis');
    });

    test('should include Redis component status', async () => {
      const response = await request(app).get('/health/detailed');
      const redis = response.body.components.redis;
      
      expect(redis).toHaveProperty('status');
      expect(['healthy', 'unhealthy', 'unknown']).toContain(redis.status);
      expect(redis).toHaveProperty('connected');
      expect(redis).toHaveProperty('failureMode');
    });

    test('should include memory information', async () => {
      const response = await request(app).get('/health/detailed');
      expect(response.body).toHaveProperty('memory');
      expect(response.body.memory).toHaveProperty('heapUsed');
      expect(response.body.memory).toHaveProperty('heapTotal');
      expect(response.body.memory).toHaveProperty('rss');
    });

    test('should include process information', async () => {
      const response = await request(app).get('/health/detailed');
      expect(response.body).toHaveProperty('process');
      expect(response.body.process).toHaveProperty('pid');
      expect(response.body.process).toHaveProperty('nodeVersion');
      expect(response.body.process).toHaveProperty('platform');
    });

    test('should include timestamp and uptime', async () => {
      const response = await request(app).get('/health/detailed');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(typeof response.body.uptime).toBe('number');
    });

    test('Redis healthy state should include latency', async () => {
      const response = await request(app).get('/health/detailed');
      const redis = response.body.components.redis;
      
      if (redis.status === 'healthy') {
        expect(redis).toHaveProperty('latency');
        expect(redis.latency).toMatch(/\d+ms/);
        expect(redis.connected).toBe(true);
      }
    });

    test('Redis unhealthy state should include error', async () => {
      const response = await request(app).get('/health/detailed');
      const redis = response.body.components.redis;
      
      if (redis.status === 'unhealthy') {
        expect(redis).toHaveProperty('error');
        expect(redis.connected).toBe(false);
      }
    });

    test('should show degraded status when Redis down in open mode', async () => {
      const response = await request(app).get('/health/detailed');
      const redis = response.body.components.redis;
      
      if (redis.status === 'unhealthy' && redis.failureMode === 'open') {
        expect(response.body.status).toBe('degraded');
      }
    });
  });

  describe('GET /health/live - Liveness Probe', () => {
    test('should return 200 status', async () => {
      const response = await request(app).get('/health/live');
      expect(response.status).toBe(200);
    });

    test('should return JSON response', async () => {
      const response = await request(app).get('/health/live');
      expect(response.type).toBe('application/json');
    });

    test('should include alive status', async () => {
      const response = await request(app).get('/health/live');
      expect(response.body).toEqual({ status: 'alive' });
    });

    test('should always return alive (never fail)', async () => {
      // Liveness should always succeed unless process crashes
      const response = await request(app).get('/health/live');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('alive');
    });
  });

  describe('GET /health/ready - Readiness Probe', () => {
    test('should return 200 or 503 status', async () => {
      const response = await request(app).get('/health/ready');
      expect([200, 503]).toContain(response.status);
    });

    test('should return JSON response', async () => {
      const response = await request(app).get('/health/ready');
      expect(response.type).toBe('application/json');
    });

    test('should include status field', async () => {
      const response = await request(app).get('/health/ready');
      expect(response.body).toHaveProperty('status');
      expect(['ready', 'not ready']).toContain(response.body.status);
    });

    test('should return 200 when Redis connected', async () => {
      const response = await request(app).get('/health/ready');
      
      if (response.status === 200) {
        expect(response.body.status).toBe('ready');
      }
    });

    test('should return 503 when Redis not connected', async () => {
      const response = await request(app).get('/health/ready');
      
      if (response.status === 503) {
        expect(response.body.status).toBe('not ready');
        expect(response.body).toHaveProperty('reason');
        expect(response.body.reason).toContain('Redis');
      }
    });
  });

  describe('Health Check Performance', () => {
    test('basic health check should respond quickly', async () => {
      const start = Date.now();
      await request(app).get('/health');
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(100); // Should respond in < 100ms
    });

    test('detailed health check should respond within reasonable time', async () => {
      const start = Date.now();
      await request(app).get('/health/detailed');
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(500); // Should respond in < 500ms
    });

    test('liveness probe should be very fast', async () => {
      const start = Date.now();
      await request(app).get('/health/live');
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(50); // Should respond in < 50ms
    });
  });

  describe('Health Check Error Handling', () => {
    test('should handle invalid routes gracefully', async () => {
      const response = await request(app).get('/health/invalid');
      expect(response.status).toBe(404);
    });

    test('should not crash on repeated requests', async () => {
      const promises = Array(10).fill(null).map(() => 
        request(app).get('/health')
      );
      
      const responses = await Promise.all(promises);
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });
});
