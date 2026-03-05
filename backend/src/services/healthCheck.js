/**
 * Enhanced Health Check Service
 * 
 * Provides comprehensive health monitoring for Kubernetes and production deployments:
 * - Liveness probes: Is the application running?
 * - Readiness probes: Can the application serve traffic?
 * - Startup probes: Has the application finished initialization?
 * - Component health: Individual service status (Redis, memory, disk)
 * 
 * Kubernetes Integration:
 * - /health/live: Liveness probe (restart if fails)
 * - /health/ready: Readiness probe (remove from load balancer if fails)
 * - /health/startup: Startup probe (wait for initialization)
 */

const { isRedisConnected, pingRedis, getConnectionStatus } = require('../config/redis');
const { getShutdownStatus } = require('./gracefulShutdown');
const logger = require('../utils/logger');
const os = require('os');
const { promisify } = require('util');
const fs = require('fs');

const statAsync = promisify(fs.stat);

/**
 * Health check configuration
 */
const HEALTH_CONFIG = {
  // Memory thresholds
  MEMORY_WARNING_THRESHOLD: 0.85, // 85% of heap limit
  MEMORY_CRITICAL_THRESHOLD: 0.95, // 95% of heap limit
  
  // Redis latency thresholds (ms)
  REDIS_LATENCY_WARNING: 100,
  REDIS_LATENCY_CRITICAL: 500,
  
  // Disk space threshold (percentage remaining)
  DISK_SPACE_WARNING_THRESHOLD: 0.15, // 15% remaining
  DISK_SPACE_CRITICAL_THRESHOLD: 0.05, // 5% remaining
  
  // Component timeout (ms)
  COMPONENT_CHECK_TIMEOUT: 5000,
};

/**
 * Application state tracker
 */
const appState = {
  initialized: false,
  startTime: Date.now(),
  lastHealthCheck: null,
  consecutiveFailures: 0,
};

/**
 * Mark application as initialized
 * Call this after all startup tasks complete
 */
const markInitialized = () => {
  appState.initialized = true;
  logger.info('Application marked as initialized');
};

/**
 * Check memory health
 * @returns {Object} Memory status
 */
const checkMemoryHealth = () => {
  const usage = process.memoryUsage();
  const heapLimit = require('v8').getHeapStatistics().heap_size_limit;
  const heapUsageRatio = usage.heapUsed / heapLimit;
  
  let status = 'healthy';
  if (heapUsageRatio >= HEALTH_CONFIG.MEMORY_CRITICAL_THRESHOLD) {
    status = 'critical';
  } else if (heapUsageRatio >= HEALTH_CONFIG.MEMORY_WARNING_THRESHOLD) {
    status = 'warning';
  }
  
  return {
    status,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    heapLimit,
    heapUsagePercentage: (heapUsageRatio * 100).toFixed(2),
    rss: usage.rss,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers || 0,
  };
};

/**
 * Check system memory health
 * @returns {Object} System memory status
 */
const checkSystemMemory = () => {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const usageRatio = usedMemory / totalMemory;
  
  return {
    total: totalMemory,
    free: freeMemory,
    used: usedMemory,
    usagePercentage: (usageRatio * 100).toFixed(2),
  };
};

/**
 * Check CPU health
 * @returns {Object} CPU status
 */
const checkCpuHealth = () => {
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  
  return {
    count: cpus.length,
    model: cpus[0]?.model || 'unknown',
    loadAverage: {
      '1m': loadAvg[0].toFixed(2),
      '5m': loadAvg[1].toFixed(2),
      '15m': loadAvg[2].toFixed(2),
    },
    status: loadAvg[0] < cpus.length * 0.8 ? 'healthy' : 'warning',
  };
};

/**
 * Check Redis health with detailed metrics
 * @returns {Promise<Object>} Redis status
 */
const checkRedisHealth = async () => {
  try {
    if (!isRedisConnected()) {
      const connStatus = getConnectionStatus();
      return {
        status: 'unhealthy',
        connected: false,
        error: connStatus.lastError?.message || 'Not connected',
        attempts: connStatus.attempts,
        failureMode: connStatus.failureMode,
      };
    }
    
    const startTime = Date.now();
    const pingResult = await Promise.race([
      pingRedis(),
      new Promise((resolve) => 
        setTimeout(() => resolve(null), HEALTH_CONFIG.COMPONENT_CHECK_TIMEOUT)
      ),
    ]);
    const latency = Date.now() - startTime;
    
    if (pingResult === null) {
      return {
        status: 'critical',
        connected: true,
        error: 'Ping timeout',
        latency: null,
      };
    }
    
    let status = 'healthy';
    if (latency >= HEALTH_CONFIG.REDIS_LATENCY_CRITICAL) {
      status = 'critical';
    } else if (latency >= HEALTH_CONFIG.REDIS_LATENCY_WARNING) {
      status = 'warning';
    }
    
    return {
      status,
      connected: true,
      latency,
      latencyMs: `${latency}ms`,
    };
  } catch (error) {
    logger.error('Redis health check failed', { error: error.message });
    return {
      status: 'unhealthy',
      connected: false,
      error: error.message,
    };
  }
};

/**
 * Check disk space health
 * @returns {Promise<Object>} Disk status
 */
const checkDiskHealth = async () => {
  try {
    // This is a simplified check - in production, use a proper disk space library
    // For now, we'll just return basic info
    return {
      status: 'healthy',
      message: 'Disk check not fully implemented',
    };
  } catch (error) {
    return {
      status: 'unknown',
      error: error.message,
    };
  }
};

/**
 * Perform comprehensive health check
 * @returns {Promise<Object>} Complete health status
 */
const performHealthCheck = async () => {
  const startTime = Date.now();
  
  // Check all components in parallel
  const [memory, redis, disk] = await Promise.all([
    Promise.resolve(checkMemoryHealth()),
    checkRedisHealth(),
    checkDiskHealth(),
  ]);
  
  const systemMemory = checkSystemMemory();
  const cpu = checkCpuHealth();
  const shutdown = getShutdownStatus();
  
  // Determine overall status
  const componentStatuses = [memory.status, redis.status, cpu.status];
  let overallStatus = 'healthy';
  
  if (componentStatuses.includes('critical') || shutdown.shuttingDown) {
    overallStatus = 'critical';
  } else if (componentStatuses.includes('unhealthy')) {
    overallStatus = 'unhealthy';
  } else if (componentStatuses.includes('warning')) {
    overallStatus = 'warning';
  }
  
  const result = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - appState.startTime) / 1000),
    checkDuration: Date.now() - startTime,
    components: {
      memory,
      systemMemory,
      cpu,
      redis,
      disk,
    },
    shutdown: {
      shuttingDown: shutdown.shuttingDown,
      activeRequests: shutdown.activeRequests,
    },
  };
  
  appState.lastHealthCheck = result;
  
  // Track failures
  if (overallStatus === 'critical' || overallStatus === 'unhealthy') {
    appState.consecutiveFailures++;
  } else {
    appState.consecutiveFailures = 0;
  }
  
  return result;
};

/**
 * Liveness probe
 * Checks if the application is alive and running
 * Returns 200 if alive, 503 if dead
 * 
 * Kubernetes will restart pod if this fails
 * 
 * @returns {Object} Liveness status
 */
const checkLiveness = () => {
  const shutdown = getShutdownStatus();
  
  // If shutting down, we're no longer alive
  if (shutdown.shuttingDown) {
    return {
      alive: false,
      status: 'shutting_down',
      reason: 'Application is in shutdown sequence',
    };
  }
  
  // Check for catastrophic failures
  const memory = checkMemoryHealth();
  if (memory.status === 'critical') {
    return {
      alive: false,
      status: 'critical',
      reason: 'Memory usage critical',
      details: memory,
    };
  }
  
  // Too many consecutive failures indicate application is stuck
  if (appState.consecutiveFailures >= 5) {
    return {
      alive: false,
      status: 'failing',
      reason: 'Too many consecutive health check failures',
      consecutiveFailures: appState.consecutiveFailures,
    };
  }
  
  return {
    alive: true,
    status: 'alive',
    uptime: Math.floor((Date.now() - appState.startTime) / 1000),
  };
};

/**
 * Readiness probe
 * Checks if the application is ready to serve traffic
 * Returns 200 if ready, 503 if not ready
 * 
 * Kubernetes will remove pod from service endpoints if this fails
 * 
 * @returns {Promise<Object>} Readiness status
 */
const checkReadiness = async () => {
  // Not ready if shutting down
  const shutdown = getShutdownStatus();
  if (shutdown.shuttingDown) {
    return {
      ready: false,
      status: 'shutting_down',
      reason: 'Application is shutting down',
    };
  }
  
  // Not ready if not initialized
  if (!appState.initialized) {
    return {
      ready: false,
      status: 'initializing',
      reason: 'Application still initializing',
    };
  }
  
  // Check Redis connectivity (critical for readiness)
  const redis = await checkRedisHealth();
  if (redis.status === 'unhealthy' || redis.status === 'critical') {
    return {
      ready: false,
      status: 'dependency_failure',
      reason: 'Redis unavailable or unhealthy',
      details: redis,
    };
  }
  
  // Check memory
  const memory = checkMemoryHealth();
  if (memory.status === 'critical') {
    return {
      ready: false,
      status: 'resource_exhaustion',
      reason: 'Memory usage critical',
      details: memory,
    };
  }
  
  return {
    ready: true,
    status: 'ready',
    message: 'Application ready to serve traffic',
  };
};

/**
 * Startup probe
 * Checks if the application has completed initialization
 * Returns 200 if started, 503 if still starting
 * 
 * Kubernetes will wait for this before checking liveness/readiness
 * 
 * @returns {Promise<Object>} Startup status
 */
const checkStartup = async () => {
  if (!appState.initialized) {
    return {
      started: false,
      status: 'initializing',
      uptime: Math.floor((Date.now() - appState.startTime) / 1000),
    };
  }
  
  // Verify Redis is accessible
  const redis = await checkRedisHealth();
  if (!redis.connected) {
    return {
      started: false,
      status: 'waiting_for_dependencies',
      reason: 'Redis not connected',
    };
  }
  
  return {
    started: true,
    status: 'ready',
    uptime: Math.floor((Date.now() - appState.startTime) / 1000),
    initializationTime: Math.floor((Date.now() - appState.startTime) / 1000),
  };
};

module.exports = {
  performHealthCheck,
  checkLiveness,
  checkReadiness,
  checkStartup,
  markInitialized,
  checkMemoryHealth,
  checkRedisHealth,
  checkCpuHealth,
  HEALTH_CONFIG,
};
