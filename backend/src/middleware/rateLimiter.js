/**
 * Rate Limiter Middleware
 * 
 * Implements rate limiting using rate-limiter-flexible with Redis backend.
 * Supports multiple limiting strategies: by IP, user, and endpoint.
 */

const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const { getRedisClient, isRedisConnected, getFailureMode } = require('../config/redis');
const logger = require('../utils/logger');
const { createError } = require('./errorHandler');

// Store rate limiters
const rateLimiters = new Map();

// Fallback in-memory limiter for when Redis is unavailable
let memoryLimiter = null;

/**
 * Get or create a rate limiter for specific configuration
 */
const getRateLimiter = (config) => {
  const key = `${config.keyPrefix}-${config.points}-${config.duration}`;
  
  if (rateLimiters.has(key)) {
    return rateLimiters.get(key);
  }

  try {
    const redisClient = getRedisClient();
    
    const limiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: config.keyPrefix || 'ratelimit',
      points: config.points || parseInt(process.env.DEFAULT_RATE_LIMIT, 10) || 100,
      duration: config.duration || parseInt(process.env.DEFAULT_RATE_WINDOW, 10) || 60,
      blockDuration: config.blockDuration || 0,
      inmemoryBlockOnConsumed: config.points + 1,
      inmemoryBlockDuration: 120,
      insuranceLimiter: getMemoryLimiter(config),
    });

    rateLimiters.set(key, limiter);
    return limiter;
  } catch (error) {
    logger.error('Failed to create Redis rate limiter, using memory fallback', { error: error.message });
    return getMemoryLimiter(config);
  }
};

/**
 * Get in-memory fallback limiter
 */
const getMemoryLimiter = (config) => {
  if (!memoryLimiter) {
    memoryLimiter = new RateLimiterMemory({
      keyPrefix: 'memory',
      points: config.points || parseInt(process.env.DEFAULT_RATE_LIMIT, 10) || 100,
      duration: config.duration || parseInt(process.env.DEFAULT_RATE_WINDOW, 10) || 60,
    });
  }
  return memoryLimiter;
};

/**
 * Extract client identifier from request
 */
const getClientIdentifier = (req, identifierType = 'ip') => {
  switch (identifierType) {
    case 'user':
      // Get user ID from authenticated request
      return req.user?.id || req.headers['x-user-id'] || null;
    
    case 'apiKey':
      return req.headers['x-api-key'] || null;
    
    case 'ip':
    default:
      // Get real IP, accounting for proxies
      return req.ip || 
             req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
             req.connection?.remoteAddress ||
             'unknown';
  }
};

/**
 * Set rate limit headers on response
 */
const setRateLimitHeaders = (res, rateLimiterRes, limit) => {
  const resetTime = Math.ceil(Date.now() / 1000) + Math.ceil(rateLimiterRes.msBeforeNext / 1000);
  
  res.set({
    'X-RateLimit-Limit': limit,
    'X-RateLimit-Remaining': Math.max(0, rateLimiterRes.remainingPoints),
    'X-RateLimit-Reset': resetTime,
  });
};

/**
 * Create rate limiter middleware with configuration
 */
const createRateLimiterMiddleware = (options = {}) => {
  const config = {
    keyPrefix: options.keyPrefix || 'ratelimit',
    points: options.points || parseInt(process.env.DEFAULT_RATE_LIMIT, 10) || 100,
    duration: options.duration || parseInt(process.env.DEFAULT_RATE_WINDOW, 10) || 60,
    blockDuration: options.blockDuration || 0,
    identifierType: options.identifierType || 'ip', // 'ip', 'user', 'apiKey'
    skipFailedRequests: options.skipFailedRequests || false,
    customKeyGenerator: options.customKeyGenerator || null,
  };

  return async (req, res, next) => {
    try {
      // Check if Redis is connected
      if (!isRedisConnected()) {
        const failureMode = getFailureMode();
        
        if (failureMode === 'closed') {
          logger.warn('Redis unavailable, denying request (closed mode)');
          return next(createError('SERVICE_UNAVAILABLE', 'Rate limiting service unavailable'));
        }
        
        // Open mode - log warning but allow request
        logger.warn('Redis unavailable, allowing request (open mode)');
      }

      // Get client identifier
      const identifier = config.customKeyGenerator 
        ? config.customKeyGenerator(req)
        : getClientIdentifier(req, config.identifierType);

      if (!identifier) {
        logger.warn('Could not determine client identifier');
        return next();
      }

      // Create composite key with endpoint if needed
      const key = options.includeEndpoint 
        ? `${identifier}:${req.method}:${req.baseUrl}${req.path}`
        : identifier;

      // Get rate limiter
      const rateLimiter = getRateLimiter(config);

      // Consume point
      const rateLimiterRes = await rateLimiter.consume(key);

      // Set headers
      setRateLimitHeaders(res, rateLimiterRes, config.points);

      next();
    } catch (error) {
      // Rate limit exceeded
      if (error.remainingPoints !== undefined) {
        const retryAfter = Math.ceil(error.msBeforeNext / 1000);
        
        res.set({
          'X-RateLimit-Limit': config.points,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': Math.ceil(Date.now() / 1000) + retryAfter,
          'Retry-After': retryAfter,
        });

        logger.info('Rate limit exceeded', {
          ip: req.ip,
          path: req.path,
          retryAfter,
        });

        return res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Too many requests. Please retry after ${retryAfter} seconds.`,
            retryAfter,
            limit: config.points,
            window: `${config.duration}s`,
          }
        });
      }

      // Other errors
      logger.error('Rate limiter error', { error: error.message });
      
      // In open failure mode, allow the request to proceed
      if (getFailureMode() === 'open') {
        return next();
      }
      
      next(createError('SERVICE_UNAVAILABLE', 'Rate limiting service error'));
    }
  };
};

/**
 * Pre-configured rate limiters for common use cases
 */
const rateLimiters_presets = {
  // General API rate limit
  api: createRateLimiterMiddleware({
    keyPrefix: 'api',
    points: 100,
    duration: 60,
    identifierType: 'ip',
  }),

  // Strict limit for authentication endpoints
  auth: createRateLimiterMiddleware({
    keyPrefix: 'auth',
    points: 10,
    duration: 60,
    blockDuration: 300, // Block for 5 minutes after exceeding
    identifierType: 'ip',
  }),

  // Very strict limit for login attempts
  login: createRateLimiterMiddleware({
    keyPrefix: 'login',
    points: 5,
    duration: 900, // 15 minutes
    blockDuration: 900,
    identifierType: 'ip',
  }),

  // Admin actions
  admin: createRateLimiterMiddleware({
    keyPrefix: 'admin',
    points: 50,
    duration: 60,
    identifierType: 'user',
  }),
};

module.exports = {
  createRateLimiterMiddleware,
  rateLimiters: rateLimiters_presets,
  getClientIdentifier,
  setRateLimitHeaders,
};
