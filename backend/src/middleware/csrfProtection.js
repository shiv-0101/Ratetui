/**
 * CSRF Protection Middleware
 * 
 * Implements Cross-Site Request Forgery protection using:
 * - Double-submit cookie pattern
 * - Synchronizer token pattern
 * - SameSite cookie attribute
 * 
 * Based on OWASP CSRF Prevention Cheat Sheet and TRD SR-025 requirement.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');
const { createError } = require('./errorHandler');

/**
 * Configuration
 */
const CSRF_CONFIG = {
  // Token settings
  TOKEN_LENGTH: 32,
  TOKEN_EXPIRY: parseInt(process.env.CSRF_TOKEN_EXPIRY, 10) || 3600000, // 1 hour
  
  // Cookie settings
  COOKIE_NAME: process.env.CSRF_COOKIE_NAME || 'XSRF-TOKEN',
  HEADER_NAME: process.env.CSRF_HEADER_NAME || 'X-XSRF-TOKEN',
  
  // Exclusions
  SAFE_METHODS: ['GET', 'HEAD', 'OPTIONS'],
  EXCLUDED_PATHS: [
    '/health',
    '/admin/auth/login',
    '/admin/auth/refresh',
  ],
  
  // Cookie options
  COOKIE_OPTIONS: {
    httpOnly: false, // Client needs to read for double-submit
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: parseInt(process.env.CSRF_TOKEN_EXPIRY, 10) || 3600000,
  },
};

/**
 * In-memory token store (for synchronizer pattern)
 * In production, use Redis for distributed systems
 */
const tokenStore = new Map();

/**
 * Clean up expired tokens periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of tokenStore.entries()) {
    if (data.expiry < now) {
      tokenStore.delete(token);
    }
  }
}, 60000); // Clean every minute

/**
 * Generate secure random token
 * @returns {string} Cryptographically secure random token
 */
const generateToken = () => {
  return crypto.randomBytes(CSRF_CONFIG.TOKEN_LENGTH).toString('base64url');
};

/**
 * Create CSRF token for session
 * @param {string} sessionId - Session identifier
 * @returns {string} CSRF token
 */
const createCsrfToken = (sessionId) => {
  const token = generateToken();
  const expiry = Date.now() + CSRF_CONFIG.TOKEN_EXPIRY;
  
  tokenStore.set(token, {
    sessionId,
    expiry,
    createdAt: Date.now(),
  });
  
  return token;
};

/**
 * Validate CSRF token
 * @param {string} token - Token to validate
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if valid
 */
const validateCsrfToken = (token, sessionId) => {
  if (!token || !sessionId) {
    return false;
  }
  
  const tokenData = tokenStore.get(token);
  
  if (!tokenData) {
    return false;
  }
  
  // Check expiry
  if (tokenData.expiry < Date.now()) {
    tokenStore.delete(token);
    return false;
  }
  
  // Check session match
  if (tokenData.sessionId !== sessionId) {
    logger.security('CSRF token session mismatch', {
      expectedSession: tokenData.sessionId,
      receivedSession: sessionId,
    });
    return false;
  }
  
  return true;
};

/**
 * Check if path is excluded from CSRF protection
 * @param {string} path - Request path
 * @returns {boolean}
 */
const isExcludedPath = (path) => {
  return CSRF_CONFIG.EXCLUDED_PATHS.some(excluded => {
    if (excluded.endsWith('*')) {
      return path.startsWith(excluded.slice(0, -1));
    }
    return path === excluded;
  });
};

/**
 * Extract session ID from request
 * Uses JWT token sub claim or session cookie
 * @param {Object} req - Express request
 * @returns {string|null}
 */
const extractSessionId = (req) => {
  // Try JWT token first (if authenticated)
  if (req.user && req.user.id) {
    return req.user.id;
  }
  
  // Try session cookie
  if (req.session && req.session.id) {
    return req.session.id;
  }
  
  // Fallback to IP + User-Agent fingerprint for anonymous users
  const ip = req.ip || req.socket.remoteAddress;
  const ua = req.get('user-agent') || 'unknown';
  return crypto.createHash('sha256').update(`${ip}:${ua}`).digest('hex');
};

/**
 * Double-submit cookie pattern validation
 * @param {Object} req - Express request
 * @returns {boolean}
 */
const validateDoubleSubmit = (req) => {
  // Get token from cookie
  const cookieToken = req.cookies?.[CSRF_CONFIG.COOKIE_NAME];
  
  // Get token from header or body
  const headerToken = req.get(CSRF_CONFIG.HEADER_NAME);
  const bodyToken = req.body?._csrf;
  
  const submittedToken = headerToken || bodyToken;
  
  if (!cookieToken || !submittedToken) {
    logger.security('CSRF validation failed: missing tokens', {
      hasCookie: !!cookieToken,
      hasHeader: !!headerToken,
      hasBody: !!bodyToken,
      path: req.path,
      method: req.method,
    });
    return false;
  }
  
  // Constant-time comparison to prevent timing attacks
  const cookieBuffer = Buffer.from(cookieToken, 'utf8');
  const submittedBuffer = Buffer.from(submittedToken, 'utf8');
  
  if (cookieBuffer.length !== submittedBuffer.length) {
    logger.security('CSRF validation failed: token length mismatch');
    return false;
  }
  
  const isValid = crypto.timingSafeEqual(cookieBuffer, submittedBuffer);
  
  if (!isValid) {
    logger.security('CSRF validation failed: token mismatch', {
      path: req.path,
      method: req.method,
    });
  }
  
  return isValid;
};

/**
 * CSRF protection middleware
 * Validates CSRF tokens for state-changing requests
 */
const csrfProtection = (req, res, next) => {
  try {
    // Skip safe methods
    if (CSRF_CONFIG.SAFE_METHODS.includes(req.method)) {
      return next();
    }
    
    // Skip excluded paths
    if (isExcludedPath(req.path)) {
      return next();
    }
    
    // Validate double-submit pattern
    if (!validateDoubleSubmit(req)) {
      logger.security('CSRF attack detected', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        userAgent: req.get('user-agent'),
      });
      
      return next(createError(403, 'CSRF_TOKEN_INVALID', 'Invalid or missing CSRF token'));
    }
    
    // Additionally validate synchronizer token if session exists
    const sessionId = extractSessionId(req);
    if (sessionId) {
      const token = req.cookies?.[CSRF_CONFIG.COOKIE_NAME];
      if (token && !validateCsrfToken(token, sessionId)) {
        logger.security('CSRF synchronizer token validation failed', {
          ip: req.ip,
          path: req.path,
          sessionId: sessionId.substring(0, 8) + '...',
        });
        
        return next(createError(403, 'CSRF_TOKEN_EXPIRED', 'CSRF token expired or invalid'));
      }
    }
    
    next();
  } catch (error) {
    logger.error('CSRF middleware error:', { error: error.message });
    next(createError(500, 'CSRF_ERROR', 'CSRF validation error'));
  }
};

/**
 * Generate and set CSRF token for session
 * Call this after authentication or session creation
 */
const setCsrfToken = (req, res, next) => {
  const sessionId = extractSessionId(req);
  const token = createCsrfToken(sessionId);
  
  // Set cookie for double-submit pattern
  res.cookie(CSRF_CONFIG.COOKIE_NAME, token, CSRF_CONFIG.COOKIE_OPTIONS);
  
  // Also provide in response for SPAs
  res.locals.csrfToken = token;
  
  next();
};

/**
 * Endpoint to get CSRF token
 */
const getCsrfToken = (req, res) => {
  const sessionId = extractSessionId(req);
  const token = createCsrfToken(sessionId);
  
  res.cookie(CSRF_CONFIG.COOKIE_NAME, token, CSRF_CONFIG.COOKIE_OPTIONS);
  
  res.json({
    csrfToken: token,
    expiresIn: CSRF_CONFIG.TOKEN_EXPIRY,
  });
};

/**
 * Clear CSRF token
 */
const clearCsrfToken = (req, res, next) => {
  const token = req.cookies?.[CSRF_CONFIG.COOKIE_NAME];
  if (token) {
    tokenStore.delete(token);
  }
  
  res.clearCookie(CSRF_CONFIG.COOKIE_NAME);
  
  if (next) {
    next();
  }
};

/**
 * Log CSRF configuration
 */
const logCsrfConfiguration = () => {
  logger.info('CSRF Protection: Configuration loaded');
  logger.info(`Cookie name: ${CSRF_CONFIG.COOKIE_NAME}`);
  logger.info(`Header name: ${CSRF_CONFIG.HEADER_NAME}`);
  logger.info(`Token expiry: ${CSRF_CONFIG.TOKEN_EXPIRY}ms`);
  logger.info(`Secure cookies: ${CSRF_CONFIG.COOKIE_OPTIONS.secure}`);
  logger.info(`SameSite: ${CSRF_CONFIG.COOKIE_OPTIONS.sameSite}`);
  logger.info(`Excluded paths: ${CSRF_CONFIG.EXCLUDED_PATHS.join(', ')}`);
};

/**
 * Get CSRF statistics
 */
const getCsrfStats = () => {
  const now = Date.now();
  let activeTokens = 0;
  let expiredTokens = 0;
  
  for (const [, data] of tokenStore.entries()) {
    if (data.expiry >= now) {
      activeTokens++;
    } else {
      expiredTokens++;
    }
  }
  
  return {
    activeTokens,
    expiredTokens,
    totalTokens: tokenStore.size,
    tokenExpiry: CSRF_CONFIG.TOKEN_EXPIRY,
  };
};

module.exports = {
  csrfProtection,
  setCsrfToken,
  getCsrfToken,
  clearCsrfToken,
  logCsrfConfiguration,
  getCsrfStats,
  createCsrfToken,
  validateCsrfToken,
  CSRF_CONFIG,
};
