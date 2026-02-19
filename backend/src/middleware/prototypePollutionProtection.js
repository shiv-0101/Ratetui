/**
 * Prototype Pollution Protection Middleware
 * 
 * Comprehensive protection against prototype pollution attacks
 * Implements multiple defense layers:
 * 1. Object prototype freezing
 * 2. Recursive property validation
 * 3. JSON parse hardening
 * 4. Request sanitization
 */

const { createError } = require('./errorHandler');
const logger = require('../utils/logger');

// Dangerous property names that can lead to prototype pollution
const DANGEROUS_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
]);

// Additional dangerous patterns
const DANGEROUS_PATTERNS = [
  /^__.*__$/,           // Double underscore patterns
  /constructor/i,        // Constructor references
  /prototype/i,          // Prototype references
];

/**
 * Freeze critical prototypes to prevent modification
 * This should be called once at application startup
 */
const freezePrototypes = () => {
  try {
    // Freeze Object prototype
    if (Object.prototype) {
      Object.freeze(Object.prototype);
    }

    // Freeze Array prototype
    if (Array.prototype) {
      Object.freeze(Array.prototype);
    }

    // Freeze Function prototype
    if (Function.prototype) {
      Object.freeze(Function.prototype);
    }

    // Freeze String prototype
    if (String.prototype) {
      Object.freeze(String.prototype);
    }

    // Freeze Number prototype
    if (Number.prototype) {
      Object.freeze(Number.prototype);
    }

    // Freeze Boolean prototype
    if (Boolean.prototype) {
      Object.freeze(Boolean.prototype);
    }

    logger.info('Critical prototypes frozen for pollution protection');
  } catch (error) {
    logger.error('Failed to freeze prototypes', { error: error.message });
  }
};

/**
 * Check if object contains dangerous property names
 * Performs recursive deep scan
 * 
 * @param {*} obj - Object to check
 * @param {Set} visited - Set of visited objects to prevent circular references
 * @param {number} depth - Current recursion depth
 * @param {number} maxDepth - Maximum recursion depth
 * @returns {Object} { hasDanger: boolean, dangerousKey: string | null }
 */
const scanForDangerousProperties = (obj, visited = new Set(), depth = 0, maxDepth = 10) => {
  // Handle primitives
  if (obj === null || typeof obj !== 'object') {
    return { hasDanger: false, dangerousKey: null };
  }

  // Prevent circular references
  if (visited.has(obj)) {
    return { hasDanger: false, dangerousKey: null };
  }

  // Prevent deep recursion DoS
  if (depth > maxDepth) {
    logger.warn('Maximum recursion depth exceeded during pollution scan', { depth });
    return { hasDanger: true, dangerousKey: 'MAX_DEPTH_EXCEEDED' };
  }

  visited.add(obj);

  // Check object keys
  const keys = Object.keys(obj);
  
  for (const key of keys) {
    // Check against dangerous keys set
    if (DANGEROUS_KEYS.has(key)) {
      return { hasDanger: true, dangerousKey: key };
    }

    // Check against dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(key)) {
        return { hasDanger: true, dangerousKey: key };
      }
    }

    // Check for bracket notation attempts
    if (key.includes('[') || key.includes(']')) {
      return { hasDanger: true, dangerousKey: key };
    }

    // Recursively check nested objects
    try {
      const value = obj[key];
      if (typeof value === 'object' && value !== null) {
        const nestedResult = scanForDangerousProperties(value, visited, depth + 1, maxDepth);
        if (nestedResult.hasDanger) {
          return nestedResult;
        }
      }
    } catch (error) {
      logger.warn('Error scanning nested property', { key, error: error.message });
      return { hasDanger: true, dangerousKey: key };
    }
  }

  // Check properties accessible via Object.getOwnPropertyNames (including non-enumerable)
  try {
    const allKeys = Object.getOwnPropertyNames(obj);
    for (const key of allKeys) {
      if (DANGEROUS_KEYS.has(key)) {
        return { hasDanger: true, dangerousKey: key };
      }
    }
  } catch (error) {
    // Some objects may not support getOwnPropertyNames
    logger.debug('Could not get property names', { error: error.message });
  }

  return { hasDanger: false, dangerousKey: null };
};

/**
 * Safe JSON parse with prototype pollution protection
 * Uses reviver function to filter dangerous properties
 * 
 * @param {string} jsonString - JSON string to parse
 * @returns {*} Parsed and sanitized object
 * @throws {Error} If JSON is invalid or contains dangerous properties
 */
const safeJsonParse = (jsonString) => {
  if (typeof jsonString !== 'string') {
    throw new Error('Input must be a string');
  }

  let parsed;
  
  try {
    // Parse with reviver to filter dangerous keys
    parsed = JSON.parse(jsonString, (key, value) => {
      // Check if key is dangerous
      if (DANGEROUS_KEYS.has(key)) {
        throw new Error(`Dangerous property detected: ${key}`);
      }

      // Check patterns
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(key)) {
          throw new Error(`Dangerous property pattern detected: ${key}`);
        }
      }

      return value;
    });
  } catch (error) {
    if (error.message.includes('Dangerous property')) {
      throw error;
    }
    throw new Error(`Invalid JSON: ${error.message}`);
  }

  // Additional deep scan
  const scanResult = scanForDangerousProperties(parsed);
  if (scanResult.hasDanger) {
    throw new Error(`Dangerous property found in parsed JSON: ${scanResult.dangerousKey}`);
  }

  return parsed;
};

/**
 * Recursively remove dangerous properties from object
 * Creates a clean copy without mutation
 * 
 * @param {*} obj - Object to sanitize
 * @param {Set} visited - Set of visited objects
 * @param {number} depth - Current recursion depth
 * @returns {*} Sanitized object
 */
const removeDangerousProperties = (obj, visited = new Set(), depth = 0) => {
  // Handle primitives
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Prevent circular references
  if (visited.has(obj)) {
    return null;
  }

  // Prevent deep recursion
  if (depth > 10) {
    return null;
  }

  visited.add(obj);

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => removeDangerousProperties(item, visited, depth + 1));
  }

  // Handle objects
  const sanitized = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip dangerous keys
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }

    // Skip dangerous patterns
    let isDangerous = false;
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(key)) {
        isDangerous = true;
        break;
      }
    }

    if (isDangerous) {
      continue;
    }

    // Recursively sanitize nested objects
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = removeDangerousProperties(value, visited, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

/**
 * Express middleware to protect against prototype pollution
 * Validates and sanitizes request body, query, and params
 */
const protectAgainstPrototypePollution = (req, res, next) => {
  try {
    // Scan request body
    if (req.body && typeof req.body === 'object') {
      const bodyResult = scanForDangerousProperties(req.body);
      if (bodyResult.hasDanger) {
        logger.security('Prototype pollution attempt in request body', {
          method: req.method,
          path: req.path,
          dangerousKey: bodyResult.dangerousKey,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        });

        return next(createError('VALIDATION_ERROR', 
          'Request rejected: dangerous property names detected',
          { property: bodyResult.dangerousKey }
        ));
      }
    }

    // Scan query parameters
    if (req.query && typeof req.query === 'object') {
      const queryResult = scanForDangerousProperties(req.query);
      if (queryResult.hasDanger) {
        logger.security('Prototype pollution attempt in query parameters', {
          path: req.path,
          dangerousKey: queryResult.dangerousKey,
          ip: req.ip,
        });

        return next(createError('VALIDATION_ERROR', 
          'Query parameters rejected: dangerous property names detected',
          { property: queryResult.dangerousKey }
        ));
      }
    }

    // Scan path parameters
    if (req.params && typeof req.params === 'object') {
      const paramsResult = scanForDangerousProperties(req.params);
      if (paramsResult.hasDanger) {
        logger.security('Prototype pollution attempt in path parameters', {
          path: req.path,
          dangerousKey: paramsResult.dangerousKey,
          ip: req.ip,
        });

        return next(createError('VALIDATION_ERROR', 
          'Path parameters rejected: dangerous property names detected',
          { property: paramsResult.dangerousKey }
        ));
      }
    }

    next();
  } catch (error) {
    logger.error('Error in prototype pollution protection', {
      error: error.message,
      stack: error.stack,
      path: req.path,
    });

    return next(createError('INTERNAL_ERROR', 'Request validation failed'));
  }
};

/**
 * Create a safe object that prevents prototype pollution
 * Returns an object with null prototype
 * 
 * @param {Object} obj - Source object
 * @returns {Object} Safe object with null prototype
 */
const createSafeObject = (obj = {}) => {
  const safe = Object.create(null);
  
  if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (!DANGEROUS_KEYS.has(key)) {
        safe[key] = value;
      }
    }
  }

  return safe;
};

/**
 * Verify prototype chain integrity
 * Checks if Object.prototype has been tampered with
 * 
 * @returns {boolean} True if prototypes are intact
 */
const verifyPrototypeIntegrity = () => {
  try {
    // Check Object.prototype
    const objectProto = Object.getPrototypeOf({});
    if (objectProto !== Object.prototype) {
      logger.error('Object.prototype chain has been modified!');
      return false;
    }

    // Check if dangerous properties exist on Object.prototype
    for (const key of DANGEROUS_KEYS) {
      if (key in Object.prototype && Object.prototype.hasOwnProperty(key)) {
        const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
        // Check if it's a standard built-in method
        if (!descriptor || descriptor.writable) {
          logger.warn(`Suspicious property on Object.prototype: ${key}`);
        }
      }
    }

    return true;
  } catch (error) {
    logger.error('Error verifying prototype integrity', { error: error.message });
    return false;
  }
};

module.exports = {
  freezePrototypes,
  scanForDangerousProperties,
  safeJsonParse,
  removeDangerousProperties,
  protectAgainstPrototypePollution,
  createSafeObject,
  verifyPrototypeIntegrity,
  DANGEROUS_KEYS,
};
