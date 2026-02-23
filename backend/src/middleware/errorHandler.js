/**
 * Global Error Handler Middleware
 * 
 * Catches all errors and returns appropriate responses.
 * Sanitizes error messages in production to prevent information leakage.
 * Based on TRD section 11 Error Handling & Logging requirements.
 */

const logger = require('../utils/logger');
const { maskSensitiveData } = require('../utils/logger');

/**
 * Custom API Error class
 */
class ApiError extends Error {
  constructor(code, message, statusCode = 500, details = null) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error codes mapping with detailed configurations
 */
const ErrorCodes = {
  RATE_LIMIT_EXCEEDED: { status: 429, message: 'Too many requests', public: true, severity: 'medium' },
  IP_BLOCKED: { status: 403, message: 'IP address is blocked', public: true, severity: 'high' },
  USER_BLOCKED: { status: 403, message: 'User is blocked', public: true, severity: 'high' },
  ACCOUNT_LOCKED: { status: 429, message: 'Account is temporarily locked', public: true, severity: 'medium' },
  UNAUTHORIZED: { status: 401, message: 'Authentication required', public: true, severity: 'medium' },
  FORBIDDEN: { status: 403, message: 'Insufficient permissions', public: true, severity: 'medium' },
  VALIDATION_ERROR: { status: 400, message: 'Validation failed', public: true, severity: 'low' },
  NOT_FOUND: { status: 404, message: 'Resource not found', public: true, severity: 'low' },
  CONFLICT: { status: 409, message: 'Resource conflict', public: true, severity: 'low' },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error', public: false, severity: 'critical' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable', public: true, severity: 'high' },
  DATABASE_ERROR: { status: 503, message: 'Database service unavailable', public: false, severity: 'critical' },
  TIMEOUT: { status: 408, message: 'Request timeout', public: true, severity: 'medium' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'Request payload too large', public: true, severity: 'low' },
};Sanitize error message to prevent information leakage
 * Removes file paths, internal details, and sensitive information
 * @param {string} message - Error message to sanitize
 * @returns {string} Sanitized message
 */
const sanitizeErrorMessage = (message) => {
  if (!message || typeof message !== 'string') {
    return 'An error occurred';
  }
  
  let sanitized = message;
  
  // Remove file paths (Windows and Unix)
  sanitized = sanitized.replace(/[A-Za-z]:\\[\w\\/.-]+/g, '[PATH]');
  sanitized = sanitized.replace(/\/[\w\/.-]+\.js/g, '[PATH]');
  
  // Remove line numbers an with enhanced sanitization
 */
const errorHandler = (err, req, res, _next) => {
  // Default error values
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details = null;
  let errorConfig = null;

  // Handle known API errors
  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    errorCode = err.code;
    message = err.message;
    details = err.details;
    errorConfig = ErrorCodes[err.code];
  }
  // Handle validation errors (express-validator)
  else if (err.array && typeof err.array === 'function') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = err.array();
    errorConfig = ErrorCodes.VALIDATION_ERROR;
  }
  // Handle JWT errors
  else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorCode = 'UNAUTHORIZED';
    message = 'Invalid token';
    errorConfig = ErrorCodes.UNAUTHORIZED;
  }
  else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = 'UNAUTHORIZED';
    message = 'Token expired';
    errorConfig = ErrorCodes.UNAUTHORIZED;
  }
  // Handle CORS errors
  else if (err.message && err.message.includes('CORS')) {
    statusCode = 403;
    errorCode = 'FORBIDDEN';
    message = 'Cross-origin request blocked';
    errorConfig = ErrorCodes.FORBIDDEN;
  }
  // Handle Redis errors
  else if (err.name === 'ReplyError' || err.message?.includes('Redis')) {
    statusCode = 503;
    errorCode = 'SERVICE_UNAVAILABLE';
    message = 'Service temporarily unavailable';
    errorConfig = ErrorCodes.SERVICE_UNAVAILABLE;
  }
  // Handle timeout errors
  else if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
    statusCode = 408;
    errorCode = 'TIMEOUT';
    message = 'Request timeout';
    errorConfig = ErrorCodes.TIMEOUT;
  }
  // Handle payload too large
  else if (err.type === 'entity.too.large' || err.status === 413) {
    statusCode = 413;
    errorCode = 'PAYLOAD_TOO_LARGE';
    message = 'Request payload too large';
    errorConfig = ErrorCodes.PAYLOAD_TOO_LARGE;
  }

  // Log error with appropriate detail
  logError(err, req, statusCode, errorCode);

  // Sanitize message for production
  if (process.env.NODE_ENV === 'production') {
    // Only show public error messages in production
    if (!errorConfig?.public) {
      message = ErrorCodes.INTERNAL_ERROR.message;
      details = null;
    } else {
      // Sanitize even public messages
      message = sanitizeErrorMessage(message);
    }
    
    // Never leak details in production for 5xx errors
    if (statusCode >= 500) {
      details = null;
    }
    
    // Mask sensitive data in details if present
    if (details) {
      details = maskSensitiveData(details);
    }
  }

  // Build error response
  const errorResponse = {
    error: {
      code: errorCode,
      message,
      timestamp: new Date().toISOString(),
      requestId: req.id, // If request ID middleware is enabled
    }
  };

  // Add details for client errors in development or if explicitly provided
  if (details && (process.env.NODE_ENV === 'development' || statusCode < 500)) {
    errorResponse.error.details = details;
  }

  // Add stack trace in development only
  if (process.env.NODE_ENV === 'development' && err.stack) {
    errorResponse.error.stack = err.stack.split('\n');
  }

  // Set appropriate headers for error responses
  res.set({
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });

  // Send error response
  res.status(statusCode).json(errorResponse);
};

module.exports = errorHandler;
module.exports.ApiError = ApiError;
module.exports.createError = createError;
module.exports.ErrorCodes = ErrorCodes;
module.exports.sanitizeErrorMessage = sanitizeErrorMessage error occurred', {
        path: req.path,
        method: req.method,
        ip: req.ip,
      });
    }
  } else if (statusCode >= 400) {
    logger.warn('Client error', logData);
    
    // Log security events for suspicious activity
    if (errorCode === 'UNAUTHORIZED' || errorCode === 'FORBIDDEN') {
      logger.security('Authorization failure', {
        path: req.path,
        method: req.method,
        ip: req.ip,
        errorCode,
      });
    }
  } else {
    logger.info('Request error', logData);
  }
};

/**
 * 

/**
 * Create standardized error
 */
const createError = (code, customMessage = null, details = null) => {
  const errorConfig = ErrorCodes[code] || ErrorCodes.INTERNAL_ERROR;
  return new ApiError(
    code,
    customMessage || errorConfig.message,
    errorConfig.status,
    details
  );
};

/**
 * Error handler middleware
 */
const errorHandler = (err, req, res, _next) => {
  // Log error
  logger.error('Error occurred', {
    error: err.message,
    code: err.code,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  // Default error values
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details = null;

  // Handle known API errors
  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    errorCode = err.code;
    message = err.message;
    details = err.details;
  }
  // Handle validation errors (express-validator)
  else if (err.array && typeof err.array === 'function') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = err.array();
  }
  // Handle JWT errors
  else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorCode = 'UNAUTHORIZED';
    message = 'Invalid token';
  }
  else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = 'UNAUTHORIZED';
    message = 'Token expired';
  }
  // Handle CORS errors
  else if (err.message && err.message.includes('CORS')) {
    statusCode = 403;
    errorCode = 'FORBIDDEN';
    message = 'Cross-origin request blocked';
  }
  // Handle Redis errors
  else if (err.name === 'ReplyError' || err.message?.includes('Redis')) {
    statusCode = 503;
    errorCode = 'SERVICE_UNAVAILABLE';
    message = 'Service temporarily unavailable';
  }

  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'An unexpected error occurred';
    details = null;
  }

  // Send error response
  res.status(statusCode).json({
    error: {
      code: errorCode,
      message,
      ...(details && { details }),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    }
  });
};

module.exports = errorHandler;
module.exports.ApiError = ApiError;
module.exports.createError = createError;
module.exports.ErrorCodes = ErrorCodes;
