/**
 * Health Check Routes
 * 
 * Provides endpoints for monitoring system health.
 */

const express = require('express');
const { 
  getConnectionStatus,
  pingRedis,
  isRedisConnected,
  getFailureMode,
} = require('../config/redis');

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
      connected: false,
      latency: null,
      failureMode: getFailureMode(),
    },
  };

  // Check Redis
  try {
    const connectionStatus = getConnectionStatus();
    
    if (isRedisConnected()) {
      const latency = await pingRedis();
      
      if (latency !== null) {
        components.redis = {
          status: 'healthy',
          connected: true,
          latency: `${latency}ms`,
          lastPingTime: connectionStatus.lastPingTime,
          failureMode: connectionStatus.failureMode,
          clientStatus: connectionStatus.client,
        };
      } else {
        components.redis = {
          status: 'unhealthy',
          connected: false,
          error: 'Ping failed',
          failureMode: connectionStatus.failureMode,
        };
      }
    } else {
      components.redis = {
        status: 'unhealthy',
        connected: false,
        error: connectionStatus.lastError ? connectionStatus.lastError.message : 'Not connected',
        lastError: connectionStatus.lastError,
        connectionAttempts: connectionStatus.attempts,
        failureMode: connectionStatus.failureMode,
        clientStatus: connectionStatus.client,
      };
    }
  } catch (error) {
    components.redis = {
      status: 'unhealthy',
      connected: false,
      error: error.message,
      failureMode: getFailureMode(),
    };
  }

  // Determine overall status based on failure mode
  let isHealthy = true;
  if (components.redis.status !== 'healthy') {
    // If Redis is down but we're in 'open' mode, system is degraded but operational
    isHealthy = getFailureMode() === 'open' ? false : false;
  }

  const memoryUsage = process.memoryUsage();
  const health = {
    status: components.redis.status === 'healthy' ? 'healthy' : 
      (getFailureMode() === 'open' ? 'degraded' : 'unhealthy'),
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    version: process.env.npm_package_version || '1.0.0',
    components,
    memory: {
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
      external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
    },
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
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
