/**
 * User Model
 * 
 * User data model stored in Redis
 * Uses Redis hashes for user data and sets for indexes
 */

const { getRedisClient, isRedisConnected } = require('../config/redis');
const logger = require('../utils/logger');

/**
 * Create a new user
 * 
 * @param {Object} userData - User data
 * @param {string} userData.email - User email (unique)
 * @param {string} userData.passwordHash - Bcrypt password hash
 * @param {string} userData.role - User role (admin, viewer)
 * @returns {Promise<Object>} Created user
 */
const createUser = async (userData) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required to create user');
  }

  const { email, passwordHash, role = 'viewer' } = userData;

  if (!email || !passwordHash) {
    throw new Error('Email and password hash are required');
  }

  const redis = getRedisClient();

  // Check if email already exists
  const existingId = await redis.get(`user:email:${email}`);
  if (existingId) {
    throw new Error('Email already exists');
  }

  // Generate user ID
  const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // User data
  const user = {
    id: userId,
    email,
    passwordHash,
    role,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Store user in Redis hash
  await redis.hset(`user:${userId}`, user);

  // Create email index
  await redis.set(`user:email:${email}`, userId);

  // Add to users set
  await redis.sadd('users', userId);

  logger.info('User created', { userId, email, role });

  return user;
};

/**
 * Get user by ID
 * 
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User object or null
 */
const getUserById = async (userId) => {
  if (!isRedisConnected()) {
    return null;
  }

  const redis = getRedisClient();
  const user = await redis.hgetall(`user:${userId}`);

  if (!user || Object.keys(user).length === 0) {
    return null;
  }

  return user;
};

/**
 * Get user by email
 * 
 * @param {string} email - User email
 * @returns {Promise<Object|null>} User object or null
 */
const getUserByEmail = async (email) => {
  if (!isRedisConnected()) {
    return null;
  }

  const redis = getRedisClient();

  // Get user ID from email index
  const userId = await redis.get(`user:email:${email}`);
  if (!userId) {
    return null;
  }

  // Get user data
  return getUserById(userId);
};

/**
 * Update user
 * 
 * @param {string} userId - User ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated user
 */
const updateUser = async (userId, updates) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required to update user');
  }

  const redis = getRedisClient();

  // Check if user exists
  const user = await getUserById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Don't allow updating certain fields
  const allowedUpdates = ['role', 'passwordHash'];
  const updateData = {};

  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      updateData[key] = updates[key];
    }
  }

  // Add updated timestamp
  updateData.updatedAt = new Date().toISOString();

  // Update user in Redis
  if (Object.keys(updateData).length > 0) {
    await redis.hset(`user:${userId}`, updateData);
    logger.info('User updated', { userId, fields: Object.keys(updateData) });
  }

  return getUserById(userId);
};

/**
 * Delete user
 * 
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
const deleteUser = async (userId) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required to delete user');
  }

  const redis = getRedisClient();

  // Get user data first
  const user = await getUserById(userId);
  if (!user) {
    return false;
  }

  // Delete email index
  await redis.del(`user:email:${user.email}`);

  // Delete user hash
  await redis.del(`user:${userId}`);

  // Remove from users set
  await redis.srem('users', userId);

  logger.info('User deleted', { userId, email: user.email });

  return true;
};

/**
 * Get all users
 * 
 * @returns {Promise<Array>} Array of user objects
 */
const getAllUsers = async () => {
  if (!isRedisConnected()) {
    return [];
  }

  const redis = getRedisClient();

  // Get all user IDs
  const userIds = await redis.smembers('users');

  // Get all user data
  const users = await Promise.all(
    userIds.map(userId => getUserById(userId))
  );

  return users.filter(user => user !== null);
};

/**
 * Count total users
 * 
 * @returns {Promise<number>} User count
 */
const countUsers = async () => {
  if (!isRedisConnected()) {
    return 0;
  }

  const redis = getRedisClient();
  return redis.scard('users');
};

module.exports = {
  createUser,
  getUserById,
  getUserByEmail,
  updateUser,
  deleteUser,
  getAllUsers,
  countUsers,
};
