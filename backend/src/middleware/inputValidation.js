/**
 * Input Validation Middleware
 * 
 * Comprehensive input validation to prevent injection attacks and ensure data integrity
 */

const { createError } = require('./errorHandler');
const logger = require('../utils/logger');

/**
 * Validate JSON payload structure
 * Prevents prototype pollution and invalid JSON
 */
const validateJsonPayload = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'DELETE' || req.method === 'HEAD') {
    return next();
  }

  // Check if Content-Type is application/json for POST/PUT/PATCH
  const contentType = req.get('Content-Type');
  if (!contentType || !contentType.includes('application/json')) {
    // Allow URL encoded for specific routes
    if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
      return next();
    }
    
    logger.warn('Invalid Content-Type', {
      method: req.method,
      path: req.path,
      contentType,
      ip: req.ip,
    });
    
    return next(createError('VALIDATION_ERROR', 'Content-Type must be application/json'));
  }

  // Check if body was parsed correctly
  if (req.body === undefined) {
    logger.warn('Request body is undefined', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    
    return next(createError('VALIDATION_ERROR', 'Invalid or empty request body'));
  }

  // Ensure body is an object (not string, number, etc.)
  if (req.body !== null && typeof req.body !== 'object') {
    logger.warn('Request body is not an object', {
      method: req.method,
      path: req.path,
      bodyType: typeof req.body,
      ip: req.ip,
    });
    
    return next(createError('VALIDATION_ERROR', 'Request body must be a JSON object'));
  }

  // Check for prototype pollution attempts
  if (hasPrototypePollution(req.body)) {
    logger.security('Prototype pollution attempt detected', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    
    return next(createError('VALIDATION_ERROR', 'Invalid request: dangerous property names detected'));
  }

  next();
};

/**
 * Validate query parameters
 * Ensures query params don't contain dangerous values
 */
const validateQueryParams = (req, res, next) => {
  if (!req.query || Object.keys(req.query).length === 0) {
    return next();
  }

  // Check for prototype pollution in query params
  if (hasPrototypePollution(req.query)) {
    logger.security('Prototype pollution attempt in query params', {
      path: req.path,
      ip: req.ip,
    });
    
    return next(createError('VALIDATION_ERROR', 'Invalid query parameters'));
  }

  // Limit query parameter count
  const queryCount = Object.keys(req.query).length;
  if (queryCount > 50) {
    logger.warn('Too many query parameters', {
      path: req.path,
      count: queryCount,
      ip: req.ip,
    });
    
    return next(createError('VALIDATION_ERROR', 'Too many query parameters'));
  }

  // Validate query parameter values
  for (const [key, value] of Object.entries(req.query)) {
    // Check for excessively long values
    if (typeof value === 'string' && value.length > 1000) {
      logger.warn('Query parameter value too long', {
        path: req.path,
        key,
        length: value.length,
        ip: req.ip,
      });
      
      return next(createError('VALIDATION_ERROR', `Query parameter '${key}' is too long`));
    }

    // Check for null bytes (potential for header injection)
    if (typeof value === 'string' && value.includes('\0')) {
      logger.security('Null byte in query parameter', {
        path: req.path,
        key,
        ip: req.ip,
      });
      
      return next(createError('VALIDATION_ERROR', 'Invalid query parameter value'));
    }
  }

  next();
};

/**
 * Validate URL path parameters
 * Prevents path traversal and injection
 */
const validatePathParams = (req, res, next) => {
  if (!req.params || Object.keys(req.params).length === 0) {
    return next();
  }

  for (const [key, value] of Object.entries(req.params)) {
    if (typeof value !== 'string') {
      continue;
    }

    // Check for path traversal attempts
    if (value.includes('..') || value.includes('./') || value.includes('.\\')) {
      logger.security('Path traversal attempt detected', {
        path: req.path,
        param: key,
        value,
        ip: req.ip,
      });
      
      return next(createError('VALIDATION_ERROR', 'Invalid path parameter'));
    }

    // Check for null bytes
    if (value.includes('\0')) {
      logger.security('Null byte in path parameter', {
        path: req.path,
        param: key,
        ip: req.ip,
      });
      
      return next(createError('VALIDATION_ERROR', 'Invalid path parameter'));
    }

    // Check for excessively long values
    if (value.length > 200) {
      logger.warn('Path parameter too long', {
        path: req.path,
        param: key,
        length: value.length,
        ip: req.ip,
      });
      
      return next(createError('VALIDATION_ERROR', `Path parameter '${key}' is too long`));
    }
  }

  next();
};

/**
 * Validate HTTP headers
 * Prevents header injection attacks
 */
const validateHeaders = (req, res, next) => {
  const dangerousHeaders = ['x-forwarded-host', 'x-original-url', 'x-rewrite-url'];

  for (const header of dangerousHeaders) {
    if (req.get(header)) {
      logger.security('Dangerous header detected', {
        header,
        path: req.path,
        ip: req.ip,
      });
    }
  }

  // Validate Authorization header format if present
  const authHeader = req.get('Authorization');
  if (authHeader) {
    // Check for header injection attempts
    if (authHeader.includes('\n') || authHeader.includes('\r')) {
      logger.security('Header injection attempt in Authorization', {
        path: req.path,
        ip: req.ip,
      });
      
      return next(createError('VALIDATION_ERROR', 'Invalid Authorization header'));
    }

    // Validate Bearer token format
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      // Token should be alphanumeric with dots (JWT) or hex (API key)
      if (!/^[A-Za-z0-9._-]+$/.test(token)) {
        logger.warn('Invalid token format in Authorization header', {
          path: req.path,
          ip: req.ip,
        });
        
        return next(createError('VALIDATION_ERROR', 'Invalid token format'));
      }
    }
  }

  // Validate Content-Length if present
  const contentLength = req.get('Content-Length');
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (isNaN(length) || length < 0) {
      logger.warn('Invalid Content-Length header', {
        path: req.path,
        contentLength,
        ip: req.ip,
      });
      
      return next(createError('VALIDATION_ERROR', 'Invalid Content-Length header'));
    }
  }

  next();
};

/**
 * Check for prototype pollution in object
 * 
 * @param {*} obj - Object to check
 * @returns {boolean} True if prototype pollution detected
 */
const hasPrototypePollution = (obj) => {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const dangerousKeys = [
    '__proto__',
    'constructor',
    'prototype',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__',
  ];

  // Check direct properties
  for (const key of Object.keys(obj)) {
    if (dangerousKeys.includes(key)) {
      return true;
    }

    // Recursively check nested objects
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      if (hasPrototypePollution(obj[key])) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Sanitize input by removing dangerous properties
 * 
 * @param {*} obj - Object to sanitize
 * @returns {*} Sanitized object
 */
const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const sanitized = {};
  const dangerousKeys = [
    '__proto__',
    'constructor',
    'prototype',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__',
  ];

  for (const [key, value] of Object.entries(obj)) {
    if (!dangerousKeys.includes(key)) {
      if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
  }

  return sanitized;
};

/**
 * Combined validation middleware
 * Applies all validation checks
 */
const validateAllInputs = [
  validateHeaders,
  validateQueryParams,
  validatePathParams,
  validateJsonPayload,
];

module.exports = {
  validateJsonPayload,
  validateQueryParams,
  validatePathParams,
  validateHeaders,
  validateAllInputs,
  hasPrototypePollution,
  sanitizeObject,
};
