/**
 * Request Size Limit Middleware
 * 
 * Enforces comprehensive size limits on various parts of HTTP requests
 * to prevent memory exhaustion and DoS attacks
 */

const { createError } = require('./errorHandler');
const logger = require('../utils/logger');

// Configuration
const SIZE_LIMITS = {
  // Body size limits (already enforced by express.json/urlencoded)
  JSON_BODY: 100 * 1024, // 100 KB
  URL_ENCODED_BODY: 100 * 1024, // 100 KB
  
  // URL and query limits
  URL_LENGTH: 2048, // 2 KB (browser standard)
  QUERY_STRING_LENGTH: 1024, // 1 KB
  
  // Header limits
  HEADER_SIZE: 8 * 1024, // 8 KB (total all headers)
  HEADER_VALUE_LENGTH: 4 * 1024, // 4 KB per header value
  HEADER_COUNT: 50, // Max number of headers
  
  // Parameter limits
  PATH_PARAM_LENGTH: 200,
  QUERY_PARAM_VALUE_LENGTH: 1000,
  QUERY_PARAM_COUNT: 50,
};

/**
 * Validate URL length
 * Prevents excessively long URLs that can cause memory issues
 */
const validateUrlLength = (req, res, next) => {
  const url = req.originalUrl || req.url;
  
  if (url.length > SIZE_LIMITS.URL_LENGTH) {
    logger.warn('URL too long', {
      length: url.length,
      limit: SIZE_LIMITS.URL_LENGTH,
      path: req.path,
      ip: req.ip,
    });
    
    return next(createError('VALIDATION_ERROR', 
      `URL too long. Maximum ${SIZE_LIMITS.URL_LENGTH} characters allowed.`,
      { maxLength: SIZE_LIMITS.URL_LENGTH, actualLength: url.length }
    ));
  }
  
  next();
};

/**
 * Validate query string length
 * Prevents query strings from consuming excessive memory
 */
const validateQueryStringLength = (req, res, next) => {
  const queryString = req.url.split('?')[1] || '';
  
  if (queryString.length > SIZE_LIMITS.QUERY_STRING_LENGTH) {
    logger.warn('Query string too long', {
      length: queryString.length,
      limit: SIZE_LIMITS.QUERY_STRING_LENGTH,
      path: req.path,
      ip: req.ip,
    });
    
    return next(createError('VALIDATION_ERROR', 
      `Query string too long. Maximum ${SIZE_LIMITS.QUERY_STRING_LENGTH} characters allowed.`,
      { maxLength: SIZE_LIMITS.QUERY_STRING_LENGTH, actualLength: queryString.length }
    ));
  }
  
  next();
};

/**
 * Validate header count and sizes
 * Prevents header bomb attacks
 */
const validateHeaders = (req, res, next) => {
  const headers = req.headers || {};
  const headerCount = Object.keys(headers).length;
  
  // Check header count
  if (headerCount > SIZE_LIMITS.HEADER_COUNT) {
    logger.warn('Too many headers', {
      count: headerCount,
      limit: SIZE_LIMITS.HEADER_COUNT,
      path: req.path,
      ip: req.ip,
    });
    
    return next(createError('VALIDATION_ERROR', 
      `Too many headers. Maximum ${SIZE_LIMITS.HEADER_COUNT} allowed.`,
      { maxCount: SIZE_LIMITS.HEADER_COUNT, actualCount: headerCount }
    ));
  }
  
  // Calculate total header size
  let totalHeaderSize = 0;
  for (const [name, value] of Object.entries(headers)) {
    const headerSize = name.length + (Array.isArray(value) ? value.join(',').length : String(value).length);
    totalHeaderSize += headerSize;
    
    // Check individual header value size
    const valueLength = Array.isArray(value) ? value.join(',').length : String(value).length;
    if (valueLength > SIZE_LIMITS.HEADER_VALUE_LENGTH) {
      logger.warn('Header value too long', {
        header: name,
        length: valueLength,
        limit: SIZE_LIMITS.HEADER_VALUE_LENGTH,
        path: req.path,
        ip: req.ip,
      });
      
      return next(createError('VALIDATION_ERROR', 
        `Header '${name}' value too long. Maximum ${SIZE_LIMITS.HEADER_VALUE_LENGTH} characters allowed.`,
        { header: name, maxLength: SIZE_LIMITS.HEADER_VALUE_LENGTH, actualLength: valueLength }
      ));
    }
  }
  
  // Check total header size
  if (totalHeaderSize > SIZE_LIMITS.HEADER_SIZE) {
    logger.warn('Total header size too large', {
      size: totalHeaderSize,
      limit: SIZE_LIMITS.HEADER_SIZE,
      path: req.path,
      ip: req.ip,
    });
    
    return next(createError('VALIDATION_ERROR', 
      `Total header size too large. Maximum ${SIZE_LIMITS.HEADER_SIZE} bytes allowed.`,
      { maxSize: SIZE_LIMITS.HEADER_SIZE, actualSize: totalHeaderSize }
    ));
  }
  
  next();
};

/**
 * Validate query parameter count and sizes
 * Prevents query parameter bomb attacks
 */
const validateQueryParams = (req, res, next) => {
  const query = req.query || {};
  const paramCount = Object.keys(query).length;
  
  // Check parameter count
  if (paramCount > SIZE_LIMITS.QUERY_PARAM_COUNT) {
    logger.warn('Too many query parameters', {
      count: paramCount,
      limit: SIZE_LIMITS.QUERY_PARAM_COUNT,
      path: req.path,
      ip: req.ip,
    });
    
    return next(createError('VALIDATION_ERROR', 
      `Too many query parameters. Maximum ${SIZE_LIMITS.QUERY_PARAM_COUNT} allowed.`,
      { maxCount: SIZE_LIMITS.QUERY_PARAM_COUNT, actualCount: paramCount }
    ));
  }
  
  // Check each parameter value length
  for (const [key, value] of Object.entries(query)) {
    const valueLength = Array.isArray(value) ? value.join(',').length : String(value).length;
    
    if (valueLength > SIZE_LIMITS.QUERY_PARAM_VALUE_LENGTH) {
      logger.warn('Query parameter value too long', {
        param: key,
        length: valueLength,
        limit: SIZE_LIMITS.QUERY_PARAM_VALUE_LENGTH,
        path: req.path,
        ip: req.ip,
      });
      
      return next(createError('VALIDATION_ERROR', 
        `Query parameter '${key}' value too long. Maximum ${SIZE_LIMITS.QUERY_PARAM_VALUE_LENGTH} characters allowed.`,
        { param: key, maxLength: SIZE_LIMITS.QUERY_PARAM_VALUE_LENGTH, actualLength: valueLength }
      ));
    }
  }
  
  next();
};

/**
 * Validate path parameter sizes
 * Prevents excessively long path parameters
 */
const validatePathParams = (req, res, next) => {
  const params = req.params || {};
  
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.length > SIZE_LIMITS.PATH_PARAM_LENGTH) {
      logger.warn('Path parameter too long', {
        param: key,
        length: value.length,
        limit: SIZE_LIMITS.PATH_PARAM_LENGTH,
        path: req.path,
        ip: req.ip,
      });
      
      return next(createError('VALIDATION_ERROR', 
        `Path parameter '${key}' too long. Maximum ${SIZE_LIMITS.PATH_PARAM_LENGTH} characters allowed.`,
        { param: key, maxLength: SIZE_LIMITS.PATH_PARAM_LENGTH, actualLength: value.length }
      ));
    }
  }
  
  next();
};

/**
 * Body size error handler
 * Catches body size limit errors from express.json/urlencoded
 */
const bodyLimitErrorHandler = (err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    logger.warn('Request body too large', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    
    return next(createError('VALIDATION_ERROR', 
      `Request body too large. Maximum ${SIZE_LIMITS.JSON_BODY / 1024} KB allowed.`,
      { maxSize: SIZE_LIMITS.JSON_BODY }
    ));
  }
  
  next(err);
};

/**
 * Combined size limit validation middleware
 */
const validateSizeLimits = [
  validateUrlLength,
  validateQueryStringLength,
  validateHeaders,
  validateQueryParams,
  validatePathParams,
];

/**
 * Get current size limits configuration
 */
const getSizeLimits = () => {
  return { ...SIZE_LIMITS };
};

module.exports = {
  validateUrlLength,
  validateQueryStringLength,
  validateHeaders,
  validateQueryParams,
  validatePathParams,
  bodyLimitErrorHandler,
  validateSizeLimits,
  getSizeLimits,
  SIZE_LIMITS,
};
