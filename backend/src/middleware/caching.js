/**
 * Request Caching Middleware
 * 
 * Implements intelligent HTTP response caching:
 * - Redis-backed cache storage for distributed caching
 * - Cache-Control header support
 * - ETags for conditional requests
 * - Configurable TTL per route pattern
 * - Cache invalidation API
 * - Memory fallback when Redis unavailable
 * 
 * Benefits:
 * - Reduces database/API load
 * - Improves response times
 * - Bandwidth savings with 304 Not Modified
 * - Scales across multiple instances
 */

const crypto = require('crypto');
const { getRedisClient, isRedisConnected } = require('../config/redis');
const { withCircuitBreaker } = require('../services/circuitBreaker');
const logger = require('../utils/logger');

/**
 * Cache configuration
 */
const CACHE_CONFIG = {
  // Default TTL (5 minutes)
  DEFAULT_TTL: 300,
  
  // Cache key prefix
  KEY_PREFIX: 'cache:',
  
  // ETags key prefix
  ETAG_PREFIX: 'etag:',
  
  // Maximum cache entry size (1MB)
  MAX_ENTRY_SIZE: 1024 * 1024,
  
  // Memory cache size limit (100 entries)
  MEMORY_CACHE_LIMIT: 100,
  
  // Enable ETag support
  ENABLE_ETAGS: true,
};

/**
 * In-memory cache fallback
 */
const memoryCache = new Map();
const memoryCacheOrder = [];

/**
 * Add to memory cache with LRU eviction
 * @param {string} key - Cache key
 * @param {any} value - Cache value
 */
const addToMemoryCache = (key, value) => {
  if (memoryCache.size >= CACHE_CONFIG.MEMORY_CACHE_LIMIT) {
    const oldestKey = memoryCacheOrder.shift();
    memoryCache.delete(oldestKey);
  }
  
  memoryCache.set(key, value);
  memoryCacheOrder.push(key);
};

/**
 * Generate cache key from request
 * @param {Object} req - Express request
 * @returns {string} Cache key
 */
const generateCacheKey = (req) => {
  const baseKey = `${req.method}:${req.originalUrl || req.url}`;
  
  // Include query parameters
  const query = JSON.stringify(req.query);
  
  // Include user ID if authenticated (user-specific cache)
  const userId = req.user?.id || 'anonymous';
  
  // Include relevant headers for cache variance
  const varyHeaders = ['accept', 'accept-encoding', 'accept-language']
    .map(h => req.get(h) || '')
    .join(':');
  
  const fullKey = `${baseKey}:${userId}:${query}:${varyHeaders}`;
  
  // Hash to keep key length reasonable
  const hash = crypto.createHash('sha256').update(fullKey).digest('hex').substring(0, 16);
  
  return `${CACHE_CONFIG.KEY_PREFIX}${hash}`;
};

/**
 * Generate ETag from content
 * @param {string|Buffer} content - Response content
 * @returns {string} ETag value
 */
const generateETag = (content) => {
  const hash = crypto.createHash('md5').update(content).digest('hex');
  return `"${hash}"`;
};

/**
 * Check if request is cacheable
 * @param {Object} req - Express request
 * @returns {boolean} True if cacheable
 */
const isCacheable = (req) => {
  // Only cache GET and HEAD requests
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }
  
  // Don't cache authenticated admin requests
  if (req.path.startsWith('/admin') || req.path.startsWith('/api/admin')) {
    return false;
  }
  
  // Check Cache-Control header
  const cacheControl = req.get('cache-control');
  if (cacheControl) {
    if (cacheControl.includes('no-cache') || cacheControl.includes('no-store')) {
      return false;
    }
  }
  
  // Check custom header to bypass cache
  if (req.get('x-no-cache')) {
    return false;
  }
  
  return true;
};

/**
 * Check if response is cacheable
 * @param {Object} res - Express response
 * @returns {boolean} True if cacheable
 */
const isResponseCacheable = (res) => {
  const statusCode = res.statusCode;
  
  // Only cache successful responses
  if (statusCode < 200 || statusCode >= 300) {
    return false;
  }
  
  // Check response Cache-Control
  const cacheControl = res.get('cache-control');
  if (cacheControl) {
    if (cacheControl.includes('no-store') || cacheControl.includes('private')) {
      return false;
    }
  }
  
  // Check content type (only cache JSON, text, HTML)
  const contentType = res.get('content-type') || '';
  const cacheableTypes = ['application/json', 'text/', 'application/xml'];
  const isCacheableType = cacheableTypes.some(type => contentType.includes(type));
  
  if (!isCacheableType) {
    return false;
  }
  
  return true;
};

/**
 * Get TTL from Cache-Control header or default
 * @param {Object} res - Express response
 * @returns {number} TTL in seconds
 */
const getTTL = (res) => {
  const cacheControl = res.get('cache-control');
  
  if (cacheControl) {
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    if (maxAgeMatch) {
      return parseInt(maxAgeMatch[1], 10);
    }
  }
  
  return CACHE_CONFIG.DEFAULT_TTL;
};

/**
 * Store response in cache
 * @param {string} key - Cache key
 * @param {Object} data - Response data
 * @param {number} ttl - TTL in seconds
 * @returns {Promise<void>}
 */
const storeInCache = async (key, data, ttl) => {
  const serialized = JSON.stringify(data);
  
  // Check size limit
  if (Buffer.byteLength(serialized) > CACHE_CONFIG.MAX_ENTRY_SIZE) {
    logger.debug('Response too large to cache', { key, size: Buffer.byteLength(serialized) });
    return;
  }
  
  // Try Redis first
  if (isRedisConnected()) {
    try {
      await withCircuitBreaker(async () => {
        const redis = getRedisClient();
        await redis.setex(key, ttl, serialized);
      });
      
      logger.debug('Cached response in Redis', { key, ttl });
      return;
    } catch (error) {
      logger.warn('Failed to cache in Redis, using memory fallback', { error: error.message });
    }
  }
  
  // Fallback to memory cache
  addToMemoryCache(key, {
    data,
    expiry: Date.now() + (ttl * 1000),
  });
  
  logger.debug('Cached response in memory', { key, ttl });
};

/**
 * Retrieve from cache
 * @param {string} key - Cache key
 * @returns {Promise<Object|null>} Cached data or null
 */
const getFromCache = async (key) => {
  // Try Redis first
  if (isRedisConnected()) {
    try {
      const data = await withCircuitBreaker(async () => {
        const redis = getRedisClient();
        return await redis.get(key);
      });
      
      if (data) {
        logger.debug('Cache hit (Redis)', { key });
        return JSON.parse(data);
      }
    } catch (error) {
      logger.warn('Failed to get from Redis cache', { error: error.message });
    }
  }
  
  // Try memory cache
  const memoryCached = memoryCache.get(key);
  if (memoryCached) {
    // Check expiry
    if (Date.now() < memoryCached.expiry) {
      logger.debug('Cache hit (memory)', { key });
      return memoryCached.data;
    } else {
      memoryCache.delete(key);
    }
  }
  
  logger.debug('Cache miss', { key });
  return null;
};

/**
 * Invalidate cache entry
 * @param {string} key - Cache key or pattern
 * @returns {Promise<number>} Number of keys deleted
 */
const invalidateCache = async (key) => {
  let count = 0;
  
  // Invalidate in Redis
  if (isRedisConnected()) {
    try {
      await withCircuitBreaker(async () => {
        const redis = getRedisClient();
        
        // If key has wildcard, use scan
        if (key.includes('*')) {
          const keys = await redis.keys(key);
          if (keys.length > 0) {
            count = await redis.del(...keys);
          }
        } else {
          count = await redis.del(key);
        }
      });
      
      logger.info('Cache invalidated (Redis)', { key, count });
    } catch (error) {
      logger.error('Failed to invalidate Redis cache', { error: error.message });
    }
  }
  
  // Invalidate memory cache
  if (key.includes('*')) {
    const pattern = key.replace(/\*/g, '.*');
    const regex = new RegExp(pattern);
    
    for (const [cacheKey] of memoryCache) {
      if (regex.test(cacheKey)) {
        memoryCache.delete(cacheKey);
        count++;
      }
    }
  } else {
    if (memoryCache.delete(key)) {
      count++;
    }
  }
  
  return count;
};

/**
 * Clear all cache
 * @returns {Promise<void>}
 */
const clearCache = async () => {
  // Clear Redis cache
  if (isRedisConnected()) {
    try {
      await withCircuitBreaker(async () => {
        const redis = getRedisClient();
        const keys = await redis.keys(`${CACHE_CONFIG.KEY_PREFIX}*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      });
      
      logger.info('Cache cleared (Redis)');
    } catch (error) {
      logger.error('Failed to clear Redis cache', { error: error.message });
    }
  }
  
  // Clear memory cache
  memoryCache.clear();
  memoryCacheOrder.length = 0;
  
  logger.info('Cache cleared (memory)');
};

/**
 * Caching middleware
 * @param {Object} options - Cache options
 * @returns {Function} Express middleware
 */
const caching = (options = {}) => {
  const config = {
    ttl: options.ttl || CACHE_CONFIG.DEFAULT_TTL,
    keyGenerator: options.keyGenerator || generateCacheKey,
    enabled: options.enabled !== false,
  };
  
  return async (req, res, next) => {
    // Skip if caching disabled
    if (!config.enabled) {
      return next();
    }
    
    // Check if request is cacheable
    if (!isCacheable(req)) {
      return next();
    }
    
    const cacheKey = config.keyGenerator(req);
    
    try {
      // Try to get from cache
      const cached = await getFromCache(cacheKey);
      
      if (cached) {
        // Check ETag if provided
        if (CACHE_CONFIG.ENABLE_ETAGS && cached.etag) {
          const clientETag = req.get('if-none-match');
          
          if (clientETag === cached.etag) {
            // Not modified
            res.status(304);
            res.set('ETag', cached.etag);
            res.set('X-Cache', 'HIT-304');
            return res.end();
          }
        }
        
        // Serve from cache
        res.set(cached.headers);
        res.set('X-Cache', 'HIT');
        res.set('Age', Math.floor((Date.now() - cached.timestamp) / 1000).toString());
        
        return res.status(cached.statusCode).send(cached.body);
      }
      
      // Cache miss - intercept response
      res.set('X-Cache', 'MISS');
      
      const originalSend = res.send;
      const originalJson = res.json;
      
      // Override send
      res.send = function (body) {
        res.send = originalSend;
        
        // Store in cache if response is cacheable
        if (isResponseCacheable(res)) {
          const ttl = config.ttl || getTTL(res);
          const etag = CACHE_CONFIG.ENABLE_ETAGS ? generateETag(body) : null;
          
          if (etag) {
            res.set('ETag', etag);
          }
          
          const cacheData = {
            statusCode: res.statusCode,
            headers: res.getHeaders(),
            body,
            etag,
            timestamp: Date.now(),
          };
          
          storeInCache(cacheKey, cacheData, ttl).catch(error => {
            logger.error('Failed to store in cache', { error: error.message });
          });
        }
        
        return originalSend.call(res, body);
      };
      
      // Override json
      res.json = function (data) {
        res.json = originalJson;
        
        if (isResponseCacheable(res)) {
          const body = JSON.stringify(data);
          const ttl = config.ttl || getTTL(res);
          const etag = CACHE_CONFIG.ENABLE_ETAGS ? generateETag(body) : null;
          
          if (etag) {
            res.set('ETag', etag);
          }
          
          const cacheData = {
            statusCode: res.statusCode,
            headers: res.getHeaders(),
            body,
            etag,
            timestamp: Date.now(),
          };
          
          storeInCache(cacheKey, cacheData, ttl).catch(error => {
            logger.error('Failed to store in cache', { error: error.message });
          });
        }
        
        return originalJson.call(res, data);
      };
      
      next();
    } catch (error) {
      logger.error('Cache middleware error', { error: error.message });
      next();
    }
  };
};

/**
 * Get cache statistics
 * @returns {Promise<Object>} Cache stats
 */
const getCacheStats = async () => {
  const stats = {
    memory: {
      size: memoryCache.size,
      limit: CACHE_CONFIG.MEMORY_CACHE_LIMIT,
    },
    redis: {
      connected: isRedisConnected(),
      keys: 0,
    },
  };
  
  if (isRedisConnected()) {
    try {
      await withCircuitBreaker(async () => {
        const redis = getRedisClient();
        const keys = await redis.keys(`${CACHE_CONFIG.KEY_PREFIX}*`);
        stats.redis.keys = keys.length;
      });
    } catch (error) {
      logger.error('Failed to get cache stats', { error: error.message });
    }
  }
  
  return stats;
};

module.exports = {
  caching,
  invalidateCache,
  clearCache,
  getCacheStats,
  generateCacheKey,
  CACHE_CONFIG,
};
