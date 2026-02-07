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
 * Validate if IP address is legitimate
 */
const isValidIP = (ip) => {
  if (!ip || ip === 'unknown') return false;
  
  // IPv4 validation
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(ip)) {
    const parts = ip.split('.');
    return parts.every(part => parseInt(part, 10) <= 255);
  }
  
  // IPv6 validation (simplified)
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv6Regex.test(ip);
};

/**
 * Extract real client IP from request
 * Handles X-Forwarded-For with security validation
 */
const extractClientIP = (req) => {
  // Priority 1: X-Forwarded-For (if behind proxy)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    
    for (const ip of ips) {
      if (isValidIP(ip)) {
        // Skip private/local IPs in production for security
        if (process.env.NODE_ENV === 'production') {
          if (ip.startsWith('127.') || 
              ip.startsWith('10.') || 
              ip.startsWith('192.168.') ||
              ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.') ||
              ip.startsWith('172.19.') || ip.startsWith('172.20.') || ip.startsWith('172.21.') ||
              ip.startsWith('172.22.') || ip.startsWith('172.23.') || ip.startsWith('172.24.') ||
              ip.startsWith('172.25.') || ip.startsWith('172.26.') || ip.startsWith('172.27.') ||
              ip.startsWith('172.28.') || ip.startsWith('172.29.') || ip.startsWith('172.30.') ||
              ip.startsWith('172.31.') || ip === '::1' ||
              ip.startsWith('fc00:') || ip.startsWith('fe80:') ||
              ip.startsWith('fd00:') || ip === '::') {
            continue;
          }
        }
        return ip;
      }
    }
  }
  
  // Priority 2: X-Real-IP header (nginx)
  const realIP = req.headers['x-real-ip'];
  if (realIP && isValidIP(realIP)) {
    return realIP;
  }
  
  // Priority 3: CF-Connecting-IP (Cloudflare)
  const cfIP = req.headers['cf-connecting-ip'];
  if (cfIP && isValidIP(cfIP)) {
    return cfIP;
  }
  
  // Priority 4: X-Client-IP (some proxies)
  const clientIP = req.headers['x-client-ip'];
  if (clientIP && isValidIP(clientIP)) {
    return clientIP;
  }
  
  // Priority 5: req.ip (Express)
  if (req.ip && isValidIP(req.ip)) {
    return req.ip;
  }
  
  // Priority 6: Socket remote address
  const socketIP = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (socketIP) {
    const strippedIP = socketIP.replace(/^::ffff:/, '');
    if (isValidIP(strippedIP)) {
      return strippedIP;
    }
  }
  
  logger.warn('Could not extract valid client IP', {
    headers: {
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip'],
      'cf-connecting-ip': req.headers['cf-connecting-ip'],
      'x-client-ip': req.headers['x-client-ip'],
    },
    reqIp: req.ip,
  });
  
  return 'unknown';
};

/**
 * Extract client identifier from request
 */
const getClientIdentifier = (req, identifierType = 'ip') => {
  switch (identifierType) {
  case 'user':
    return req.user?.id || req.headers['x-user-id'] || null;
    
  case 'apiKey':
    return req.headers['x-api-key'] || null;
    
  case 'ip':
  default:
    return extractClientIP(req);
  }
};

/**
 * Set comprehensive rate limit headers on response
 */
const setRateLimitHeaders = (res, rateLimiterRes, config) => {
  const remaining = Math.max(0, rateLimiterRes.remainingPoints);
  const resetTime = Math.ceil(Date.now() / 1000) + Math.ceil(rateLimiterRes.msBeforeNext / 1000);
  const resetInSeconds = Math.ceil(rateLimiterRes.msBeforeNext / 1000);
  
  const headers = {
    'X-RateLimit-Limit': String(config.points),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(resetTime),
    'X-RateLimit-Window': `${config.duration}s`,
  };
  
  if (remaining === 0) {
    headers['X-RateLimit-RetryAfter'] = String(resetInSeconds);
  }
  
  res.set(headers);
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

      // Consume point (sliding window counter)
      const rateLimiterRes = await rateLimiter.consume(key);

      // Set comprehensive rate limit headers
      setRateLimitHeaders(res, rateLimiterRes, config);

      next();
    } catch (error) {
      // Rate limit exceeded
      if (error.remainingPoints !== undefined) {
        const retryAfter = Math.ceil(error.msBeforeNext / 1000);
        const resetTime = Math.ceil(Date.now() / 1000) + retryAfter;
        
        res.set({
          'X-RateLimit-Limit': String(config.points),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetTime),
          'X-RateLimit-Window': `${config.duration}s`,
          'X-RateLimit-RetryAfter': String(retryAfter),
          'Retry-After': String(retryAfter),
        });

        logger.warn('Rate limit exceeded', {
          identifier: getClientIdentifier(req, config.identifierType),
          ip: extractClientIP(req),
          method: req.method,
          path: req.path,
          retryAfter,
          limit: config.points,
          window: config.duration,
        });

        return res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Too many requests. Please retry after ${retryAfter} seconds.`,
            retryAfter,
            retryAfterSeconds: retryAfter,
            limit: config.points,
            window: `${config.duration}s`,
            windowSeconds: config.duration,
            resetAt: new Date(resetTime * 1000).toISOString(),
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
 * 
 * These presets provide production-ready rate limiting configurations
 * for different types of endpoints and use cases.
 */
const rateLimiters_presets = {
  /**
   * General API rate limit
   * - 200 requests per minute per IP (increased from 100 for better UX)
   * - Use for standard public API endpoints
   */
  api: createRateLimiterMiddleware({
    keyPrefix: 'api',
    points: parseInt(process.env.API_RATE_LIMIT, 10) || 200,
    duration: parseInt(process.env.API_RATE_WINDOW, 10) || 60,
    identifierType: 'ip',
  }),

  /**
   * Authentication endpoints
   * - 10 requests per minute per IP
   * - 5 minute block after exceeding limit
   * - Use for /auth/*, /register, /verify endpoints
   */
  auth: createRateLimiterMiddleware({
    keyPrefix: 'auth',
    points: parseInt(process.env.AUTH_RATE_LIMIT, 10) || 10,
    duration: parseInt(process.env.AUTH_RATE_WINDOW, 10) || 60,
    blockDuration: parseInt(process.env.AUTH_BLOCK_DURATION, 10) || 300,
    identifierType: 'ip',
  }),

  /**
   * Login attempts
   * - 5 attempts per 15 minutes per IP
   * - 15 minute block after exceeding limit
   * - Prevents brute-force attacks
   */
  login: createRateLimiterMiddleware({
    keyPrefix: 'login',
    points: parseInt(process.env.LOGIN_RATE_LIMIT, 10) || 5,
    duration: parseInt(process.env.LOGIN_RATE_WINDOW, 10) || 900,
    blockDuration: parseInt(process.env.LOGIN_BLOCK_DURATION, 10) || 900,
    identifierType: 'ip',
  }),

  /**
   * Admin actions
   * - 50 requests per minute per user
   * - Use for administrative operations
   * - Requires authentication (user-based)
   */
  admin: createRateLimiterMiddleware({
    keyPrefix: 'admin',
    points: parseInt(process.env.ADMIN_RATE_LIMIT, 10) || 50,
    duration: parseInt(process.env.ADMIN_RATE_WINDOW, 10) || 60,
    identifierType: 'user',
  }),

  /**
   * Search/Query operations
   * - 30 requests per minute per IP
   * - Use for search, filter, query endpoints
   */
  search: createRateLimiterMiddleware({
    keyPrefix: 'search',
    points: parseInt(process.env.SEARCH_RATE_LIMIT, 10) || 30,
    duration: parseInt(process.env.SEARCH_RATE_WINDOW, 10) || 60,
    identifierType: 'ip',
  }),

  /**
   * Expensive operations
   * - 10 requests per minute per IP
   * - Use for resource-intensive endpoints (reports, exports, AI operations)
   */
  expensive: createRateLimiterMiddleware({
    keyPrefix: 'expensive',
    points: parseInt(process.env.EXPENSIVE_RATE_LIMIT, 10) || 10,
    duration: parseInt(process.env.EXPENSIVE_RATE_WINDOW, 10) || 60,
    identifierType: 'ip',
  }),

  /**
   * File upload
   * - 5 uploads per hour per IP
   * - Use for file upload endpoints
   */
  upload: createRateLimiterMiddleware({
    keyPrefix: 'upload',
    points: parseInt(process.env.UPLOAD_RATE_LIMIT, 10) || 5,
    duration: parseInt(process.env.UPLOAD_RATE_WINDOW, 10) || 3600,
    identifierType: 'ip',
  }),

  /**
   * Password reset
   * - 3 requests per hour per IP
   * - Prevents password reset abuse
   */
  passwordReset: createRateLimiterMiddleware({
    keyPrefix: 'password_reset',
    points: parseInt(process.env.PASSWORD_RESET_RATE_LIMIT, 10) || 3,
    duration: parseInt(process.env.PASSWORD_RESET_RATE_WINDOW, 10) || 3600,
    blockDuration: parseInt(process.env.PASSWORD_RESET_BLOCK_DURATION, 10) || 3600,
    identifierType: 'ip',
  }),

  /**
   * Email sending
   * - 10 emails per hour per IP
   * - Prevents email spam
   */
  email: createRateLimiterMiddleware({
    keyPrefix: 'email',
    points: parseInt(process.env.EMAIL_RATE_LIMIT, 10) || 10,
    duration: parseInt(process.env.EMAIL_RATE_WINDOW, 10) || 3600,
    identifierType: 'ip',
  }),

  /**
   * API key based
   * - 1000 requests per hour per API key
   * - Use for API key authenticated endpoints
   */
  apiKey: createRateLimiterMiddleware({
    keyPrefix: 'apikey',
    points: parseInt(process.env.APIKEY_RATE_LIMIT, 10) || 1000,
    duration: parseInt(process.env.APIKEY_RATE_WINDOW, 10) || 3600,
    identifierType: 'apiKey',
  }),
};

module.exports = {
  createRateLimiterMiddleware,
  rateLimiters: rateLimiters_presets,
  getClientIdentifier,
  extractClientIP,
  isValidIP,
  setRateLimitHeaders,
};
