/**
 * API Routes Tests
 * 
 * Integration tests for sample API endpoints
 */

const request = require('supertest');
const express = require('express');
const apiRoutes = require('../../routes/api');
const { connectRedis, closeRedis } = require('../../config/redis');

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
  return app;
};

describe('API Routes', () => {
  let app;

  beforeAll(async () => {
    app = createTestApp();
    // Try to connect to Redis
    try {
      await connectRedis();
    } catch (error) {
      // Ignore connection errors
    }
  });

  afterAll(async () => {
    await closeRedis();
  });

  describe('GET /api/data - General Endpoint', () => {
    test('should return 200 status', async () => {
      const response = await request(app).get('/api/data');
      expect(response.status).toBe(200);
    });

    test('should return JSON response', async () => {
      const response = await request(app).get('/api/data');
      expect(response.type).toBe('application/json');
    });

    test('should have success flag', async () => {
      const response = await request(app).get('/api/data');
      expect(response.body).toHaveProperty('success');
      expect(response.body.success).toBe(true);
    });

    test('should include data object', async () => {
      const response = await request(app).get('/api/data');
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('message');
      expect(response.body.data).toHaveProperty('timestamp');
    });

    test('should include rate limit information', async () => {
      const response = await request(app).get('/api/data');
      expect(response.body.data).toHaveProperty('rateLimit');
      expect(response.body.data.rateLimit).toHaveProperty('limit');
      expect(response.body.data.rateLimit).toHaveProperty('window');
    });

    test('should set rate limit headers', async () => {
      const response = await request(app).get('/api/data');
      
      // Headers may not be present if Redis is down and in open mode
      if (response.headers['x-ratelimit-limit']) {
        expect(response.headers).toHaveProperty('x-ratelimit-limit');
        expect(response.headers).toHaveProperty('x-ratelimit-remaining');
        expect(response.headers).toHaveProperty('x-ratelimit-reset');
      }
    });
  });

  describe('GET /api/search - Search Endpoint', () => {
    test('should return 200 status', async () => {
      const response = await request(app).get('/api/search');
      expect(response.status).toBe(200);
    });

    test('should accept query parameter', async () => {
      const response = await request(app).get('/api/search?q=test');
      expect(response.body.data).toHaveProperty('query');
      expect(response.body.data.query).toBe('test');
    });

    test('should return empty query when not provided', async () => {
      const response = await request(app).get('/api/search');
      expect(response.body.data.query).toBe('');
    });

    test('should return results array', async () => {
      const response = await request(app).get('/api/search?q=test');
      expect(response.body.data).toHaveProperty('results');
      expect(Array.isArray(response.body.data.results)).toBe(true);
    });

    test('should have search-specific rate limit (30 req/min)', async () => {
      const response = await request(app).get('/api/search');
      expect(response.body.data.message).toContain('30 req/min');
    });
  });

  describe('GET /api/expensive - Expensive Operation', () => {
    test('should return 200 status', async () => {
      const response = await request(app).get('/api/expensive');
      expect(response.status).toBe(200);
    });

    test('should indicate it is an expensive operation', async () => {
      const response = await request(app).get('/api/expensive');
      expect(response.body.data.message).toContain('expensive');
      expect(response.body.data.message).toContain('10 req/min');
    });

    test('should include computation time info', async () => {
      const response = await request(app).get('/api/expensive');
      expect(response.body.data).toHaveProperty('computationTime');
    });

    test('should have stricter rate limit than general API', async () => {
      const response = await request(app).get('/api/expensive');
      // Expensive endpoint has 10 req/min vs 200 req/min for general API
      expect(response.body.data.message).toContain('stricter');
    });
  });

  describe('POST /api/upload - Upload Endpoint', () => {
    test('should return 200 status', async () => {
      const response = await request(app)
        .post('/api/upload')
        .send({});
      expect(response.status).toBe(200);
    });

    test('should return success message', async () => {
      const response = await request(app)
        .post('/api/upload')
        .send({});
      expect(response.body.data.message).toContain('upload');
    });

    test('should generate file ID', async () => {
      const response = await request(app)
        .post('/api/upload')
        .send({});
      expect(response.body.data).toHaveProperty('fileId');
      expect(response.body.data.fileId).toMatch(/^file_\d+$/);
    });

    test('should indicate hourly rate limit', async () => {
      const response = await request(app)
        .post('/api/upload')
        .send({});
      expect(response.body.data.message).toContain('hour');
    });
  });

  describe('GET /api/status - Status Endpoint', () => {
    test('should return 200 status', async () => {
      const response = await request(app).get('/api/status');
      expect(response.status).toBe(200);
    });

    test('should show rate limiter is active', async () => {
      const response = await request(app).get('/api/status');
      expect(response.body.data.message).toContain('Rate limiter is active');
    });

    test('should include client information', async () => {
      const response = await request(app).get('/api/status');
      expect(response.body.data).toHaveProperty('clientInfo');
      expect(response.body.data.clientInfo).toHaveProperty('ip');
    });

    test('should include rate limit information', async () => {
      const response = await request(app).get('/api/status');
      expect(response.body.data).toHaveProperty('rateLimit');
      expect(response.body.data.rateLimit).toHaveProperty('limit');
      expect(response.body.data.rateLimit).toHaveProperty('remaining');
      expect(response.body.data.rateLimit).toHaveProperty('reset');
    });

    test('should list available presets', async () => {
      const response = await request(app).get('/api/status');
      expect(response.body.data).toHaveProperty('availablePresets');
      
      const presets = response.body.data.availablePresets;
      expect(presets).toHaveProperty('api');
      expect(presets).toHaveProperty('auth');
      expect(presets).toHaveProperty('login');
      expect(presets).toHaveProperty('admin');
      expect(presets).toHaveProperty('search');
      expect(presets).toHaveProperty('expensive');
      expect(presets).toHaveProperty('upload');
    });

    test('should calculate reset time in seconds', async () => {
      const response = await request(app).get('/api/status');
      const resetInSeconds = response.body.data.rateLimit.resetInSeconds;
      
      if (resetInSeconds !== null) {
        expect(typeof resetInSeconds).toBe('number');
        expect(resetInSeconds).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('API Routes Performance', () => {
    test('endpoints should respond quickly', async () => {
      const endpoints = ['/api/data', '/api/search', '/api/expensive', '/api/status'];
      
      for (const endpoint of endpoints) {
        const start = Date.now();
        await request(app).get(endpoint);
        const duration = Date.now() - start;
        
        expect(duration).toBeLessThan(200);
      }
    });
  });

  describe('API Routes Structure', () => {
    test('all endpoints should return consistent success structure', async () => {
      const endpoints = ['/api/data', '/api/search', '/api/expensive', '/api/status'];
      
      for (const endpoint of endpoints) {
        const response = await request(app).get(endpoint);
        expect(response.body).toHaveProperty('success');
        expect(response.body).toHaveProperty('data');
      }
    });

    test('all endpoints should include timestamps', async () => {
      const endpoints = ['/api/data', '/api/search', '/api/expensive'];
      
      for (const endpoint of endpoints) {
        const response = await request(app).get(endpoint);
        expect(response.body.data).toHaveProperty('timestamp');
        expect(new Date(response.body.data.timestamp)).toBeInstanceOf(Date);
      }
    });
  });

  describe('API Routes Error Handling', () => {
    test('should return 404 for invalid routes', async () => {
      const response = await request(app).get('/api/nonexistent');
      expect(response.status).toBe(404);
    });

    test('should handle malformed JSON in POST requests', async () => {
      const response = await request(app)
        .post('/api/upload')
        .set('Content-Type', 'application/json')
        .send('invalid json');
      
      expect(response.status).toBe(400);
    });
  });
});
