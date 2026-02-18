/**
 * Content-Type Validation Middleware
 * 
 * Enforces proper Content-Type headers for requests
 * Prevents content-type confusion attacks and ensures proper parsing
 */

const { createError } = require('./errorHandler');
const logger = require('../utils/logger');

// Allowed content types for POST/PUT/PATCH requests
const ALLOWED_CONTENT_TYPES = {
  JSON: 'application/json',
  URL_ENCODED: 'application/x-www-form-urlencoded',
  MULTIPART: 'multipart/form-data', // Not used in this app, but defined for completeness
};

// Methods that require a body
const METHODS_WITH_BODY = ['POST', 'PUT', 'PATCH'];

/**
 * Strict Content-Type validation for JSON API
 * Ensures requests with body have proper Content-Type
 */
const validateContentType = (req, res, next) => {
  // Skip for methods without body
  if (!METHODS_WITH_BODY.includes(req.method)) {
    return next();
  }

  // Skip for health check and similar routes
  if (req.path === '/health' || req.path.startsWith('/health/')) {
    return next();
  }

  const contentType = req.get('Content-Type');

  // Check if Content-Type header is present
  if (!contentType) {
    logger.warn('Missing Content-Type header', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });

    return next(createError('VALIDATION_ERROR', 
      `Content-Type header is required for ${req.method} requests`
    ));
  }

  // Extract base content type (remove charset and other parameters)
  const baseContentType = contentType.split(';')[0].trim().toLowerCase();

  // Check if content type is allowed
  const isAllowed = Object.values(ALLOWED_CONTENT_TYPES).some(
    allowed => baseContentType === allowed.toLowerCase()
  );

  if (!isAllowed) {
    logger.warn('Invalid Content-Type', {
      method: req.method,
      path: req.path,
      contentType: baseContentType,
      ip: req.ip,
    });

    return next(createError('VALIDATION_ERROR', 
      `Invalid Content-Type: ${baseContentType}. Allowed types: ${Object.values(ALLOWED_CONTENT_TYPES).join(', ')}`
    ));
  }

  // For JSON API routes, enforce JSON content type
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/')) {
    if (baseContentType !== ALLOWED_CONTENT_TYPES.JSON.toLowerCase()) {
      logger.warn('Non-JSON Content-Type for API route', {
        method: req.method,
        path: req.path,
        contentType: baseContentType,
        ip: req.ip,
      });

      return next(createError('VALIDATION_ERROR', 
        `API routes require Content-Type: ${ALLOWED_CONTENT_TYPES.JSON}`
      ));
    }
  }

  // Validate charset if specified
  if (contentType.includes('charset=')) {
    const charset = contentType.split('charset=')[1]?.split(';')[0]?.trim().toLowerCase();
    
    if (charset && charset !== 'utf-8' && charset !== 'utf8') {
      logger.warn('Invalid charset', {
        method: req.method,
        path: req.path,
        charset,
        ip: req.ip,
      });

      return next(createError('VALIDATION_ERROR', 
        'Only UTF-8 charset is supported'
      ));
    }
  }

  next();
};

/**
 * Validate Accept header
 * Ensures client can handle JSON responses
 */
const validateAcceptHeader = (req, res, next) => {
  const accept = req.get('Accept');

  // Skip if no Accept header (will default to JSON)
  if (!accept) {
    return next();
  }

  // Parse Accept header
  const acceptTypes = accept.split(',').map(type => type.split(';')[0].trim().toLowerCase());

  // Check if JSON is accepted
  const acceptsJson = acceptTypes.some(type => 
    type === 'application/json' || 
    type === '*/*' || 
    type === 'application/*'
  );

  if (!acceptsJson) {
    logger.warn('Client does not accept JSON', {
      path: req.path,
      accept,
      ip: req.ip,
    });

    return next(createError('VALIDATION_ERROR', 
      'This API only returns JSON. Accept header must include application/json'
    ));
  }

  next();
};

/**
 * Prevent MIME type sniffing
 * Ensures response content type matches actual content
 */
const preventMimeSniffing = (req, res, next) => {
  // Set X-Content-Type-Options header (also set by Helmet, but double protection)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};

/**
 * Validate request has valid JSON body for JSON content type
 * Catches JSON parsing errors early
 */
const validateJsonBody = (err, req, res, next) => {
  // Check if error is from JSON parsing
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.warn('Invalid JSON in request body', {
      method: req.method,
      path: req.path,
      error: err.message,
      ip: req.ip,
    });

    return next(createError('VALIDATION_ERROR', 
      'Invalid JSON in request body',
      { details: 'Request body must be valid JSON' }
    ));
  }

  // Check for unexpected token errors
  if (err && err.type === 'entity.parse.failed') {
    logger.warn('Failed to parse request body', {
      method: req.method,
      path: req.path,
      error: err.message,
      ip: req.ip,
    });

    return next(createError('VALIDATION_ERROR', 
      'Failed to parse request body',
      { details: err.message }
    ));
  }

  next(err);
};

/**
 * Ensure response Content-Type is set correctly
 * Middleware to set JSON content type for all API responses
 */
const setJsonContentType = (req, res, next) => {
  // Set default Content-Type for API responses
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/')) {
    res.type('application/json; charset=utf-8');
  }
  next();
};

/**
 * Combined content type validation middleware
 */
const validateContentTypes = [
  preventMimeSniffing,
  validateContentType,
  validateAcceptHeader,
  setJsonContentType,
];

module.exports = {
  validateContentType,
  validateAcceptHeader,
  preventMimeSniffing,
  validateJsonBody,
  setJsonContentType,
  validateContentTypes,
  ALLOWED_CONTENT_TYPES,
};
