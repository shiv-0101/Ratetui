/**
 * API Routes
 * 
 * Example API endpoints with rate limiting applied.
 * These demonstrate how the rate limiter protects your actual API.
 */

const express = require('express');
const { rateLimiters, createRateLimiterMiddleware } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply general API rate limiting to all routes
router.use(rateLimiters.api);

/**
 * Example public endpoint
 * GET /api/data
 */
router.get('/data', (req, res) => {
  res.json({
    success: true,
    data: {
      message: 'This is rate-limited data',
      timestamp: new Date().toISOString(),
    }
  });
});

/**
 * Example endpoint with custom rate limit
 * GET /api/expensive
 * 
 * This demonstrates how to apply a stricter rate limit to expensive operations
 */
router.get('/expensive', 
  createRateLimiterMiddleware({
    keyPrefix: 'expensive',
    points: 10,
    duration: 60,
    identifierType: 'ip',
  }),
  (req, res) => {
    res.json({
      success: true,
      data: {
        message: 'This is an expensive operation with stricter limits',
        timestamp: new Date().toISOString(),
      }
    });
  }
);

/**
 * Example search endpoint
 * GET /api/search
 */
router.get('/search',
  createRateLimiterMiddleware({
    keyPrefix: 'search',
    points: 30,
    duration: 60,
    identifierType: 'ip',
  }),
  (req, res) => {
    const { q } = req.query;
    
    res.json({
      success: true,
      data: {
        query: q || '',
        results: [],
        message: 'Search endpoint with moderate rate limit',
      }
    });
  }
);

/**
 * Test endpoint to check rate limit status
 * GET /api/status
 */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    data: {
      message: 'Rate limiter is active',
      yourIp: req.ip,
      headers: {
        limit: res.get('X-RateLimit-Limit'),
        remaining: res.get('X-RateLimit-Remaining'),
        reset: res.get('X-RateLimit-Reset'),
      }
    }
  });
});

module.exports = router;
