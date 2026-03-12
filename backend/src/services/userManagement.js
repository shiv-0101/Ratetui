/**
 * User Management Service
 * 
 * Handles user blacklist and whitelist management
 * Stores user lists in Redis with TTL support
 */

const { getRedisClient, isRedisConnected } = require('../config/redis');
const logger = require('../utils/logger');

/**
 * Add user to blacklist
 * @param {string} userId - User ID to blacklist
 * @param {number} duration - Duration in seconds (0 = permanent)
 * @param {string} reason - Reason for blacklisting
 * @param {Object} actor - User who performed the action
 * @returns {Promise<Object>} Blacklist entry
 */
const blacklistUser = async (userId, duration = 0, reason = '', actor = null) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required for user management');
  }

  const redis = getRedisClient();
  const timestamp = new Date().toISOString();

  const entry = {
    userId,
    reason,
    blacklistedAt: timestamp,
    blacklistedBy: actor?.id || 'system',
    duration,
    expiresAt: duration > 0 ? new Date(Date.now() + duration * 1000).toISOString() : 'permanent',
  };

  // Store in blacklist set
  await redis.sadd('user:blacklist', userId);

  // Store detailed info
  await redis.hset(`user:blacklist:${userId}`, entry);

  // Set expiration if duration is specified
  if (duration > 0) {
    await redis.expire(`user:blacklist:${userId}`, duration);
    // Also remove from set when expired (using sorted set for auto-cleanup)
    await redis.zadd('user:blacklist:expiry', Date.now() + duration * 1000, userId);
  }

  logger.info('User blacklisted', { userId, duration, reason, actor: actor?.id });

  return entry;
};

/**
 * Remove user from blacklist
 * @param {string} userId - User ID to unblacklist
 * @param {Object} actor - User who performed the action
 * @returns {Promise<boolean>} Success status
 */
const unblacklistUser = async (userId, actor = null) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required for user management');
  }

  const redis = getRedisClient();

  // Remove from blacklist set
  await redis.srem('user:blacklist', userId);

  // Remove detailed info
  await redis.del(`user:blacklist:${userId}`);

  // Remove from expiry tracking
  await redis.zrem('user:blacklist:expiry', userId);

  logger.info('User unblacklisted', { userId, actor: actor?.id });

  return true;
};

/**
 * Check if user is blacklisted
 * @param {string} userId - User ID to check
 * @returns {Promise<Object|null>} Blacklist entry or null
 */
const isUserBlacklisted = async (userId) => {
  if (!isRedisConnected()) {
    return null;
  }

  const redis = getRedisClient();
  const isBlacklisted = await redis.sismember('user:blacklist', userId);

  if (!isBlacklisted) {
    return null;
  }

  // Get details
  const details = await redis.hgetall(`user:blacklist:${userId}`);

  if (Object.keys(details).length === 0) {
    // Entry exists in set but not in hash (expired), clean up
    await redis.srem('user:blacklist', userId);
    return null;
  }

  return details;
};

/**
 * Get all blacklisted users
 * @param {Object} options - Query options
 * @param {number} options.limit - Max results
 * @param {number} options.offset - Offset for pagination
 * @returns {Promise<Array>} Array of blacklisted users
 */
const getBlacklistedUsers = async (options = {}) => {
  if (!isRedisConnected()) {
    return [];
  }

  const redis = getRedisClient();
  const { limit = 100, offset = 0 } = options;

  // Get userIds from set
  const userIds = await redis.smembers('user:blacklist');

  // Get details for each user
  const entries = [];
  for (const userId of userIds.slice(offset, offset + limit)) {
    const details = await redis.hgetall(`user:blacklist:${userId}`);
    if (Object.keys(details).length > 0) {
      entries.push(details);
    }
  }

  return entries;
};

/**
 * Add user to whitelist
 * @param {string} userId - User ID to whitelist
 * @param {string} reason - Reason for whitelisting
 * @param {Object} actor - User who performed the action
 * @returns {Promise<Object>} Whitelist entry
 */
const whitelistUser = async (userId, reason = '', actor = null) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required for user management');
  }

  const redis = getRedisClient();
  const timestamp = new Date().toISOString();

  const entry = {
    userId,
    reason,
    whitelistedAt: timestamp,
    whitelistedBy: actor?.id || 'system',
  };

  // Store in whitelist set
  await redis.sadd('user:whitelist', userId);

  // Store detailed info
  await redis.hset(`user:whitelist:${userId}`, entry);

  // If user was blacklisted, remove from blacklist
  await unblacklistUser(userId, actor);

  logger.info('User whitelisted', { userId, reason, actor: actor?.id });

  return entry;
};

/**
 * Remove user from whitelist
 * @param {string} userId - User ID to remove
 * @param {Object} actor - User who performed the action
 * @returns {Promise<boolean>} Success status
 */
const unwhitelistUser = async (userId, actor = null) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required for user management');
  }

  const redis = getRedisClient();

  // Remove from whitelist set
  await redis.srem('user:whitelist', userId);

  // Remove detailed info
  await redis.del(`user:whitelist:${userId}`);

  logger.info('User removed from whitelist', { userId, actor: actor?.id });

  return true;
};

/**
 * Check if user is whitelisted
 * @param {string} userId - User ID to check
 * @returns {Promise<Object|null>} Whitelist entry or null
 */
const isUserWhitelisted = async (userId) => {
  if (!isRedisConnected()) {
    return null;
  }

  const redis = getRedisClient();
  const isWhitelisted = await redis.sismember('user:whitelist', userId);

  if (!isWhitelisted) {
    return null;
  }

  // Get details
  const details = await redis.hgetall(`user:whitelist:${userId}`);

  if (Object.keys(details).length === 0) {
    return null;
  }

  return details;
};

/**
 * Get all whitelisted users
 * @param {Object} options - Query options
 * @param {number} options.limit - Max results
 * @param {number} options.offset - Offset for pagination
 * @returns {Promise<Array>} Array of whitelisted users
 */
const getWhitelistedUsers = async (options = {}) => {
  if (!isRedisConnected()) {
    return [];
  }

  const redis = getRedisClient();
  const { limit = 100, offset = 0 } = options;

  // Get userIds from set
  const userIds = await redis.smembers('user:whitelist');

  // Get details for each user
  const entries = [];
  for (const userId of userIds.slice(offset, offset + limit)) {
    const details = await redis.hgetall(`user:whitelist:${userId}`);
    if (Object.keys(details).length > 0) {
      entries.push(details);
    }
  }

  return entries;
};

/**
 * Get user statistics
 * @returns {Promise<Object>} User statistics
 */
const getUserStats = async () => {
  if (!isRedisConnected()) {
    return {
      blacklisted: 0,
      whitelisted: 0,
    };
  }

  const redis = getRedisClient();

  const [blacklisted, whitelisted] = await Promise.all([
    redis.scard('user:blacklist'),
    redis.scard('user:whitelist'),
  ]);

  return {
    blacklisted,
    whitelisted,
  };
};

/**
 * Cleanup expired blacklist entries
 * @returns {Promise<number>} Number of entries cleaned up
 */
const cleanupExpiredBlacklists = async () => {
  if (!isRedisConnected()) {
    return 0;
  }

  const redis = getRedisClient();
  const now = Date.now();

  // Get expired entries from sorted set
  const expiredUsers = await redis.zrangebyscore('user:blacklist:expiry', 0, now);

  let cleanedCount = 0;
  for (const userId of expiredUsers) {
    // Check if still blacklisted
    const exists = await redis.exists(`user:blacklist:${userId}`);
    if (!exists) {
      // Already expired via TTL, just clean up tracking
      await redis.zrem('user:blacklist:expiry', userId);
      await redis.srem('user:blacklist', userId);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    logger.info('Cleaned up expired user blacklist entries', { count: cleanedCount });
  }

  return cleanedCount;
};

module.exports = {
  blacklistUser,
  unblacklistUser,
  isUserBlacklisted,
  getBlacklistedUsers,
  whitelistUser,
  unwhitelistUser,
  isUserWhitelisted,
  getWhitelistedUsers,
  getUserStats,
  cleanupExpiredBlacklists,
};
