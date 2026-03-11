/**
 * Rate Limit Rule Model
 * 
 * Defines structure and operations for dynamic rate limiting rules
 * Stored in Redis for fast access and persistence
 */

const { getRedisClient, isRedisConnected } = require('../config/redis');
const logger = require('../utils/logger');

/**
 * Create a new rate limit rule
 * 
 * @param {Object} ruleData - Rule configuration
 * @param {string} ruleData.name - Rule name
 * @param {Object} ruleData.target - Target configuration
 * @param {string} ruleData.target.type - Type: endpoint, ip, user, apikey
 * @param {string} ruleData.target.pattern - Pattern to match
 * @param {Object} ruleData.limit - Rate limit configuration
 * @param {number} ruleData.limit.requests - Max requests
 * @param {string} ruleData.limit.window - Time window (e.g., '1m', '1h')
 * @param {string} ruleData.action - Action: reject, throttle, log
 * @param {number} ruleData.priority - Priority (higher = more important)
 * @param {boolean} ruleData.enabled - Whether rule is active
 * @returns {Promise<Object>} Created rule
 */
const createRule = async (ruleData) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required to create rule');
  }

  const {
    name,
    target,
    limit,
    action = 'reject',
    priority = 100,
    enabled = true,
    description = '',
    conditions = null,
  } = ruleData;

  if (!name || !target || !limit) {
    throw new Error('Name, target, and limit are required');
  }

  const redis = getRedisClient();

  // Check if name already exists
  const existingId = await redis.get(`rl:rule:name:${name}`);
  if (existingId) {
    throw new Error('Rule name already exists');
  }

  // Generate rule ID
  const ruleId = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Rule data
  const rule = {
    id: ruleId,
    name,
    target: JSON.stringify(target),
    limit: JSON.stringify(limit),
    action,
    priority,
    enabled: enabled ? 'true' : 'false',
    description,
    conditions: conditions ? JSON.stringify(conditions) : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Store rule in Redis hash
  await redis.hset(`rl:rule:${ruleId}`, rule);

  // Create name index
  await redis.set(`rl:rule:name:${name}`, ruleId);

  // Add to rules set
  await redis.sadd('rl:rules', ruleId);

  // Add to priority sorted set (for efficient retrieval by priority)
  await redis.zadd('rl:rules:priority', priority, ruleId);

  logger.info('Rate limit rule created', { ruleId, name, priority });

  return { 
    ...rule, 
    target: JSON.parse(rule.target), 
    limit: JSON.parse(rule.limit), 
    enabled: rule.enabled === 'true',
    conditions: rule.conditions ? JSON.parse(rule.conditions) : null,
  };
};

/**
 * Get rule by ID
 * 
 * @param {string} ruleId - Rule ID
 * @returns {Promise<Object|null>} Rule object or null
 */
const getRuleById = async (ruleId) => {
  if (!isRedisConnected()) {
    return null;
  }

  const redis = getRedisClient();
  const rule = await redis.hgetall(`rl:rule:${ruleId}`);

  if (!rule || Object.keys(rule).length === 0) {
    return null;
  }

  // Parse JSON fields
  return {
    ...rule,
    target: JSON.parse(rule.target),
    limit: JSON.parse(rule.limit),
    priority: parseInt(rule.priority),
    enabled: rule.enabled === 'true',
    conditions: rule.conditions ? JSON.parse(rule.conditions) : null,
  };
};

/**
 * Get rule by name
 * 
 * @param {string} name - Rule name
 * @returns {Promise<Object|null>} Rule object or null
 */
const getRuleByName = async (name) => {
  if (!isRedisConnected()) {
    return null;
  }

  const redis = getRedisClient();
  const ruleId = await redis.get(`rl:rule:name:${name}`);
  
  if (!ruleId) {
    return null;
  }

  return getRuleById(ruleId);
};

/**
 * Get all rules
 * 
 * @param {Object} options - Query options
 * @param {boolean} options.enabledOnly - Only return enabled rules
 * @param {boolean} options.sortByPriority - Sort by priority (descending)
 * @returns {Promise<Array>} Array of rules
 */
const getAllRules = async (options = {}) => {
  if (!isRedisConnected()) {
    return [];
  }

  const redis = getRedisClient();
  const { enabledOnly = false, sortByPriority = false } = options;

  let ruleIds;

  if (sortByPriority) {
    // Get rules sorted by priority (highest first)
    ruleIds = await redis.zrevrange('rl:rules:priority', 0, -1);
  } else {
    // Get all rule IDs
    ruleIds = await redis.smembers('rl:rules');
  }

  // Get all rule data
  const rules = await Promise.all(
    ruleIds.map(ruleId => getRuleById(ruleId))
  );

  let filteredRules = rules.filter(rule => rule !== null);

  if (enabledOnly) {
    filteredRules = filteredRules.filter(rule => rule.enabled);
  }

  return filteredRules;
};

/**
 * Update rule
 * 
 * @param {string} ruleId - Rule ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated rule
 */
const updateRule = async (ruleId, updates) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required to update rule');
  }

  const redis = getRedisClient();

  // Check if rule exists
  const rule = await getRuleById(ruleId);
  if (!rule) {
    throw new Error('Rule not found');
  }

  // Prepare update data
  const updateData = {};

  // Handle JSON fields
  if (updates.target !== undefined) {
    updateData.target = JSON.stringify(updates.target);
  }
  if (updates.limit !== undefined) {
    updateData.limit = JSON.stringify(updates.limit);
  }
  if (updates.conditions !== undefined) {
    updateData.conditions = updates.conditions ? JSON.stringify(updates.conditions) : null;
  }

  // Handle simple fields
  const simpleFields = ['action', 'description'];
  for (const field of simpleFields) {
    if (updates[field] !== undefined) {
      updateData[field] = updates[field];
    }
  }

  // Handle enabled field
  if (updates.enabled !== undefined) {
    updateData.enabled = updates.enabled ? 'true' : 'false';
  }

  // Handle priority
  if (updates.priority !== undefined) {
    updateData.priority = updates.priority;
    // Update priority sorted set
    await redis.zadd('rl:rules:priority', updates.priority, ruleId);
  }

  // Add updated timestamp
  updateData.updatedAt = new Date().toISOString();

  // Update rule in Redis
  if (Object.keys(updateData).length > 0) {
    await redis.hset(`rl:rule:${ruleId}`, updateData);
    logger.info('Rate limit rule updated', { ruleId, fields: Object.keys(updateData) });
  }

  return getRuleById(ruleId);
};

/**
 * Delete rule
 * 
 * @param {string} ruleId - Rule ID
 * @returns {Promise<boolean>} Success status
 */
const deleteRule = async (ruleId) => {
  if (!isRedisConnected()) {
    throw new Error('Redis connection required to delete rule');
  }

  const redis = getRedisClient();

  // Get rule data first
  const rule = await getRuleById(ruleId);
  if (!rule) {
    return false;
  }

  // Delete name index
  await redis.del(`rl:rule:name:${rule.name}`);

  // Delete rule hash
  await redis.del(`rl:rule:${ruleId}`);

  // Remove from rules set
  await redis.srem('rl:rules', ruleId);

  // Remove from priority sorted set
  await redis.zrem('rl:rules:priority', ruleId);

  logger.info('Rate limit rule deleted', { ruleId, name: rule.name });

  return true;
};

/**
 * Enable rule
 * 
 * @param {string} ruleId - Rule ID
 * @returns {Promise<Object>} Updated rule
 */
const enableRule = async (ruleId) => {
  return updateRule(ruleId, { enabled: true });
};

/**
 * Disable rule
 * 
 * @param {string} ruleId - Rule ID
 * @returns {Promise<Object>} Updated rule
 */
const disableRule = async (ruleId) => {
  return updateRule(ruleId, { enabled: false });
};

/**
 * Count total rules
 * 
 * @returns {Promise<number>} Rule count
 */
const countRules = async () => {
  if (!isRedisConnected()) {
    return 0;
  }

  const redis = getRedisClient();
  return redis.scard('rl:rules');
};

/**
 * Check if a rule is currently active based on time-based conditions
 * 
 * @param {Object} rule - Rule object
 * @returns {boolean} True if rule is active or has no time conditions
 */
const isRuleActiveNow = (rule) => {
  // If no conditions or no timeRange, rule is always active
  if (!rule.conditions || !rule.conditions.timeRange) {
    return true;
  }

  const { timeRange } = rule.conditions;
  const { start, end, timezone = 'UTC' } = timeRange;

  if (!start || !end) {
    return true; // Invalid time range, allow by default
  }

  try {
    // Get current time in specified timezone
    const now = new Date();
    
    // Parse HH:mm format (e.g., "09:00", "17:30")
    const parseTime = (timeStr) => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      return { hours, minutes };
    };

    const startTime = parseTime(start);
    const endTime = parseTime(end);

    // Get current time components
    // Note: For production, use a timezone library like 'moment-timezone' or 'luxon'
    // For now, we'll use UTC offset approximation
    let currentHours = now.getUTCHours();
    let currentMinutes = now.getUTCMinutes();

    // Apply timezone offset (simplified - doesn't handle DST)
    if (timezone !== 'UTC') {
      // Parse timezone offset (e.g., "America/New_York", "UTC-5", "+05:30")
      // For simplicity, this implementation works with offset notation
      const offsetMatch = timezone.match(/UTC([+-]\d{1,2}):?(\d{2})?/);
      if (offsetMatch) {
        const offsetHours = parseInt(offsetMatch[1]);
        const offsetMinutes = parseInt(offsetMatch[2] || '0');
        currentHours = (currentHours + offsetHours + 24) % 24;
        currentMinutes = currentMinutes + offsetMinutes;
        if (currentMinutes >= 60) {
          currentHours = (currentHours + 1) % 24;
          currentMinutes -= 60;
        }
      }
    }

    // Convert to minutes since midnight for easier comparison
    const currentMinutesSinceMidnight = currentHours * 60 + currentMinutes;
    const startMinutesSinceMidnight = startTime.hours * 60 + startTime.minutes;
    const endMinutesSinceMidnight = endTime.hours * 60 + endTime.minutes;

    // Handle spans across midnight (e.g., 22:00 to 06:00)
    if (startMinutesSinceMidnight <= endMinutesSinceMidnight) {
      // Normal time range (e.g., 09:00 to 17:00)
      return currentMinutesSinceMidnight >= startMinutesSinceMidnight && 
             currentMinutesSinceMidnight < endMinutesSinceMidnight;
    } else {
      // Crosses midnight (e.g., 22:00 to 06:00 means active from 22:00-23:59 and 00:00-05:59)
      return currentMinutesSinceMidnight >= startMinutesSinceMidnight || 
             currentMinutesSinceMidnight < endMinutesSinceMidnight;
    }
  } catch (error) {
    logger.error('Error checking rule time condition', { 
      ruleId: rule.id, 
      error: error.message 
    });
    return true; // On error, allow by default
  }
};

module.exports = {
  createRule,
  getRuleById,
  getRuleByName,
  getAllRules,
  updateRule,
  deleteRule,
  enableRule,
  disableRule,
  countRules,
  isRuleActiveNow,
};
