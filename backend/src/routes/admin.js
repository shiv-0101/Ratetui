/**
 * Admin Routes
 * 
 * Administrative endpoints for managing rate limit rules.
 * All routes require authentication.
 */

const express = require('express');
const { rateLimiters } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply admin rate limiting
router.use(rateLimiters.admin);

/**
 * Placeholder for admin routes
 * These will be implemented in subsequent weeks
 */

/**
 * Admin dashboard info
 * GET /admin/info
 */
router.get('/info', (req, res) => {
  res.json({
    success: true,
    data: {
      message: 'Admin API - Authentication will be implemented in Week 2',
      version: '1.0.0',
      endpoints: {
        auth: 'Coming soon - /admin/auth/*',
        rules: 'Coming soon - /admin/rules/*',
        ip: 'Coming soon - /admin/ip/*',
        metrics: 'Coming soon - /admin/metrics',
      }
    }
  });
});

/**
 * Placeholder: List all rules
 * GET /admin/rules
 */
router.get('/rules', (req, res) => {
  // TODO: Implement in Week 2
  res.json({
    success: true,
    data: {
      rules: [],
      message: 'Rule management coming in Week 2',
    }
  });
});

/**
 * Placeholder: Get blocked IPs
 * GET /admin/ip/blocked
 */
router.get('/ip/blocked', (req, res) => {
  // TODO: Implement in Week 2
  res.json({
    success: true,
    data: {
      blocked: [],
      message: 'IP management coming in Week 2',
    }
  });
});

/**
 * Placeholder: Get metrics
 * GET /admin/metrics
 */
router.get('/metrics', (req, res) => {
  // TODO: Implement in Week 3
  res.json({
    success: true,
    data: {
      totalRequests: 0,
      blockedRequests: 0,
      activeRules: 0,
      message: 'Metrics coming in Week 3',
    }
  });
});

module.exports = router;
