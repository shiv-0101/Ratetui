/**
 * Health Check Routes
 * 
 * Provides endpoints for monitoring system health.
 */

const express = require('express');
const { isRedisConnected, getRedisClient } = require('../config/redis');

const router = express.Router();

/**
 * Basic health check
 * GET /health
 */
router.get('/', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
  };

  res.json(health);
});

/**
 * Detailed health check with component status
 * GET /health/detailed
 */
router.get('/detailed', async (req, res) => {
  const components = {
    redis: {
      status: 'unknown',
      latency: null,
    },
  };

  // Check Redis
  try {
    if (isRedisConnected()) {
      const redisClient = getRedisClient();
      const start = Date.now();
      await redisClient.ping();
      const latency = Date.now() - start;
      
      components.redis = {
        status: 'healthy',
        latency: `${latency}ms`,
      };
    } else {
      components.redis = {
        status: 'unhealthy',
        error: 'Not connected',
      };
    }
  } catch (error) {
    components.redis = {
      status: 'unhealthy',
      error: error.message,
    };
  }

  // Determine overall status
  const isHealthy = Object.values(components).every(c => c.status === 'healthy');

  const health = {
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    components,
    memory: {
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
    },
  };

  res.status(isHealthy ? 200 : 503).json(health);
});

/**
 * Liveness probe (for Kubernetes)
 * GET /health/live
 */
router.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

/**
 * Readiness probe (for Kubernetes)
 * GET /health/ready
 */
router.get('/ready', async (req, res) => {
  if (isRedisConnected()) {
    return res.status(200).json({ status: 'ready' });
  }
  
  res.status(503).json({ status: 'not ready', reason: 'Redis not connected' });
});

module.exports = router;
