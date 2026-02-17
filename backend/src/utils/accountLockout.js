/**
 * Account Lockout Utility
 * 
 * Tracks failed login attempts and implements account lockout
 * to prevent brute force attacks
 */

const { getRedisClient, isRedisConnected } = require('../config/redis');
const logger = require('../utils/logger');

// Configuration
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60; // 15 minutes in seconds
const ATTEMPT_WINDOW = 15 * 60; // 15 minutes in seconds

/**
 * Record a failed login attempt
 * 
 * @param {string} identifier - User email or IP address
 * @returns {Promise<Object>} Attempt info with lockout status
 */
const recordFailedAttempt = async (identifier) => {
  if (!isRedisConnected()) {
    logger.warn('Redis not connected, cannot record failed attempt');
    return { locked: false, attemptsRemaining: MAX_FAILED_ATTEMPTS };
  }

  const redis = getRedisClient();
  const key = `auth:failed:${identifier}`;

  // Increment failed attempts
  const attempts = await redis.incr(key);

  // Set expiry on first attempt
  if (attempts === 1) {
    await redis.expire(key, ATTEMPT_WINDOW);
  }

  logger.warn('Failed login attempt recorded', { 
    identifier: maskIdentifier(identifier), 
    attempts,
    maxAttempts: MAX_FAILED_ATTEMPTS,
  });

  // Check if account should be locked
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    await lockAccount(identifier);
    
    return {
      locked: true,
      attempts,
      attemptsRemaining: 0,
      lockoutDuration: LOCKOUT_DURATION,
    };
  }

  return {
    locked: false,
    attempts,
    attemptsRemaining: MAX_FAILED_ATTEMPTS - attempts,
    lockoutDuration: null,
  };
};

/**
 * Lock an account
 * 
 * @param {string} identifier - User email or IP address
 * @returns {Promise<void>}
 */
const lockAccount = async (identifier) => {
  if (!isRedisConnected()) {
    return;
  }

  const redis = getRedisClient();
  const lockKey = `auth:locked:${identifier}`;
  const lockUntil = Date.now() + (LOCKOUT_DURATION * 1000);

  await redis.set(lockKey, lockUntil, 'EX', LOCKOUT_DURATION);

  logger.security('Account locked due to failed login attempts', {
    identifier: maskIdentifier(identifier),
    lockDuration: LOCKOUT_DURATION,
    lockUntil: new Date(lockUntil).toISOString(),
  });
};

/**
 * Check if an account is locked
 * 
 * @param {string} identifier - User email or IP address
 * @returns {Promise<Object>} Lock status with remaining time
 */
const isAccountLocked = async (identifier) => {
  if (!isRedisConnected()) {
    // Fail open if Redis is unavailable (configurable behavior)
    return { locked: false };
  }

  const redis = getRedisClient();
  const lockKey = `auth:locked:${identifier}`;

  const lockUntil = await redis.get(lockKey);

  if (!lockUntil) {
    return { locked: false };
  }

  const lockUntilTime = parseInt(lockUntil, 10);
  const now = Date.now();

  if (now >= lockUntilTime) {
    // Lock has expired, clean up
    await redis.del(lockKey);
    return { locked: false };
  }

  const remainingSeconds = Math.ceil((lockUntilTime - now) / 1000);

  return {
    locked: true,
    remainingSeconds,
    lockUntil: new Date(lockUntilTime).toISOString(),
  };
};

/**
 * Reset failed attempts after successful login
 * 
 * @param {string} identifier - User email or IP address
 * @returns {Promise<void>}
 */
const resetFailedAttempts = async (identifier) => {
  if (!isRedisConnected()) {
    return;
  }

  const redis = getRedisClient();
  const key = `auth:failed:${identifier}`;
  const lockKey = `auth:locked:${identifier}`;

  await redis.del(key);
  await redis.del(lockKey);

  logger.info('Failed login attempts reset', { 
    identifier: maskIdentifier(identifier),
  });
};

/**
 * Get current failed attempt count
 * 
 * @param {string} identifier - User email or IP address
 * @returns {Promise<number>} Number of failed attempts
 */
const getFailedAttempts = async (identifier) => {
  if (!isRedisConnected()) {
    return 0;
  }

  const redis = getRedisClient();
  const key = `auth:failed:${identifier}`;

  const attempts = await redis.get(key);
  return attempts ? parseInt(attempts, 10) : 0;
};

/**
 * Manually unlock an account (admin action)
 * 
 * @param {string} identifier - User email or IP address
 * @returns {Promise<void>}
 */
const unlockAccount = async (identifier) => {
  if (!isRedisConnected()) {
    return;
  }

  const redis = getRedisClient();
  const lockKey = `auth:locked:${identifier}`;
  const attemptKey = `auth:failed:${identifier}`;

  await redis.del(lockKey);
  await redis.del(attemptKey);

  logger.info('Account manually unlocked', { 
    identifier: maskIdentifier(identifier),
  });
};

/**
 * Mask identifier for logging (privacy)
 * 
 * @param {string} identifier - Email or IP
 * @returns {string} Masked identifier
 */
const maskIdentifier = (identifier) => {
  if (!identifier) return 'unknown';

  // Mask email (show first 2 chars + domain)
  if (identifier.includes('@')) {
    const [user, domain] = identifier.split('@');
    return `${user.substring(0, 2)}***@${domain}`;
  }

  // Mask IP (show first octet only)
  if (identifier.includes('.')) {
    const parts = identifier.split('.');
    return `${parts[0]}.***.***.***`;
  }

  // Mask other identifiers
  return identifier.substring(0, 3) + '***';
};

module.exports = {
  recordFailedAttempt,
  lockAccount,
  isAccountLocked,
  resetFailedAttempts,
  getFailedAttempts,
  unlockAccount,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION,
};
