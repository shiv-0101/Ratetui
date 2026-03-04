/**
 * API Key Authentication Middleware
 * 
 * Validates API keys from request headers and attaches key info to request.
 * Supports both JWT and API key authentication.
 */

const { validateApiKey } = require('../services/apiKeyService');
const { createError } = require('./errorHandler');
const logger = require('../utils/logger');
const { recordAuth } = require('../services/advancedMetrics');

/**
 * Extract API key from request
 * Supports multiple header formats:
 * - Authorization: Bearer <api-key>
 * - X-API-Key: <api-key>
 * - Api-Key: <api-key>
 * 
 * @param {Object} req - Express request
 * @returns {string|null} API key or null
 */
const extractApiKey = (req) => {
  // Check Authorization header
  const authHeader = req.get('authorization');
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1].startsWith('rk_')) {
      return match[1];
    }
  }
  
  // Check X-API-Key header
  const xApiKey = req.get('x-api-key');
  if (xApiKey) {
    return xApiKey;
  }
  
  // Check Api-Key header
  const apiKey = req.get('api-key');
  if (apiKey) {
    return apiKey;
  }
  
  return null;
};

/**
 * API Key authentication middleware
 * Validates API key and attaches key info to request
 */
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = extractApiKey(req);
    
    if (!apiKey) {
      // No API key provided, continue (might use JWT auth)
      return next();
    }
    
    // Validate API key
    const keyInfo = await validateApiKey(apiKey);
    
    if (!keyInfo) {
      logger.warn('Invalid API key attempt', {
        ip: req.ip,
        path: req.path,
      });
      
      return next(createError(401, 'INVALID_API_KEY', 'Invalid or expired API key'));
    }
    
    // Attach key info to request
    req.apiKey = keyInfo;
    req.apiKeyAuth = true;
    
    // Set user info for compatibility with JWT auth
    if (!req.user) {
      req.user = {
        id: keyInfo.userId,
        authType: 'api_key',
        scopes: keyInfo.scopes,
      };
    }
    
    logger.debug('API key authenticated', {
      keyId: keyInfo.id,
      userId: keyInfo.userId,
      scopes: keyInfo.scopes,
    });
    
    recordAuth('success', 'api_key');
    
    next();
  } catch (error) {
    logger.error('API key authentication error:', { error: error.message });
    next(createError(500, 'AUTH_ERROR', 'Authentication error'));
  }
};

/**
 * Require API key authentication
 * Fails if no valid API key is present
 */
const requireApiKey = async (req, res, next) => {
  try {
    const apiKey = extractApiKey(req);
    
    if (!apiKey) {
      recordAuth('failure', 'api_key');
      return next(createError(401, 'API_KEY_REQUIRED', 'API key is required'));
    }
    
    const keyInfo = await validateApiKey(apiKey);
    
    if (!keyInfo) {
      logger.warn('Invalid API key attempt', {
        ip: req.ip,
        path: req.path,
      });
      
      recordAuth('failure', 'api_key');
      return next(createError(401, 'INVALID_API_KEY', 'Invalid or expired API key'));
    }
    
    // Attach key info to request
    req.apiKey = keyInfo;
    req.apiKeyAuth = true;
    req.user = {
      id: keyInfo.userId,
      authType: 'api_key',
      scopes: keyInfo.scopes,
    };
    
    next();
  } catch (error) {
    logger.error('API key authentication error:', { error: error.message });
    next(createError(500, 'AUTH_ERROR', 'Authentication error'));
  }
};

/**
 * Check if API key has required scope
 * @param {string} requiredScope - Required scope
 */
const requireApiKeyScope = (requiredScope) => {
  return (req, res, next) => {
    if (!req.apiKey) {
      return next(createError(401, 'API_KEY_REQUIRED', 'API key authentication required'));
    }
    
    if (!req.apiKey.scopes.includes(requiredScope)) {
      logger.warn('Insufficient API key permissions', {
        keyId: req.apiKey.id,
        requiredScope,
        actualScopes: req.apiKey.scopes,
      });
      
      return next(createError(403, 'INSUFFICIENT_PERMISSIONS', `API key missing required scope: ${requiredScope}`));
    }
    
    next();
  };
};

module.exports = {
  authenticateApiKey,
  requireApiKey,
  requireApiKeyScope,
  extractApiKey,
};
