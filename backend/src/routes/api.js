/**
 * API Routes
 * 
 * Example API endpoints with rate limiting applied.
 * Demonstrates various rate limiting strategies for different use cases.
 */

const express = require('express');
const { rateLimiters, createRateLimiterMiddleware } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply general API rate limiting to all routes (200 req/min per IP)
router.use(rateLimiters.api);

/**
 * Example public endpoint
 * GET /api/data
 * Rate limit: 200 req/min (from general API limiter)
 */
router.get('/data', (req, res) => {
  res.json({
    success: true,
    data: {
      message: 'This is rate-limited data',
      timestamp: new Date().toISOString(),
      rateLimit: {
        limit: 200,
        window: '60s',
      },
    }
  });
});

/**
 * Example expensive operation endpoint
 * GET /api/expensive
 * Rate limit: 10 req/min (stricter than general)
 */
router.get('/expensive', 
  rateLimiters.expensive,
  (req, res) => {
    res.json({
      success: true,
      data: {
        message: 'This is an expensive operation with stricter limits (10 req/min)',
        timestamp: new Date().toISOString(),
        computationTime: '2.5s',
      }
    });
  }
);

/**
 * Example search endpoint
 * GET /api/search
 * Rate limit: 30 req/min
 */
router.get('/search',
  rateLimiters.search,
  (req, res) => {
    const { q } = req.query;
    
    res.json({
      success: true,
      data: {
        query: q || '',
        results: [
          { id: 1, title: 'Sample result 1' },
          { id: 2, title: 'Sample result 2' },
        ],
        message: 'Search endpoint with 30 req/min limit',
      }
    });
  }
);

/**
 * Example upload endpoint
 * POST /api/upload
 * Rate limit: 5 uploads per hour
 */
router.post('/upload',
  rateLimiters.upload,
  (req, res) => {
    res.json({
      success: true,
      data: {
        message: 'File upload successful (5 uploads/hour limit)',
        fileId: 'file_' + Date.now(),
        timestamp: new Date().toISOString(),
      }
    });
  }
);

/**
 * Test endpoint to check rate limit status
 * GET /api/status
 * Shows current rate limit information for the client
 */
router.get('/status', (req, res) => {
  const limit = res.get('X-RateLimit-Limit');
  const remaining = res.get('X-RateLimit-Remaining');
  const reset = res.get('X-RateLimit-Reset');
  const window = res.get('X-RateLimit-Window');

  res.json({
    success: true,
    data: {
      message: 'Rate limiter is active',
      clientInfo: {
        ip: req.ip,
        headers: req.headers['x-forwarded-for'] || 'none',
      },
      rateLimit: {
        limit: limit ? parseInt(limit, 10) : null,
        remaining: remaining ? parseInt(remaining, 10) : null,
        reset: reset ? new Date(parseInt(reset, 10) * 1000).toISOString() : null,
        window: window || null,
        resetInSeconds: reset ? parseInt(reset, 10) - Math.floor(Date.now() / 1000) : null,
      },
      availablePresets: {
        api: '200 req/min',
        auth: '10 req/min (5min block)',
        login: '5 req/15min (15min block)',
        admin: '50 req/min (user-based)',
        search: '30 req/min',
        expensive: '10 req/min',
        upload: '5 req/hour',
        passwordReset: '3 req/hour',
        email: '10 req/hour',
        apiKey: '1000 req/hour (key-based)',
      }
    }
  });
});

module.exports = router;
