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
 * Validate Redis environment configuration
 * @returns {Object} Validation result with errors if any
 */
const validateRedisConfig = () => {
  const errors = [];
  const warnings = [];
  
  const host = process.env.REDIS_HOST;
  const port = parseInt(process.env.REDIS_PORT, 10);
  const db = parseInt(process.env.REDIS_DB, 10);
  
  // Validate host
  if (!host) {
    errors.push('REDIS_HOST environment variable is required');
  }
  
  // Validate port
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid REDIS_PORT: ${process.env.REDIS_PORT}. Must be between 1-65535`);
  }
  
  // Validate database number
  if (isNaN(db) || db < 0 || db > 15) {
    errors.push(`Invalid REDIS_DB: ${process.env.REDIS_DB}. Must be between 0-15`);
  }
  
  // Check TLS configuration
  const tlsEnabled = process.env.REDIS_TLS === 'true';
  if (tlsEnabled && process.env.NODE_ENV === 'development') {
    warnings.push('TLS enabled in development mode. Ensure Redis server supports TLS.');
  }
  
  // Check password in production
  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_PASSWORD) {
    warnings.push('No Redis password set in production. Consider enabling authentication.');
  }
  
  return { valid: errors.length === 0, errors, warnings, config: { host, port, db, tlsEnabled } };
};

/**
 * Test Redis connection with comprehensive validation
 * @returns {Promise<Object>} Test results
 */
const testRedisConnection = async () => {
  const testResults = {
    configValid: false,
    connectionSuccessful: false,
    pingSuccessful: false,
    latency: null,
    errors: [],
    warnings: [],
  };
  
  // Validate configuration
  const configValidation = validateRedisConfig();
  testResults.configValid = configValidation.valid;
  testResults.errors.push(...configValidation.errors);
  testResults.warnings.push(...configValidation.warnings);
  
  if (!configValidation.valid) {
    return testResults;
  }
  
  logger.info('Redis: Starting connection test', configValidation.config);
  
  // Test connection
  try {
    const testClient = new Redis(getRedisOptions());
    
    // Wait for ready or error
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        testClient.disconnect();
        reject(new Error('Connection timeout after 10 seconds'));
      }, 10000);
      
      testClient.on('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      
      testClient.on('error', (error) => {
        clearTimeout(timeout);
        testClient.disconnect();
        reject(error);
      });
    });
    
    testResults.connectionSuccessful = true;
    
    // Test ping
    const pingStart = Date.now();
    const pingResult = await testClient.ping();
    const pingLatency = Date.now() - pingStart;
    
    if (pingResult === 'PONG') {
      testResults.pingSuccessful = true;
      testResults.latency = pingLatency;
      logger.info(`Redis: Connection test successful - latency ${pingLatency}ms`);
    } else {
      testResults.errors.push(`Unexpected ping response: ${pingResult}`);
    }
    
    // Test basic operations
    const testKey = `test:${Date.now()}`;
    await testClient.set(testKey, 'test-value', 'EX', 10);
    const retrievedValue = await testClient.get(testKey);
    
    if (retrievedValue !== 'test-value') {
      testResults.warnings.push('Set/Get operation test failed');
    }
    
    await testClient.del(testKey);
    await testClient.disconnect();
    
  } catch (error) {
    testResults.errors.push(`Connection test failed: ${error.message}`);
    logger.error('Redis: Connection test failed', { error: error.message });
  }
  
  return testResults;
};
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
      return getReconnectionDelay(times);
    },
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST, 10) || 3,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT, 10) || 10000,
    commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT, 10) || 5000,
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
 * Test failure mode behavior
 * @param {string} mode - 'open' or 'closed'
 * @returns {Promise<Object>} Test results
 */
const testFailureMode = async (mode = getFailureMode()) => {
  const testResults = {
    mode,
    opensWhenRedisDown: false,
    closesWhenRedisDown: false,
    allowsWhenConnected: false,
    errors: [],
  };
  
  try {
    // Test behavior when connected
    if (isRedisConnected()) {
      testResults.allowsWhenConnected = shouldAllowRequests();
    }
    
    // Simulate Redis failure by temporarily setting connection to false
    const originalConnected = isConnected;
    isConnected = false;
    
    const shouldAllow = shouldAllowRequests();
    
    if (mode === 'open') {
      testResults.opensWhenRedisDown = shouldAllow === true;
    } else {
      testResults.closesWhenRedisDown = shouldAllow === false;
    }
    
    // Restore original connection state
    isConnected = originalConnected;
    
    logger.info(`Redis: Failure mode test completed`, {
      mode,
      result: mode === 'open' ? testResults.opensWhenRedisDown : testResults.closesWhenRedisDown,
    });
    
  } catch (error) {
    testResults.errors.push(`Failure mode test error: ${error.message}`);
  }
  
  return testResults;
};

/**
 * Implement exponential backoff reconnection
 * @param {number} attempt - Current attempt number
 * @returns {number|null} Delay in milliseconds or null to stop
 */
const getReconnectionDelay = (attempt) => {
  const maxAttempts = parseInt(process.env.REDIS_MAX_RETRIES, 10) || 10;
  
  if (attempt > maxAttempts) {
    logger.error('Redis: Maximum reconnection attempts reached', { 
      attempts: attempt, 
      maxAttempts,
      failureMode: getFailureMode(),
    });
    return null;
  }
  
  // Exponential backoff: 200ms, 400ms, 800ms, ... up to 30s
  const baseDelay = parseInt(process.env.REDIS_RETRY_DELAY, 10) || 200;
  const maxDelay = parseInt(process.env.REDIS_MAX_RETRY_DELAY, 10) || 30000;
  const delay = Math.min(attempt * baseDelay * Math.pow(2, attempt - 1), maxDelay);
  
  logger.info(`Redis: Scheduling reconnection attempt ${attempt}/${maxAttempts}`, { 
    delayMs: delay,
    failureMode: getFailureMode(),
  });
  
  return delay;
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

/**
 * Get Redis memory and server info
 * @returns {Object|null} Redis info object or null if unavailable
 */
const getRedisInfo = async () => {
  if (!redisClient || !isConnected) {
    return null;
  }

  try {
    const info = await redisClient.info();
    const lines = info.split('\r\n');
    const result = {};

    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        result[key] = value;
      }
    }

    return {
      usedMemory: result.used_memory_human || 'unknown',
      usedMemoryPeak: result.used_memory_peak_human || 'unknown',
      connectedClients: parseInt(result.connected_clients, 10) || 0,
      uptimeInSeconds: parseInt(result.uptime_in_seconds, 10) || 0,
      redisVersion: result.redis_version || 'unknown',
      totalKeys: parseInt(result.db0?.split(',')[0]?.split('=')[1], 10) || 0,
    };
  } catch (error) {
    logger.error('Redis: Failed to get info', { error: error.message });
    return null;
  }
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
  getRedisInfo,
  validateRedisConfig,
  testRedisConnection,
  testFailureMode,
  getReconnectionDelay,
};
