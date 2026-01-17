/**
 * Global Error Handler Middleware
 * 
 * Catches all errors and returns appropriate responses.
 * Sanitizes error messages in production to prevent information leakage.
 */

const logger = require('../utils/logger');

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
 * Error codes mapping
 */
const ErrorCodes = {
  RATE_LIMIT_EXCEEDED: { status: 429, message: 'Too many requests' },
  IP_BLOCKED: { status: 403, message: 'IP address is blocked' },
  USER_BLOCKED: { status: 403, message: 'User is blocked' },
  UNAUTHORIZED: { status: 401, message: 'Authentication required' },
  FORBIDDEN: { status: 403, message: 'Insufficient permissions' },
  VALIDATION_ERROR: { status: 400, message: 'Validation failed' },
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  CONFLICT: { status: 409, message: 'Resource conflict' },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable' },
};

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
const errorHandler = (err, req, res, next) => {
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
