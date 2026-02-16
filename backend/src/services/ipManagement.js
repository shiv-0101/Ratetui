/**
 * IP Management Service
 * 
 * Handles IP whitelist and blacklist management
 * Stores IP lists in Redis with TTL support
 */

const { getRedisClient, isRedisConnected } = require('../config/redis');
const logger = require('../utils/logger');

/**
 * Add IP to blacklist
 * @param {string} ip - IP address to blacklist
 * @param {number} duration - Duration in seconds (0 = permanent)
 * @param {string} reason - Reason for blacklisting
 * @param {Object} actor - User who performed the action
 * @returns {Promise<Object>} Blacklist entry
 */
const blacklistIP = async (ip, duration = 0, reason = '', actor = null) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required for IP management');
  }

  const redis = getRedisClient();
  const timestamp = new Date().toISOString();

  const entry = {
    ip,
    reason,
    blacklistedAt: timestamp,
    blacklistedBy: actor?.id || 'system',
    duration,
    expiresAt: duration > 0 ? new Date(Date.now() + duration * 1000).toISOString() : 'permanent',
  };

  // Store in blacklist set
  await redis.sadd('ip:blacklist', ip);

  // Store detailed info
  await redis.hset(`ip:blacklist:${ip}`, entry);

  // Set expiration if duration is specified
  if (duration > 0) {
    await redis.expire(`ip:blacklist:${ip}`, duration);
    // Also remove from set when expired (using sorted set for auto-cleanup)
    await redis.zadd('ip:blacklist:expiry', Date.now() + duration * 1000, ip);
  }

  logger.info('IP blacklisted', { ip, duration, reason, actor: actor?.id });

  return entry;
};

/**
 * Remove IP from blacklist
 * @param {string} ip - IP address to unblacklist
 * @param {Object} actor - User who performed the action
 * @returns {Promise<boolean>} Success status
 */
const unblacklistIP = async (ip, actor = null) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required for IP management');
  }

  const redis = getRedisClient();

  // Remove from blacklist set
  await redis.srem('ip:blacklist', ip);

  // Remove detailed info
  await redis.del(`ip:blacklist:${ip}`);

  // Remove from expiry tracking
  await redis.zrem('ip:blacklist:expiry', ip);

  logger.info('IP unblacklisted', { ip, actor: actor?.id });

  return true;
};

/**
 * Check if IP is blacklisted
 * @param {string} ip - IP address to check
 * @returns {Promise<Object|null>} Blacklist entry or null
 */
const isIPBlacklisted = async (ip) => {
  if (!isRedisConnected()) {
    return null;
  }

  const redis = getRedisClient();
  const isBlacklisted = await redis.sismember('ip:blacklist', ip);

  if (!isBlacklisted) {
    return null;
  }

  // Get details
  const details = await redis.hgetall(`ip:blacklist:${ip}`);

  if (Object.keys(details).length === 0) {
    // Entry exists in set but not in hash (expired), clean up
    await redis.srem('ip:blacklist', ip);
    return null;
  }

  return details;
};

/**
 * Get all blacklisted IPs
 * @param {Object} options - Query options
 * @param {number} options.limit - Max results
 * @param {number} options.offset - Offset for pagination
 * @returns {Promise<Array>} Array of blacklisted IPs
 */
const getBlacklistedIPs = async (options = {}) => {
  if (!isRedisConnected()) {
    return [];
  }

  const redis = getRedisClient();
  const { limit = 100, offset = 0 } = options;

  // Get IPs from set
  const ips = await redis.smembers('ip:blacklist');

  // Get details for each IP
  const entries = [];
  for (const ip of ips.slice(offset, offset + limit)) {
    const details = await redis.hgetall(`ip:blacklist:${ip}`);
    if (Object.keys(details).length > 0) {
      entries.push(details);
    }
  }

  return entries;
};

/**
 * Add IP to whitelist
 * @param {string} ip - IP address to whitelist
 * @param {string} reason - Reason for whitelisting
 * @param {Object} actor - User who performed the action
 * @returns {Promise<Object>} Whitelist entry
 */
const whitelistIP = async (ip, reason = '', actor = null) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required for IP management');
  }

  const redis = getRedisClient();
  const timestamp = new Date().toISOString();

  const entry = {
    ip,
    reason,
    whitelistedAt: timestamp,
    whitelistedBy: actor?.id || 'system',
  };

  // Store in whitelist set
  await redis.sadd('ip:whitelist', ip);

  // Store detailed info
  await redis.hset(`ip:whitelist:${ip}`, entry);

  // If IP was blacklisted, remove from blacklist
  await unblacklistIP(ip, actor);

  logger.info('IP whitelisted', { ip, reason, actor: actor?.id });

  return entry;
};

/**
 * Remove IP from whitelist
 * @param {string} ip - IP address to remove
 * @param {Object} actor - User who performed the action
 * @returns {Promise<boolean>} Success status
 */
const unwhitelistIP = async (ip, actor = null) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required for IP management');
  }

  const redis = getRedisClient();

  // Remove from whitelist set
  await redis.srem('ip:whitelist', ip);

  // Remove detailed info
  await redis.del(`ip:whitelist:${ip}`);

  logger.info('IP removed from whitelist', { ip, actor: actor?.id });

  return true;
};

/**
 * Check if IP is whitelisted
 * @param {string} ip - IP address to check
 * @returns {Promise<Object|null>} Whitelist entry or null
 */
const isIPWhitelisted = async (ip) => {
  if (!isRedisConnected()) {
    return null;
  }

  const redis = getRedisClient();
  const isWhitelisted = await redis.sismember('ip:whitelist', ip);

  if (!isWhitelisted) {
    return null;
  }

  // Get details
  const details = await redis.hgetall(`ip:whitelist:${ip}`);
  return Object.keys(details).length > 0 ? details : null;
};

/**
 * Get all whitelisted IPs
 * @param {Object} options - Query options
 * @param {number} options.limit - Max results
 * @param {number} options.offset - Offset for pagination
 * @returns {Promise<Array>} Array of whitelisted IPs
 */
const getWhitelistedIPs = async (options = {}) => {
  if (!isRedisConnected()) {
    return [];
  }

  const redis = getRedisClient();
  const { limit = 100, offset = 0 } = options;

  // Get IPs from set
  const ips = await redis.smembers('ip:whitelist');

  // Get details for each IP
  const entries = [];
  for (const ip of ips.slice(offset, offset + limit)) {
    const details = await redis.hgetall(`ip:whitelist:${ip}`);
    if (Object.keys(details).length > 0) {
      entries.push(details);
    }
  }

  return entries;
};

/**
 * Clean up expired blacklist entries
 * Should be run periodically
 * @returns {Promise<number>} Number of entries cleaned
 */
const cleanupExpiredBlacklists = async () => {
  if (!isRedisConnected()) {
    return 0;
  }

  const redis = getRedisClient();
  const now = Date.now();

  // Get expired IPs from sorted set
  const expiredIPs = await redis.zrangebyscore('ip:blacklist:expiry', 0, now);

  for (const ip of expiredIPs) {
    await unblacklistIP(ip, { id: 'system' });
  }

  logger.info('Cleaned up expired blacklist entries', { count: expiredIPs.length });

  return expiredIPs.length;
};

/**
 * Get IP management statistics
 * @returns {Promise<Object>} Statistics
 */
const getIPStats = async () => {
  if (!isRedisConnected()) {
    return {
      blacklisted: 0,
      whitelisted: 0,
      total: 0,
    };
  }

  const redis = getRedisClient();

  const blacklistedCount = await redis.scard('ip:blacklist');
  const whitelistedCount = await redis.scard('ip:whitelist');

  return {
    blacklisted: blacklistedCount,
    whitelisted: whitelistedCount,
    total: blacklistedCount + whitelistedCount,
  };
};

module.exports = {
  blacklistIP,
  unblacklistIP,
  isIPBlacklisted,
  getBlacklistedIPs,
  whitelistIP,
  unwhitelistIP,
  isIPWhitelisted,
  getWhitelistedIPs,
  cleanupExpiredBlacklists,
  getIPStats,
};
