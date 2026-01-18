/**
 * Redis Configuration
 * 
 * Manages Redis connection with proper error handling and reconnection logic.
 */

const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient = null;
let isConnected = false;
let connectionAttempts = 0;
let lastConnectionError = null;
let lastPingTime = null;
let lastPingLatency = null;

/**
 * Redis connection options
 */
const getRedisOptions = () => {
  const options = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
    retryStrategy: (times) => {
      connectionAttempts = times;
      if (times > 10) {
        logger.error('Redis: Max retry attempts (10) reached, stopping reconnection');
        return null; // Stop retrying
      }
      const delay = Math.min(times * 200, 5000); // Exponential backoff up to 5s
      logger.warn(`Redis: Connection attempt ${times}/10 - retrying in ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  };

  // Add password if provided
  if (process.env.REDIS_PASSWORD) {
    options.password = process.env.REDIS_PASSWORD;
  }

  // Add TLS if enabled
  if (process.env.REDIS_TLS === 'true') {
    options.tls = {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    };
  }

  return options;
};

/**
 * Connect to Redis
 */
const connectRedis = async () => {
  if (redisClient && isConnected) {
    return redisClient;
  }

  redisClient = new Redis(getRedisOptions());

  // Event handlers
  redisClient.on('connect', () => {
    logger.info('Redis: Initiating connection...');
  });

  redisClient.on('ready', () => {
    isConnected = true;
    connectionAttempts = 0;
    lastConnectionError = null;
    logger.info('Redis: Connection established and ready', {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: process.env.REDIS_DB || 0,
    });
  });

  redisClient.on('error', (error) => {
    isConnected = false;
    lastConnectionError = {
      message: error.message,
      timestamp: new Date().toISOString(),
    };
    logger.error('Redis: Connection error', { 
      error: error.message,
      code: error.code,
      failureMode: getFailureMode(),
    });
  });

  redisClient.on('close', () => {
    isConnected = false;
    logger.warn('Redis: Connection closed', {
      failureMode: getFailureMode(),
    });
  });

  redisClient.on('reconnecting', (delay) => {
    logger.info('Redis: Attempting to reconnect...', { 
      delayMs: delay,
      attempt: connectionAttempts,
    });
  });

  redisClient.on('end', () => {
    isConnected = false;
    logger.warn('Redis: Connection ended permanently');
  });

  // Connect with timeout
  try {
    await redisClient.connect();
    
    // Test connection
    const pingStart = Date.now();
    await redisClient.ping();
    lastPingLatency = Date.now() - pingStart;
    lastPingTime = new Date().toISOString();
    
    logger.info('Redis: Connection test successful', { 
      latency: `${lastPingLatency}ms`,
    });
  } catch (error) {
    lastConnectionError = {
      message: error.message,
      timestamp: new Date().toISOString(),
    };
    logger.error('Redis: Failed to establish connection', { error: error.message });
    
    // Depending on failure mode, we may still return the client
    const failureMode = getFailureMode();
    if (failureMode === 'open') {
      logger.warn('Redis: Operating in OPEN failure mode - requests will proceed without rate limiting');
    } else {
      logger.error('Redis: Operating in CLOSED failure mode - all requests will be denied');
    }
  }
  
  return redisClient;
};

/**
 * Get Redis client
 */
const getRedisClient = () => {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call connectRedis() first.');
  }
  return redisClient;
};

/**
 * Check if Redis is connected
 */
const isRedisConnected = () => isConnected;

/**
 * Get detailed connection status
 */
const getConnectionStatus = () => {
  return {
    connected: isConnected,
    attempts: connectionAttempts,
    lastError: lastConnectionError,
    lastPingTime: lastPingTime,
    lastPingLatency: lastPingLatency,
    failureMode: getFailureMode(),
    client: redisClient ? redisClient.status : 'not_initialized',
  };
};

/**
 * Test Redis connection with ping
 * Returns latency in milliseconds or null if failed
 */
const pingRedis = async () => {
  if (!redisClient || !isConnected) {
    return null;
  }

  try {
    const start = Date.now();
    await redisClient.ping();
    const latency = Date.now() - start;
    
    lastPingTime = new Date().toISOString();
    lastPingLatency = latency;
    
    return latency;
  } catch (error) {
    logger.error('Redis: Ping failed', { error: error.message });
    lastConnectionError = {
      message: error.message,
      timestamp: new Date().toISOString(),
    };
    return null;
  }
};

/**
 * Close Redis connection
 */
const closeRedis = async () => {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('Redis: Connection closed gracefully');
    } catch (error) {
      logger.error('Redis: Error during connection close', { error: error.message });
      // Force disconnect if quit fails
      redisClient.disconnect();
    } finally {
      redisClient = null;
      isConnected = false;
      connectionAttempts = 0;
      lastConnectionError = null;
    }
  }
};

/**
 * Get Redis failure mode from environment
 * 'open' = allow requests if Redis is down (graceful degradation)
 * 'closed' = deny requests if Redis is down (fail-safe)
 */
const getFailureMode = () => {
  const mode = (process.env.REDIS_FAILURE_MODE || 'open').toLowerCase();
  if (mode !== 'open' && mode !== 'closed') {
    logger.warn(`Redis: Invalid REDIS_FAILURE_MODE '${mode}', defaulting to 'open'`);
    return 'open';
  }
  return mode;
};

/**
 * Check if requests should be allowed based on failure mode
 * @returns {boolean} true if requests should proceed, false if they should be blocked
 */
const shouldAllowRequests = () => {
  if (isConnected) {
    return true;
  }
  
  const failureMode = getFailureMode();
  return failureMode === 'open';
};

module.exports = {
  connectRedis,
  getRedisClient,
  isRedisConnected,
  getConnectionStatus,
  pingRedis,
  closeRedis,
  getFailureMode,
  shouldAllowRequests,
};
