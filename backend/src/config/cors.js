/**
 * CORS Configuration
 * 
 * Configures Cross-Origin Resource Sharing with strict whitelist security.
 * Implements defense-in-depth approach for cross-origin requests.
 */

const logger = require('../utils/logger');

/**
 * Parse allowed origins from environment
 * Validates and normalizes origin URLs
 * 
 * @returns {Array<string>} Array of allowed origin URLs
 */
const getAllowedOrigins = () => {
  const originsEnv = process.env.CORS_ORIGINS || 'http://localhost:3001';
  const origins = originsEnv.split(',').map(origin => origin.trim());
  
  // Validate each origin
  const validOrigins = [];
  
  for (const origin of origins) {
    if (!origin) continue;
    
    // Check if origin is a valid URL format
    try {
      const url = new URL(origin);
      
      // Ensure protocol is http or https
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        logger.warn('Invalid CORS origin protocol', { origin, protocol: url.protocol });
        continue;
      }
      
      // Warn if using http in production
      if (process.env.NODE_ENV === 'production' && url.protocol === 'http:') {
        logger.warn('HTTP origin in production CORS whitelist', { origin });
      }
      
      validOrigins.push(origin);
    } catch (error) {
      logger.error('Invalid CORS origin URL', { origin, error: error.message });
    }
  }
  
  if (validOrigins.length === 0) {
    logger.warn('No valid CORS origins configured, using default');
    return ['http://localhost:3001'];
  }
  
  return validOrigins;
};

/**
 * Check if origin is allowed
 * 
 * @param {string} origin - Origin to check
 * @param {Array<string>} allowedOrigins - List of allowed origins
 * @returns {boolean} True if origin is allowed
 */
const isOriginAllowed = (origin, allowedOrigins) => {
  if (!origin) {
    return false;
  }
  
  // Exact match
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  
  // Check for wildcard subdomain patterns (e.g., *.example.com)
  // Note: This is disabled by default for security. Enable only if needed.
  const allowWildcard = process.env.CORS_ALLOW_WILDCARD === 'true';
  
  if (allowWildcard) {
    for (const allowed of allowedOrigins) {
      if (allowed.startsWith('*.')) {
        const domain = allowed.substring(2);
        try {
          const originUrl = new URL(origin);
          if (originUrl.hostname.endsWith(domain)) {
            logger.info('CORS: Origin matched wildcard pattern', {
              origin,
              pattern: allowed,
            });
            return true;
          }
        } catch (error) {
          // Invalid origin URL, skip
        }
      }
    }
  }
  
  return false;
};

/**
 * Validate CORS configuration
 * 
 * @returns {Object} Validation result
 */
const validateCorsConfig = () => {
  const errors = [];
  const warnings = [];
  const allowedOrigins = getAllowedOrigins();
  
  // Check if origins are configured
  if (allowedOrigins.length === 0) {
    errors.push('No CORS origins configured');
  }
  
  // Check for localhost/127.0.0.1 in production
  if (process.env.NODE_ENV === 'production') {
    const localhostOrigins = allowedOrigins.filter(origin =>
      origin.includes('localhost') || origin.includes('127.0.0.1')
    );
    
    if (localhostOrigins.length > 0) {
      warnings.push(`Localhost origins in production: ${localhostOrigins.join(', ')}`);
    }
  }
  
  // Check for wildcard origins (*)
  if (allowedOrigins.includes('*')) {
    errors.push('Wildcard (*) origin is not secure. Use specific origins.');
  }
  
  // Check for http origins in production
  if (process.env.NODE_ENV === 'production') {
    const httpOrigins = allowedOrigins.filter(origin => origin.startsWith('http://'));
    if (httpOrigins.length > 0) {
      warnings.push(`HTTP origins in production: ${httpOrigins.join(', ')}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    secure: errors.length === 0 && warnings.length === 0,
    errors,
    warnings,
    allowedOrigins,
  };
};

/**
 * CORS options with strict whitelist
 */
const corsOptions = {
  /**
   * Origin validation function
   * Implements strict whitelist checking
   */
  origin: (origin, callback) => {
    const allowedOrigins = getAllowedOrigins();
    
    // Log CORS request for monitoring
    logger.debug('CORS request', {
      origin: origin || 'no-origin',
      allowed: allowedOrigins,
    });
    
    // Handle requests with no origin
    // (e.g., mobile apps, Postman, curl, same-origin requests)
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        // In production, require origin for security
        // Exception: Allow for server-to-server requests
        const allowNoOrigin = process.env.CORS_ALLOW_NO_ORIGIN === 'true';
        
        if (!allowNoOrigin) {
          logger.warn('CORS: Request with no origin blocked in production');
          return callback(new Error('CORS: Origin required in production'), false);
        }
      }
      
      // Allow in development
      return callback(null, true);
    }
    
    // Check if origin is in whitelist
    if (isOriginAllowed(origin, allowedOrigins)) {
      logger.debug('CORS: Origin allowed', { origin });
      return callback(null, true);
    }
    
    // Origin not allowed
    logger.warn('CORS: Origin blocked', {
      origin,
      allowedOrigins,
      ip: 'unknown', // IP not available in this context
    });
    
    return callback(new Error('CORS: Origin not in whitelist'), false);
  },
  
  /**
   * Allowed HTTP methods
   * Restrict to only methods used by the API
   */
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  
  /**
   * Allowed request headers
   * Whitelist only necessary headers
   */
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-ID',
    'Accept',
    'Origin',
  ],
  
  /**
   * Exposed response headers
   * Headers that client JavaScript can access
   */
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-RateLimit-Policy',
    'Retry-After',
    'X-Request-ID',
  ],
  
  /**
   * Allow credentials (cookies, authorization headers)
   * Required for authenticated requests
   */
  credentials: true,
  
  /**
   * Preflight cache duration (in seconds)
   * 24 hours - reduces preflight requests
   */
  maxAge: 86400,
  
  /**
   * Pass preflight response to next handler
   * False = end the request after preflight
   */
  preflightContinue: false,
  
  /**
   * Success status code for OPTIONS requests
   * 204 No Content (more efficient than 200)
   */
  optionsSuccessStatus: 204,
};

/**
 * Log CORS configuration on startup
 */
const logCorsConfiguration = () => {
  const validation = validateCorsConfig();
  
  logger.info('CORS Configuration', {
    allowedOrigins: validation.allowedOrigins,
    originCount: validation.allowedOrigins.length,
    credentials: corsOptions.credentials,
    methods: corsOptions.methods,
    environment: process.env.NODE_ENV,
    valid: validation.valid,
    secure: validation.secure,
  });
  
  if (validation.errors.length > 0) {
    logger.error('CORS configuration errors', { errors: validation.errors });
  }
  
  if (validation.warnings.length > 0) {
    logger.warn('CORS configuration warnings', { warnings: validation.warnings });
  }
  
  if (validation.secure) {
    logger.info('CORS configuration is secure');
  }
};

/**
 * Get CORS status for health checks
 * 
 * @returns {Object} CORS status
 */
const getCorsStatus = () => {
  const validation = validateCorsConfig();
  
  return {
    enabled: true,
    mode: 'whitelist',
    allowedOrigins: validation.allowedOrigins,
    originCount: validation.allowedOrigins.length,
    credentials: corsOptions.credentials,
    valid: validation.valid,
    secure: validation.secure,
    errors: validation.errors,
    warnings: validation.warnings,
  };
};

/**
 * Check if a specific origin would be allowed
 * Utility function for testing
 * 
 * @param {string} origin - Origin to test
 * @returns {Object} Check result
 */
const checkOrigin = (origin) => {
  const allowedOrigins = getAllowedOrigins();
  const allowed = isOriginAllowed(origin, allowedOrigins);
  
  return {
    origin,
    allowed,
    reason: allowed ? 'In whitelist' : 'Not in whitelist',
    whitelist: allowedOrigins,
  };
};

module.exports = {
  corsOptions,
  getAllowedOrigins,
  validateCorsConfig,
  logCorsConfiguration,
  getCorsStatus,
  checkOrigin,
  isOriginAllowed,
};
