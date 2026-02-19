/**
 * NoSQL Injection Prevention Middleware
 * 
 * Protects against NoSQL injection attacks in Redis operations
 * Ensures all Redis commands use safe parameterization and validated inputs
 */

const { createError } = require('./errorHandler');
const logger = require('../utils/logger');

/**
 * Characters that are safe in Redis keys
 * Alphanumeric, dash, underscore, colon (Redis convention for namespacing)
 */
const SAFE_KEY_PATTERN = /^[a-zA-Z0-9:_\-\.]+$/;

/**
 * Maximum length for Redis keys
 * Redis allows up to 512MB keys, but we limit for security
 */
const MAX_KEY_LENGTH = 200;

/**
 * Maximum length for Redis values in user input
 */
const MAX_VALUE_LENGTH = 10000;

/**
 * Dangerous patterns that might indicate injection attempts
 */
const DANGEROUS_PATTERNS = [
  /eval/i,              // Lua eval command
  /script/i,            // Script commands
  /keys\s+\*/i,         // Keys * command (can cause DoS)
  /flushall/i,          // Flush all data
  /flushdb/i,           // Flush database
  /config/i,            // Config commands
  /shutdown/i,          // Shutdown command
  /debug/i,             // Debug commands
  /\r\n/,               // CRLF injection
  /;\s*\w+/,            // Command chaining attempt
  /\|\|/,               // OR injection
  /&&/,                 // AND injection
];

/**
 * Validate Redis key format
 * Ensures key only contains safe characters
 * 
 * @param {string} key - Redis key to validate
 * @param {string} context - Context for logging (e.g., 'rate limit', 'session')
 * @returns {Object} { isValid: boolean, error: string | null }
 */
const validateRedisKey = (key, context = 'unknown') => {
  // Check if key is string
  if (typeof key !== 'string') {
    return {
      isValid: false,
      error: 'Redis key must be a string',
    };
  }

  // Check key length
  if (key.length === 0) {
    return {
      isValid: false,
      error: 'Redis key cannot be empty',
    };
  }

  if (key.length > MAX_KEY_LENGTH) {
    return {
      isValid: false,
      error: `Redis key exceeds maximum length (${MAX_KEY_LENGTH} characters)`,
    };
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(key)) {
      logger.security('Dangerous pattern detected in Redis key', {
        key,
        context,
        pattern: pattern.toString(),
      });

      return {
        isValid: false,
        error: 'Redis key contains dangerous pattern',
      };
    }
  }

  // Check for safe characters only
  if (!SAFE_KEY_PATTERN.test(key)) {
    return {
      isValid: false,
      error: 'Redis key contains invalid characters (only alphanumeric, :, -, _, . allowed)',
    };
  }

  return {
    isValid: true,
    error: null,
  };
};

/**
 * Validate Redis value
 * Ensures value is safe to store
 * 
 * @param {*} value - Value to validate
 * @returns {Object} { isValid: boolean, error: string | null }
 */
const validateRedisValue = (value) => {
  // Allow null/undefined
  if (value === null || value === undefined) {
    return { isValid: true, error: null };
  }

  // Check string values
  if (typeof value === 'string') {
    if (value.length > MAX_VALUE_LENGTH) {
      return {
        isValid: false,
        error: `Value exceeds maximum length (${MAX_VALUE_LENGTH} characters)`,
      };
    }

    // Check for command injection attempts
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(value)) {
        logger.security('Dangerous pattern detected in Redis value', {
          pattern: pattern.toString(),
        });

        return {
          isValid: false,
          error: 'Value contains dangerous pattern',
        };
      }
    }
  }

  // Check number values
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return {
        isValid: false,
        error: 'Number value must be finite',
      };
    }
  }

  // Check object/array values (will be JSON stringified)
  if (typeof value === 'object') {
    try {
      const jsonString = JSON.stringify(value);
      if (jsonString.length > MAX_VALUE_LENGTH) {
        return {
          isValid: false,
          error: `Serialized value exceeds maximum length (${MAX_VALUE_LENGTH} characters)`,
        };
      }
    } catch (error) {
      return {
        isValid: false,
        error: 'Value cannot be serialized to JSON',
      };
    }
  }

  return { isValid: true, error: null };
};

/**
 * Sanitize user input for use in Redis commands
 * Removes dangerous characters and patterns
 * 
 * @param {string} input - User input to sanitize
 * @returns {string} Sanitized input
 */
const sanitizeRedisInput = (input) => {
  if (typeof input !== 'string') {
    return String(input);
  }

  // Remove CRLF characters (prevent command injection)
  let sanitized = input.replace(/[\r\n]/g, '');

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
};

/**
 * Validate Redis command parameters
 * Used before executing Redis operations with user input
 * 
 * @param {Object} params - Parameters object
 * @param {string} params.key - Redis key
 * @param {*} params.value - Redis value (optional)
 * @param {string} params.operation - Operation name for logging
 * @returns {Object} { isValid: boolean, errors: Array }
 */
const validateRedisOperation = ({ key, value, operation = 'unknown' }) => {
  const errors = [];

  // Validate key
  if (key !== undefined) {
    const keyValidation = validateRedisKey(key, operation);
    if (!keyValidation.isValid) {
      errors.push({ field: 'key', message: keyValidation.error });
    }
  }

  // Validate value
  if (value !== undefined) {
    const valueValidation = validateRedisValue(value);
    if (!valueValidation.isValid) {
      errors.push({ field: 'value', message: valueValidation.error });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Validate Redis pattern for SCAN operations
 * Patterns can use * and ? wildcards but must be controlled
 * 
 * @param {string} pattern - Redis pattern to validate
 * @returns {Object} { isValid: boolean, error: string | null }
 */
const validateRedisPattern = (pattern) => {
  if (typeof pattern !== 'string') {
    return {
      isValid: false,
      error: 'Pattern must be a string',
    };
  }

  if (pattern.length > MAX_KEY_LENGTH) {
    return {
      isValid: false,
      error: `Pattern exceeds maximum length (${MAX_KEY_LENGTH} characters)`,
    };
  }

  // Don't allow just "*" as it scans all keys (DoS risk)
  if (pattern === '*') {
    logger.warn('Attempt to scan all Redis keys blocked');
    return {
      isValid: false,
      error: 'Wild scan not allowed (security risk)',
    };
  }

  // Pattern must have a namespace prefix (at least 3 chars before wildcard)
  const firstWildcard = Math.min(
    pattern.indexOf('*') === -1 ? Infinity : pattern.indexOf('*'),
    pattern.indexOf('?') === -1 ? Infinity : pattern.indexOf('?')
  );

  if (firstWildcard < 3) {
    return {
      isValid: false,
      error: 'Pattern must have at least 3 character prefix before wildcard',
    };
  }

  return { isValid: true, error: null };
};

/**
 * Middleware to validate Redis-related inputs in request
 * Scans request for parameters that will be used in Redis operations
 */
const validateRedisInputs = (req, res, next) => {
  const errors = [];

  // Check common parameter names that might be used in Redis
  const redisParams = ['key', 'id', 'userId', 'ip', 'endpoint', 'ruleId'];

  // Check body
  if (req.body && typeof req.body === 'object') {
    for (const param of redisParams) {
      if (req.body[param]) {
        const value = req.body[param];
        
        // Validate as potential Redis key
        if (typeof value === 'string') {
          const sanitized = sanitizeRedisInput(value);
          const validation = validateRedisKey(sanitized, `body.${param}`);
          
          if (!validation.isValid) {
            errors.push({
              field: param,
              location: 'body',
              message: validation.error,
            });
          } else {
            // Replace with sanitized version
            req.body[param] = sanitized;
          }
        }
      }
    }
  }

  // Check query parameters
  if (req.query && typeof req.query === 'object') {
    for (const param of redisParams) {
      if (req.query[param]) {
        const value = req.query[param];
        
        if (typeof value === 'string') {
          const sanitized = sanitizeRedisInput(value);
          const validation = validateRedisKey(sanitized, `query.${param}`);
          
          if (!validation.isValid) {
            errors.push({
              field: param,
              location: 'query',
              message: validation.error,
            });
          } else {
            // Replace with sanitized version
            req.query[param] = sanitized;
          }
        }
      }
    }
  }

  // Check path parameters
  if (req.params && typeof req.params === 'object') {
    for (const param of Object.keys(req.params)) {
      const value = req.params[param];
      
      if (typeof value === 'string') {
        const sanitized = sanitizeRedisInput(value);
        const validation = validateRedisKey(sanitized, `params.${param}`);
        
        if (!validation.isValid) {
          errors.push({
            field: param,
            location: 'params',
            message: validation.error,
          });
        } else {
          // Replace with sanitized version
          req.params[param] = sanitized;
        }
      }
    }
  }

  if (errors.length > 0) {
    logger.warn('Redis input validation failed', {
      path: req.path,
      errors,
      ip: req.ip,
    });

    return next(createError('VALIDATION_ERROR', 
      'Invalid input for database operation',
      { details: errors }
    ));
  }

  next();
};

/**
 * Create a safe Redis key with namespace
 * Ensures key follows best practices
 * 
 * @param {string} namespace - Namespace prefix (e.g., 'ratelimit', 'session')
 * @param  {...string} parts - Key parts to join
 * @returns {string} Safe Redis key
 */
const createSafeRedisKey = (namespace, ...parts) => {
  if (!namespace || typeof namespace !== 'string') {
    throw new Error('Namespace is required and must be a string');
  }

  // Sanitize all parts
  const sanitizedParts = [namespace, ...parts].map(part => {
    if (part === null || part === undefined) {
      throw new Error('Key part cannot be null or undefined');
    }
    
    const str = String(part);
    const sanitized = sanitizeRedisInput(str);
    
    const validation = validateRedisKey(sanitized, 'createKey');
    if (!validation.isValid) {
      throw new Error(`Invalid key part: ${validation.error}`);
    }
    
    return sanitized;
  });

  return sanitizedParts.join(':');
};

/**
 * Validate Lua script for Redis EVAL
 * Ensures script doesn't contain dangerous operations
 * 
 * @param {string} script - Lua script to validate
 * @returns {Object} { isValid: boolean, error: string | null }
 */
const validateLuaScript = (script) => {
  if (typeof script !== 'string') {
    return {
      isValid: false,
      error: 'Lua script must be a string',
    };
  }

  // Check script length (prevent DoS)
  if (script.length > 10000) {
    return {
      isValid: false,
      error: 'Lua script exceeds maximum length',
    };
  }

  // Check for dangerous Redis commands in Lua
  const dangerousCommands = [
    'redis.call.*config',
    'redis.call.*shutdown',
    'redis.call.*flushall',
    'redis.call.*flushdb',
    'redis.call.*keys',
    'redis.call.*debug',
    'redis.call.*script',
  ];

  for (const cmd of dangerousCommands) {
    const pattern = new RegExp(cmd, 'i');
    if (pattern.test(script)) {
      logger.security('Dangerous command detected in Lua script', {
        command: cmd,
      });

      return {
        isValid: false,
        error: 'Lua script contains dangerous Redis command',
      };
    }
  }

  return { isValid: true, error: null };
};

module.exports = {
  validateRedisKey,
  validateRedisValue,
  validateRedisPattern,
  validateRedisOperation,
  validateRedisInputs,
  sanitizeRedisInput,
  createSafeRedisKey,
  validateLuaScript,
  SAFE_KEY_PATTERN,
  MAX_KEY_LENGTH,
  MAX_VALUE_LENGTH,
};
