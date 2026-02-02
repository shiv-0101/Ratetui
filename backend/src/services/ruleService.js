/**
 * Rule Service
 * 
 * Business logic for rate limit rule management
 * Handles validation, conflicts, and audit logging
 */

const RateLimitRule = require('../models/RateLimitRule');
const { getRedisClient, isRedisConnected } = require('../config/redis');
const logger = require('../utils/logger');

/**
 * Create a new rule with validation
 * 
 * @param {Object} ruleData - Rule configuration
 * @param {Object} actor - User performing the action
 * @returns {Promise<Object>} Created rule
 */
const createRule = async (ruleData, actor) => {
  // Validate rule data (basic validation, detailed validation in validator)
  if (!ruleData.name || !ruleData.target || !ruleData.limit) {
    throw new Error('Name, target, and limit are required');
  }

  // Check for naming conflicts
  const existingRule = await RateLimitRule.getRuleByName(ruleData.name);
  if (existingRule) {
    throw new Error(`Rule with name '${ruleData.name}' already exists`);
  }

  // Create the rule
  const rule = await RateLimitRule.createRule(ruleData);

  // Log audit trail
  await logAudit({
    action: 'create',
    ruleId: rule.id,
    ruleName: rule.name,
    actor: actor.id,
    actorEmail: actor.email,
    data: rule,
  });

  logger.info('Rule created via service', { ruleId: rule.id, actor: actor.id });

  return rule;
};

/**
 * Update an existing rule
 * 
 * @param {string} ruleId - Rule ID
 * @param {Object} updates - Fields to update
 * @param {Object} actor - User performing the action
 * @returns {Promise<Object>} Updated rule
 */
const updateRule = async (ruleId, updates, actor) => {
  // Get existing rule
  const existingRule = await RateLimitRule.getRuleById(ruleId);
  if (!existingRule) {
    throw new Error('Rule not found');
  }

  // Update the rule
  const updatedRule = await RateLimitRule.updateRule(ruleId, updates);

  // Log audit trail
  await logAudit({
    action: 'update',
    ruleId: ruleId,
    ruleName: existingRule.name,
    actor: actor.id,
    actorEmail: actor.email,
    before: existingRule,
    after: updatedRule,
  });

  logger.info('Rule updated via service', { ruleId, actor: actor.id });

  return updatedRule;
};

/**
 * Delete a rule
 * 
 * @param {string} ruleId - Rule ID
 * @param {Object} actor - User performing the action
 * @returns {Promise<boolean>} Success status
 */
const deleteRule = async (ruleId, actor) => {
  // Get existing rule for audit
  const existingRule = await RateLimitRule.getRuleById(ruleId);
  if (!existingRule) {
    throw new Error('Rule not found');
  }

  // Delete the rule
  const success = await RateLimitRule.deleteRule(ruleId);

  if (success) {
    // Log audit trail
    await logAudit({
      action: 'delete',
      ruleId: ruleId,
      ruleName: existingRule.name,
      actor: actor.id,
      actorEmail: actor.email,
      data: existingRule,
    });

    logger.info('Rule deleted via service', { ruleId, actor: actor.id });
  }

  return success;
};

/**
 * Enable a rule
 * 
 * @param {string} ruleId - Rule ID
 * @param {Object} actor - User performing the action
 * @returns {Promise<Object>} Updated rule
 */
const enableRule = async (ruleId, actor) => {
  const rule = await RateLimitRule.enableRule(ruleId);

  await logAudit({
    action: 'enable',
    ruleId: ruleId,
    ruleName: rule.name,
    actor: actor.id,
    actorEmail: actor.email,
  });

  logger.info('Rule enabled via service', { ruleId, actor: actor.id });

  return rule;
};

/**
 * Disable a rule
 * 
 * @param {string} ruleId - Rule ID
 * @param {Object} actor - User performing the action
 * @returns {Promise<Object>} Updated rule
 */
const disableRule = async (ruleId, actor) => {
  const rule = await RateLimitRule.disableRule(ruleId);

  await logAudit({
    action: 'disable',
    ruleId: ruleId,
    ruleName: rule.name,
    actor: actor.id,
    actorEmail: actor.email,
  });

  logger.info('Rule disabled via service', { ruleId, actor: actor.id });

  return rule;
};

/**
 * Get a single rule
 * 
 * @param {string} ruleId - Rule ID
 * @returns {Promise<Object|null>} Rule or null
 */
const getRule = async (ruleId) => {
  return RateLimitRule.getRuleById(ruleId);
};

/**
 * Get all rules
 * 
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Array of rules
 */
const getAllRules = async (options = {}) => {
  return RateLimitRule.getAllRules(options);
};

/**
 * Get enabled rules sorted by priority
 * Used by rate limiter middleware
 * 
 * @returns {Promise<Array>} Array of enabled rules
 */
const getActiveRules = async () => {
  return RateLimitRule.getAllRules({
    enabledOnly: true,
    sortByPriority: true,
  });
};

/**
 * Check for rule conflicts
 * Detects overlapping patterns that might cause issues
 * 
 * @param {Object} ruleData - New rule to check
 * @returns {Promise<Array>} Array of conflicting rules
 */
const checkConflicts = async (ruleData) => {
  const allRules = await RateLimitRule.getAllRules({ enabledOnly: true });
  const conflicts = [];

  for (const existingRule of allRules) {
    // Check if targets overlap
    if (existingRule.target.type === ruleData.target.type) {
      // Simple pattern matching (can be enhanced)
      if (existingRule.target.pattern === ruleData.target.pattern) {
        conflicts.push({
          ruleId: existingRule.id,
          ruleName: existingRule.name,
          reason: 'Identical target pattern',
        });
      }
    }
  }

  return conflicts;
};

/**
 * Log audit entry for rule changes
 * 
 * @param {Object} entry - Audit log entry
 */
const logAudit = async (entry) => {
  if (!isRedisConnected()) {
    logger.warn('Redis unavailable, cannot log audit entry');
    return;
  }

  try {
    const redis = getRedisClient();
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const timestamp = new Date().toISOString();

    const auditEntry = {
      ...entry,
      timestamp,
    };

    // Store in daily audit log list
    await redis.lpush(`rl:audit:${date}`, JSON.stringify(auditEntry));

    // Set expiration for 90 days
    await redis.expire(`rl:audit:${date}`, 90 * 24 * 60 * 60);

    logger.info('Audit entry logged', { action: entry.action, ruleId: entry.ruleId });
  } catch (error) {
    logger.error('Failed to log audit entry', { error: error.message });
  }
};

/**
 * Get audit log for a specific date
 * 
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number} limit - Max entries to retrieve
 * @returns {Promise<Array>} Array of audit entries
 */
const getAuditLog = async (date, limit = 100) => {
  if (!isRedisConnected()) {
    return [];
  }

  try {
    const redis = getRedisClient();
    const entries = await redis.lrange(`rl:audit:${date}`, 0, limit - 1);

    return entries.map(entry => JSON.parse(entry));
  } catch (error) {
    logger.error('Failed to retrieve audit log', { error: error.message, date });
    return [];
  }
};

/**
 * Get audit log for a specific rule
 * 
 * @param {string} ruleId - Rule ID
 * @param {number} days - Number of days to look back
 * @returns {Promise<Array>} Array of audit entries for the rule
 */
const getRuleAuditLog = async (ruleId, days = 7) => {
  const entries = [];

  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const dayEntries = await getAuditLog(dateStr);
    const ruleEntries = dayEntries.filter(entry => entry.ruleId === ruleId);
    entries.push(...ruleEntries);
  }

  return entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
};

module.exports = {
  createRule,
  updateRule,
  deleteRule,
  enableRule,
  disableRule,
  getRule,
  getAllRules,
  getActiveRules,
  checkConflicts,
  getAuditLog,
  getRuleAuditLog,
};
