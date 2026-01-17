/**
 * Redis Configuration
 * 
 * Manages Redis connection with proper error handling and reconnection logic.
 */

const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient = null;
let isConnected = false;

/**
 * Redis connection options
 */
const getRedisOptions = () => {
  const options = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
    retryStrategy: (times) => {
      if (times > 10) {
        logger.error('Redis: Max retry attempts reached');
        return null; // Stop retrying
      }
      const delay = Math.min(times * 200, 5000);
      logger.warn(`Redis: Retrying connection in ${delay}ms (attempt ${times})`);
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
    logger.info('Redis: Connecting...');
  });

  redisClient.on('ready', () => {
    isConnected = true;
    logger.info('Redis: Connection ready');
  });

  redisClient.on('error', (error) => {
    logger.error('Redis: Connection error', { error: error.message });
  });

  redisClient.on('close', () => {
    isConnected = false;
    logger.warn('Redis: Connection closed');
  });

  redisClient.on('reconnecting', () => {
    logger.info('Redis: Reconnecting...');
  });

  // Connect
  await redisClient.connect();
  
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
 * Close Redis connection
 */
const closeRedis = async () => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    isConnected = false;
    logger.info('Redis: Connection closed gracefully');
  }
};

/**
 * Get Redis failure mode from environment
 * 'open' = allow requests if Redis is down
 * 'closed' = deny requests if Redis is down
 */
const getFailureMode = () => {
  return process.env.REDIS_FAILURE_MODE || 'open';
};

module.exports = {
  connectRedis,
  getRedisClient,
  isRedisConnected,
  closeRedis,
  getFailureMode,
};
