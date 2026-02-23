/**
 * Data Retention Service
 * 
 * Implements automated data retention policies as defined in TRD section 9.4.
 * Handles TTL management and cleanup for different data types.
 */

const logger = require('../utils/logger');
const { getRedisClient } = require('../config/redis');

/**
 * Data retention policies (in seconds)
 * Based on TRD section 9.4 Data Retention
 */
const RETENTION_POLICIES = {
  // Rate limit counters - expire after window + buffer
  RATE_LIMIT_COUNTER: {
    description: 'Rate limit counters',
    ttl: 3660, // 61 minutes (60 min window + 1 min buffer)
    pattern: 'ratelimit:counter:*',
  },
  
  // Blocked IPs - manual removal or expiry
  BLOCKED_IP: {
    description: 'Blocked IP addresses',
    ttl: null, // Manual removal or set per-block
    pattern: 'ratelimit:blocked:ip:*',
  },
  
  // Session data - expire with session
  SESSION: {
    description: 'User session data',
    ttl: 86400, // 24 hours
    pattern: 'session:*',
  },
  
  // Audit logs - 90 days retention
  AUDIT_LOG: {
    description: 'Audit log entries',
    ttl: 7776000, // 90 days
    pattern: 'audit:log:*',
  },
  
  // Metrics - 30 days retention
  METRICS: {
    description: 'System metrics',
    ttl: 2592000, // 30 days
    pattern: 'metrics:*',
  },
  
  // Temporary tokens (password reset, verification)
  TEMP_TOKEN: {
    description: 'Temporary tokens',
    ttl: 3600, // 1 hour
    pattern: 'token:temp:*',
  },
  
  // Refresh tokens - 7 days
  REFRESH_TOKEN: {
    description: 'Refresh tokens',
    ttl: 604800, // 7 days
    pattern: 'token:refresh:*',
  },
  
  // Token blacklist - expire after token expiry
  TOKEN_BLACKLIST: {
    description: 'Blacklisted tokens',
    ttl: 3600, // Match access token expiry
    pattern: 'token:blacklist:*',
  },
};

/**
 * Apply TTL to a key based on its type
 * @param {string} key - Redis key
 * @param {string} type - Data type (key from RETENTION_POLICIES)
 * @returns {Promise<boolean>} Success status
 */
const applyRetentionPolicy = async (key, type) => {
  const redis = getRedisClient();
  if (!redis) {
    logger.error('Redis client not available for retention policy');
    return false;
  }
  
  const policy = RETENTION_POLICIES[type];
  if (!policy) {
    logger.warn(`Unknown retention policy type: ${type}`);
    return false;
  }
  
  if (policy.ttl === null) {
    // No automatic expiry for this type
    return true;
  }
  
  try {
    const result = await redis.expire(key, policy.ttl);
    if (result === 1) {
      logger.debug(`Applied retention policy to ${key}: ${policy.ttl}s TTL`);
      return true;
    } else {
      logger.warn(`Failed to apply retention policy to ${key}: key may not exist`);
      return false;
    }
  } catch (error) {
    logger.error(`Error applying retention policy to ${key}:`, { error: error.message });
    return false;
  }
};

/**
 * Set a key with automatic TTL based on retention policy
 * @param {string} key - Redis key
 * @param {any} value - Value to store
 * @param {string} type - Data type (key from RETENTION_POLICIES)
 * @returns {Promise<boolean>} Success status
 */
const setWithRetention = async (key, value, type) => {
  const redis = getRedisClient();
  if (!redis) {
    logger.error('Redis client not available');
    return false;
  }
  
  const policy = RETENTION_POLICIES[type];
  if (!policy) {
    logger.warn(`Unknown retention policy type: ${type}, setting without TTL`);
    await redis.set(key, value);
    return true;
  }
  
  try {
    if (policy.ttl !== null) {
      // Set with TTL
      await redis.setex(key, policy.ttl, value);
      logger.debug(`Set ${key} with ${policy.ttl}s TTL (${policy.description})`);
    } else {
      // Set without TTL
      await redis.set(key, value);
      logger.debug(`Set ${key} without TTL (${policy.description})`);
    }
    return true;
  } catch (error) {
    logger.error(`Error setting key with retention: ${key}`, { error: error.message });
    return false;
  }
};

/**
 * Clean up expired keys by pattern
 * Note: This uses SCAN (not KEYS) to avoid blocking Redis
 * @param {string} pattern - Key pattern to scan
 * @param {number} batchSize - Number of keys to process per batch
 * @returns {Promise<Object>} Cleanup statistics
 */
const cleanupExpiredKeys = async (pattern, batchSize = 100) => {
  const redis = getRedisClient();
  if (!redis) {
    logger.error('Redis client not available for cleanup');
    return { success: false, error: 'Redis not available' };
  }
  
  const stats = {
    scanned: 0,
    expired: 0,
    removed: 0,
    errors: 0,
  };
  
  try {
    let cursor = '0';
    let iterations = 0;
    const maxIterations = 1000; // Prevent infinite loops
    
    do {
      // Use SCAN to iterate without blocking
      const [newCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        batchSize
      );
      
      cursor = newCursor;
      stats.scanned += keys.length;
      
      // Check TTL for each key
      for (const key of keys) {
        try {
          const ttl = await redis.ttl(key);
          
          // TTL -1 means no expiry set, -2 means key doesn't exist
          if (ttl === -1) {
            stats.expired++;
            logger.debug(`Key ${key} has no expiry set`);
          } else if (ttl === -2) {
            // Key already expired
            stats.removed++;
          }
        } catch (error) {
          stats.errors++;
          logger.error(`Error checking TTL for ${key}:`, { error: error.message });
        }
      }
      
      iterations++;
      if (iterations >= maxIterations) {
        logger.warn(`Cleanup scan reached max iterations (${maxIterations}), stopping`);
        break;
      }
      
    } while (cursor !== '0');
    
    logger.info('Cleanup completed', { pattern, ...stats });
    return { success: true, ...stats };
    
  } catch (error) {
    logger.error('Error during cleanup:', { pattern, error: error.message });
    return { success: false, error: error.message, ...stats };
  }
};

/**
 * Apply missing TTLs to keys that should have them
 * @param {string} pattern - Key pattern to scan
 * @param {string} type - Data type (key from RETENTION_POLICIES)
 * @param {number} batchSize - Number of keys to process per batch
 * @returns {Promise<Object>} Application statistics
 */
const applyMissingTTLs = async (pattern, type, batchSize = 100) => {
  const redis = getRedisClient();
  if (!redis) {
    logger.error('Redis client not available');
    return { success: false, error: 'Redis not available' };
  }
  
  const policy = RETENTION_POLICIES[type];
  if (!policy || policy.ttl === null) {
    return { success: true, message: 'No TTL policy for this type' };
  }
  
  const stats = {
    scanned: 0,
    applied: 0,
    skipped: 0,
    errors: 0,
  };
  
  try {
    let cursor = '0';
    let iterations = 0;
    const maxIterations = 1000;
    
    do {
      const [newCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        batchSize
      );
      
      cursor = newCursor;
      stats.scanned += keys.length;
      
      for (const key of keys) {
        try {
          const ttl = await redis.ttl(key);
          
          // Apply TTL if missing (ttl = -1)
          if (ttl === -1) {
            await redis.expire(key, policy.ttl);
            stats.applied++;
            logger.debug(`Applied TTL to ${key}: ${policy.ttl}s`);
          } else {
            stats.skipped++;
          }
        } catch (error) {
          stats.errors++;
          logger.error(`Error applying TTL to ${key}:`, { error: error.message });
        }
      }
      
      iterations++;
      if (iterations >= maxIterations) {
        logger.warn(`TTL application reached max iterations (${maxIterations}), stopping`);
        break;
      }
      
    } while (cursor !== '0');
    
    logger.info('TTL application completed', { pattern, type, ...stats });
    return { success: true, ...stats };
    
  } catch (error) {
    logger.error('Error during TTL application:', { pattern, type, error: error.message });
    return { success: false, error: error.message, ...stats };
  }
};

/**
 * Run periodic cleanup for all retention policies
 * @returns {Promise<Object>} Overall cleanup results
 */
const runPeriodicCleanup = async () => {
  logger.info('Starting periodic data retention cleanup');
  
  const results = {};
  
  for (const [type, policy] of Object.entries(RETENTION_POLICIES)) {
    if (policy.ttl !== null && policy.pattern) {
      logger.info(`Checking retention for: ${policy.description}`);
      results[type] = await applyMissingTTLs(policy.pattern, type);
    }
  }
  
  logger.info('Periodic cleanup completed', { results });
  return results;
};

/**
 * Get retention statistics
 * @returns {Promise<Object>} Statistics for all retention policies
 */
const getRetentionStatistics = async () => {
  const redis = getRedisClient();
  if (!redis) {
    return { error: 'Redis not available' };
  }
  
  const stats = {};
  
  for (const [type, policy] of Object.entries(RETENTION_POLICIES)) {
    if (policy.pattern) {
      try {
        let cursor = '0';
        let count = 0;
        let withTTL = 0;
        let withoutTTL = 0;
        
        // Sample scan (first 1000 keys only for statistics)
        const [newCursor, keys] = await redis.scan(cursor, 'MATCH', policy.pattern, 'COUNT', 1000);
        count = keys.length;
        
        for (const key of keys.slice(0, 100)) { // Sample first 100
          const ttl = await redis.ttl(key);
          if (ttl === -1) withoutTTL++;
          else if (ttl > 0) withTTL++;
        }
        
        stats[type] = {
          description: policy.description,
          ttl: policy.ttl,
          sampleSize: Math.min(count, 100),
          totalKeys: count,
          keysWithTTL: withTTL,
          keysWithoutTTL: withoutTTL,
        };
      } catch (error) {
        stats[type] = { error: error.message };
      }
    }
  }
  
  return stats;
};

module.exports = {
  RETENTION_POLICIES,
  applyRetentionPolicy,
  setWithRetention,
  cleanupExpiredKeys,
  applyMissingTTLs,
  runPeriodicCleanup,
  getRetentionStatistics,
};
