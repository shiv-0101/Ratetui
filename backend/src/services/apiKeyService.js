/**
 * API Key Management Service
 * 
 * Provides API key authentication for external services and applications:
 * - Generate secure API keys
 * - Hash storage (SHA-256)
 * - Key rotation and revocation
 * - Usage tracking and rate limiting
 * - Scoped permissions
 * 
 * Based on PRD FR-001.3 and SR-014 requirements.
 */

const crypto = require('crypto');
const { getRedisClient, isRedisConnected } = require('../config/redis');
const logger = require('../utils/logger');
const auditLog = require('./auditLog');

/**
 * Configuration
 */
const API_KEY_CONFIG = {
  // Key generation
  KEY_PREFIX: 'rk_', // "ratetui key"
  KEY_LENGTH: 32, // bytes (results in 64 hex chars)
  
  // Storage keys
  HASH_KEY_PREFIX: 'apikey:hash:',
  METADATA_KEY_PREFIX: 'apikey:meta:',
  USER_KEYS_PREFIX: 'apikey:user:',
  INDEX_KEY: 'apikey:index',
  
  // Limits
  MAX_KEYS_PER_USER: parseInt(process.env.MAX_API_KEYS_PER_USER, 10) || 10,
  DEFAULT_RATE_LIMIT: 1000, // requests per hour
  
  // Retention
  KEY_EXPIRY_DAYS: parseInt(process.env.API_KEY_EXPIRY_DAYS, 10) || 365,
};

/**
 * API key scopes/permissions
 */
const API_KEY_SCOPES = {
  READ: 'read',
  WRITE: 'write',
  ADMIN: 'admin',
  METRICS: 'metrics',
  RULES: 'rules',
};

/**
 * Generate secure API key
 * @returns {string} API key with prefix
 */
const generateApiKey = () => {
  const randomBytes = crypto.randomBytes(API_KEY_CONFIG.KEY_LENGTH);
  const keyBody = randomBytes.toString('hex');
  return `${API_KEY_CONFIG.KEY_PREFIX}${keyBody}`;
};

/**
 * Hash API key for storage
 * @param {string} apiKey - Plain API key
 * @returns {string} SHA-256 hash
 */
const hashApiKey = (apiKey) => {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
};

/**
 * Create new API key
 * @param {Object} params - Key parameters
 * @returns {Promise<Object>} Created key info
 */
const createApiKey = async ({
  userId,
  name,
  scopes = [API_KEY_SCOPES.READ],
  rateLimit = API_KEY_CONFIG.DEFAULT_RATE_LIMIT,
  expiresInDays = API_KEY_CONFIG.KEY_EXPIRY_DAYS,
  metadata = {},
}) => {
  try {
    if (!isRedisConnected()) {
      throw new Error('Redis unavailable');
    }
    
    const redis = getRedisClient();
    
    // Check user key limit
    const userKeysKey = `${API_KEY_CONFIG.USER_KEYS_PREFIX}${userId}`;
    const userKeyCount = await redis.scard(userKeysKey);
    
    if (userKeyCount >= API_KEY_CONFIG.MAX_KEYS_PER_USER) {
      throw new Error(`Maximum API keys limit reached (${API_KEY_CONFIG.MAX_KEYS_PER_USER})`);
    }
    
    // Generate API key
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    const keyId = `key_${crypto.randomBytes(8).toString('hex')}`;
    
    const now = new Date().toISOString();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiresInDays);
    
    // Store key metadata
    const keyMetadata = {
      id: keyId,
      userId,
      name,
      scopes: JSON.stringify(scopes),
      rateLimit,
      createdAt: now,
      expiresAt: expiryDate.toISOString(),
      lastUsedAt: null,
      usageCount: 0,
      isActive: true,
      metadata: JSON.stringify(metadata),
    };
    
    const metadataKey = `${API_KEY_CONFIG.METADATA_KEY_PREFIX}${keyHash}`;
    const hashKey = `${API_KEY_CONFIG.HASH_KEY_PREFIX}${keyHash}`;
    
    // Store hash -> keyId mapping
    await redis.set(hashKey, keyId);
    
    // Store metadata
    await redis.hset(metadataKey, keyMetadata);
    
    // Set expiry (in seconds)
    const expirySeconds = expiresInDays * 24 * 60 * 60;
    await redis.expire(hashKey, expirySeconds);
    await redis.expire(metadataKey, expirySeconds);
    
    // Add to user's key set
    await redis.sadd(userKeysKey, keyHash);
    await redis.expire(userKeysKey, expirySeconds);
    
    // Add to global index
    await redis.zadd(API_KEY_CONFIG.INDEX_KEY, Date.now(), keyHash);
    
    // Audit log
    await auditLog.createAuditLog({
      category: auditLog.AUDIT_CATEGORIES.SYSTEM,
      action: 'api_key_created',
      actor: userId,
      actorType: 'user',
      target: keyId,
      targetType: 'api_key',
      result: auditLog.AUDIT_RESULTS.SUCCESS,
      details: {
        name,
        scopes,
        expiresAt: expiryDate.toISOString(),
      },
    });
    
    logger.info('API key created', {
      keyId,
      userId,
      name,
      scopes,
      expiresAt: expiryDate.toISOString(),
    });
    
    // Return key info (apiKey only shown once!)
    return {
      apiKey, // Only returned during creation
      keyId,
      name,
      scopes,
      rateLimit,
      createdAt: now,
      expiresAt: expiryDate.toISOString(),
    };
  } catch (error) {
    logger.error('Failed to create API key', { error: error.message, userId });
    throw error;
  }
};

/**
 * Validate API key and get metadata
 * @param {string} apiKey - API key to validate
 * @returns {Promise<Object|null>} Key metadata or null
 */
const validateApiKey = async (apiKey) => {
  try {
    if (!apiKey || !apiKey.startsWith(API_KEY_CONFIG.KEY_PREFIX)) {
      return null;
    }
    
    if (!isRedisConnected()) {
      logger.warn('Redis unavailable, cannot validate API key');
      return null;
    }
    
    const redis = getRedisClient();
    const keyHash = hashApiKey(apiKey);
    
    // Check if key exists
    const hashKey = `${API_KEY_CONFIG.HASH_KEY_PREFIX}${keyHash}`;
    const keyId = await redis.get(hashKey);
    
    if (!keyId) {
      return null;
    }
    
    // Get metadata
    const metadataKey = `${API_KEY_CONFIG.METADATA_KEY_PREFIX}${keyHash}`;
    const metadata = await redis.hgetall(metadataKey);
    
    if (!metadata || Object.keys(metadata).length === 0) {
      return null;
    }
    
    // Check if active
    if (metadata.isActive !== 'true') {
      logger.warn('Attempt to use inactive API key', { keyId });
      return null;
    }
    
    // Check if expired
    const expiresAt = new Date(metadata.expiresAt);
    if (expiresAt < new Date()) {
      logger.warn('Attempt to use expired API key', { keyId, expiresAt });
      return null;
    }
    
    // Update last used timestamp and usage count
    const now = new Date().toISOString();
    await redis.hincrby(metadataKey, 'usageCount', 1);
    await redis.hset(metadataKey, 'lastUsedAt', now);
    
    // Parse JSON fields
    return {
      id: metadata.id,
      userId: metadata.userId,
      name: metadata.name,
      scopes: JSON.parse(metadata.scopes),
      rateLimit: parseInt(metadata.rateLimit, 10),
      createdAt: metadata.createdAt,
      expiresAt: metadata.expiresAt,
      lastUsedAt: now,
      usageCount: parseInt(metadata.usageCount, 10) + 1,
      metadata: JSON.parse(metadata.metadata),
    };
  } catch (error) {
    logger.error('Failed to validate API key', { error: error.message });
    return null;
  }
};

/**
 * List user's API keys
 * @param {string} userId - User ID
 * @returns {Promise<Array>} User's API keys (without actual keys)
 */
const listUserApiKeys = async (userId) => {
  try {
    if (!isRedisConnected()) {
      return [];
    }
    
    const redis = getRedisClient();
    const userKeysKey = `${API_KEY_CONFIG.USER_KEYS_PREFIX}${userId}`;
    
    const keyHashes = await redis.smembers(userKeysKey);
    
    const keys = [];
    for (const keyHash of keyHashes) {
      const metadataKey = `${API_KEY_CONFIG.METADATA_KEY_PREFIX}${keyHash}`;
      const metadata = await redis.hgetall(metadataKey);
      
      if (metadata && Object.keys(metadata).length > 0) {
        keys.push({
          id: metadata.id,
          name: metadata.name,
          scopes: JSON.parse(metadata.scopes),
          rateLimit: parseInt(metadata.rateLimit, 10),
          createdAt: metadata.createdAt,
          expiresAt: metadata.expiresAt,
          lastUsedAt: metadata.lastUsedAt,
          usageCount: parseInt(metadata.usageCount, 10),
          isActive: metadata.isActive === 'true',
        });
      }
    }
    
    return keys;
  } catch (error) {
    logger.error('Failed to list user API keys', { error: error.message, userId });
    return [];
  }
};

/**
 * Revoke API key
 * @param {string} keyId - Key ID to revoke
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<boolean>} Success status
 */
const revokeApiKey = async (keyId, userId) => {
  try {
    if (!isRedisConnected()) {
      throw new Error('Redis unavailable');
    }
    
    const redis = getRedisClient();
    const userKeysKey = `${API_KEY_CONFIG.USER_KEYS_PREFIX}${userId}`;
    const keyHashes = await redis.smembers(userKeysKey);
    
    // Find key hash by ID
    let targetKeyHash = null;
    for (const keyHash of keyHashes) {
      const metadataKey = `${API_KEY_CONFIG.METADATA_KEY_PREFIX}${keyHash}`;
      const metadata = await redis.hgetall(metadataKey);
      
      if (metadata && metadata.id === keyId) {
        targetKeyHash = keyHash;
        break;
      }
    }
    
    if (!targetKeyHash) {
      throw new Error('API key not found or unauthorized');
    }
    
    const metadataKey = `${API_KEY_CONFIG.METADATA_KEY_PREFIX}${targetKeyHash}`;
    
    // Mark as inactive
    await redis.hset(metadataKey, 'isActive', 'false');
    
    // Remove from user's set
    await redis.srem(userKeysKey, targetKeyHash);
    
    // Audit log
    await auditLog.createAuditLog({
      category: auditLog.AUDIT_CATEGORIES.SYSTEM,
      action: 'api_key_revoked',
      actor: userId,
      actorType: 'user',
      target: keyId,
      targetType: 'api_key',
      result: auditLog.AUDIT_RESULTS.SUCCESS,
    });
    
    logger.info('API key revoked', { keyId, userId });
    
    return true;
  } catch (error) {
    logger.error('Failed to revoke API key', { error: error.message, keyId, userId });
    throw error;
  }
};

/**
 * Get API key statistics
 * @returns {Promise<Object>} Statistics
 */
const getApiKeyStats = async () => {
  try {
    if (!isRedisConnected()) {
      return { total: 0, active: 0, expired: 0 };
    }
    
    const redis = getRedisClient();
    const allKeyHashes = await redis.zrange(API_KEY_CONFIG.INDEX_KEY, 0, -1);
    
    let active = 0;
    let expired = 0;
    const now = new Date();
    
    for (const keyHash of allKeyHashes) {
      const metadataKey = `${API_KEY_CONFIG.METADATA_KEY_PREFIX}${keyHash}`;
      const metadata = await redis.hgetall(metadataKey);
      
      if (metadata && Object.keys(metadata).length > 0) {
        const expiresAt = new Date(metadata.expiresAt);
        const isActive = metadata.isActive === 'true';
        
        if (isActive && expiresAt > now) {
          active++;
        } else {
          expired++;
        }
      }
    }
    
    return {
      total: allKeyHashes.length,
      active,
      expired,
    };
  } catch (error) {
    logger.error('Failed to get API key stats', { error: error.message });
    return { total: 0, active: 0, expired: 0 };
  }
};

module.exports = {
  createApiKey,
  validateApiKey,
  listUserApiKeys,
  revokeApiKey,
  getApiKeyStats,
  API_KEY_CONFIG,
  API_KEY_SCOPES,
};
