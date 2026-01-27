/**
 * Authentication Middleware
 * 
 * Verifies JWT tokens and checks token blacklist
 * Attaches authenticated user to request object
 */

const {
  verifyAccessToken,
  extractTokenFromHeader,
  getTokenExpiry,
  decodeToken,
} = require('../services/jwt');
const { getRedisClient, isRedisConnected } = require('../config/redis');
const logger = require('../utils/logger');
const { createError } = require('./errorHandler');

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const authenticate = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      throw createError('UNAUTHORIZED', 'No authentication token provided');
    }

    // Verify token signature and expiration
    const decoded = verifyAccessToken(token);

    // Check if token is blacklisted (for logout functionality)
    if (isRedisConnected()) {
      const redis = getRedisClient();
      const blacklisted = await redis.get(`token:blacklist:${decoded.jti}`);

      if (blacklisted) {
        logger.warn('Blacklisted token used', { jti: decoded.jti, userId: decoded.sub });
        throw createError('UNAUTHORIZED', 'Token has been revoked');
      }
    } else {
      // If Redis is down, log warning but allow request (graceful degradation)
      // In production, you might want to deny requests instead
      logger.warn('Redis unavailable, cannot check token blacklist', { userId: decoded.sub });
    }

    // Attach user info to request
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      jti: decoded.jti,
    };

    // Log successful authentication
    logger.info('User authenticated', { 
      userId: req.user.id, 
      role: req.user.role,
      ip: req.ip 
    });

    next();
  } catch (error) {
    // Handle specific error cases
    if (error.status === 401) {
      return next(error);
    }

    // Handle JWT verification errors
    if (error.message.includes('expired')) {
      return next(createError('TOKEN_EXPIRED', 'Authentication token has expired'));
    }

    if (error.message.includes('invalid') || error.message.includes('malformed')) {
      return next(createError('UNAUTHORIZED', 'Invalid authentication token'));
    }

    // Generic authentication error
    logger.error('Authentication error', { 
      error: error.message,
      ip: req.ip 
    });
    
    return next(createError('UNAUTHORIZED', 'Authentication failed'));
  }
};

/**
 * Optional authentication middleware
 * Attaches user if token is valid, but doesn't fail if token is missing
 * Useful for endpoints that work both authenticated and unauthenticated
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      // No token provided, continue without authentication
      return next();
    }

    // Try to verify token
    const decoded = verifyAccessToken(token);

    // Check blacklist
    if (isRedisConnected()) {
      const redis = getRedisClient();
      const blacklisted = await redis.get(`token:blacklist:${decoded.jti}`);

      if (blacklisted) {
        // Token blacklisted, continue without authentication
        return next();
      }
    }

    // Attach user to request
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      jti: decoded.jti,
    };

    next();
  } catch (error) {
    // Token is invalid, but that's okay for optional auth
    // Continue without authentication
    next();
  }
};

/**
 * Middleware to check if user is authenticated
 * Use this after authenticate() to verify authentication succeeded
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return next(createError('UNAUTHORIZED', 'Authentication required'));
  }
  next();
};

/**
 * Add token to blacklist (for logout)
 * 
 * @param {string} jti - JWT ID
 * @param {number} expirySeconds - Seconds until token expires
 * @returns {Promise<boolean>} Success status
 */
const blacklistToken = async (jti, expirySeconds) => {
  if (!isRedisConnected()) {
    logger.warn('Redis unavailable, cannot blacklist token', { jti });
    return false;
  }

  try {
    const redis = getRedisClient();
    await redis.set(`token:blacklist:${jti}`, '1', 'EX', expirySeconds);
    logger.info('Token blacklisted', { jti, expirySeconds });
    return true;
  } catch (error) {
    logger.error('Failed to blacklist token', { error: error.message, jti });
    return false;
  }
};

/**
 * Store refresh token in Redis
 * 
 * @param {string} userId - User ID
 * @param {string} refreshToken - Refresh token
 * @param {number} expirySeconds - Seconds until token expires
 * @returns {Promise<boolean>} Success status
 */
const storeRefreshToken = async (userId, refreshToken, expirySeconds) => {
  if (!isRedisConnected()) {
    logger.warn('Redis unavailable, cannot store refresh token', { userId });
    return false;
  }

  try {
    const redis = getRedisClient();
    const key = `refresh:${userId}:${refreshToken}`;
    await redis.set(key, JSON.stringify({ userId, createdAt: Date.now() }), 'EX', expirySeconds);
    logger.info('Refresh token stored', { userId });
    return true;
  } catch (error) {
    logger.error('Failed to store refresh token', { error: error.message, userId });
    return false;
  }
};

/**
 * Verify refresh token exists in Redis
 * 
 * @param {string} userId - User ID
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<boolean>} Whether token is valid
 */
const verifyRefreshToken = async (userId, refreshToken) => {
  if (!isRedisConnected()) {
    logger.warn('Redis unavailable, cannot verify refresh token', { userId });
    return false;
  }

  try {
    const redis = getRedisClient();
    const key = `refresh:${userId}:${refreshToken}`;
    const data = await redis.get(key);
    return data !== null;
  } catch (error) {
    logger.error('Failed to verify refresh token', { error: error.message, userId });
    return false;
  }
};

/**
 * Delete refresh token from Redis
 * 
 * @param {string} userId - User ID
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<boolean>} Success status
 */
const deleteRefreshToken = async (userId, refreshToken) => {
  if (!isRedisConnected()) {
    logger.warn('Redis unavailable, cannot delete refresh token', { userId });
    return false;
  }

  try {
    const redis = getRedisClient();
    const key = `refresh:${userId}:${refreshToken}`;
    await redis.del(key);
    logger.info('Refresh token deleted', { userId });
    return true;
  } catch (error) {
    logger.error('Failed to delete refresh token', { error: error.message, userId });
    return false;
  }
};

module.exports = {
  authenticate,
  optionalAuthenticate,
  requireAuth,
  blacklistToken,
  storeRefreshToken,
  verifyRefreshToken,
  deleteRefreshToken,
};
