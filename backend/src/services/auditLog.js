/**
 * Enhanced Audit Logging Service
 * 
 * Implements comprehensive audit trail for all security-critical operations:
 * - Admin actions (create/update/delete rules, IP blocks, etc.)
 * - Authentication events (login, logout, token refresh)
 * - Authorization failures
 * - Configuration changes
 * - Security incidents
 * 
 * Based on TRD SR-026 to SR-030 requirements.
 * 
 * Features:
 * - Structured JSON logging with immutable storage
 * - Timestamp, actor, action, target, result tracking
 * - Configurable retention periods
 * - Export capabilities (JSON/CSV)
 * - Query and filtering
 */

const { getRedisClient, isRedisConnected } = require('../config/redis');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Configuration
 */
const AUDIT_CONFIG = {
  // Retention
  RETENTION_DAYS: parseInt(process.env.AUDIT_RETENTION_DAYS, 10) || 90,
  
  // Redis keys
  KEY_PREFIX: 'audit:log:',
  INDEX_KEY: 'audit:index',
  ACTOR_INDEX_PREFIX: 'audit:actor:',
  ACTION_INDEX_PREFIX: 'audit:action:',
  DATE_INDEX_PREFIX: 'audit:date:',
  
  // Limits
  MAX_QUERY_RESULTS: 1000,
  DEFAULT_PAGE_SIZE: 50,
};

/**
 * Audit event categories
 */
const AUDIT_CATEGORIES = {
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  RULE_MANAGEMENT: 'rule_management',
  IP_MANAGEMENT: 'ip_management',
  USER_MANAGEMENT: 'user_management',
  CONFIG_CHANGE: 'config_change',
  SECURITY_INCIDENT: 'security_incident',
  DATA_ACCESS: 'data_access',
  SYSTEM: 'system',
};

/**
 * Audit action types
 */
const AUDIT_ACTIONS = {
  // Authentication
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILURE: 'login_failure',
  LOGOUT: 'logout',
  TOKEN_REFRESH: 'token_refresh',
  TOKEN_REVOKED: 'token_revoked',
  PASSWORD_CHANGE: 'password_change',
  
  // Authorization
  ACCESS_DENIED: 'access_denied',
  PERMISSION_DENIED: 'permission_denied',
  
  // Rule Management
  RULE_CREATED: 'rule_created',
  RULE_UPDATED: 'rule_updated',
  RULE_DELETED: 'rule_deleted',
  RULE_ENABLED: 'rule_enabled',
  RULE_DISABLED: 'rule_disabled',
  
  // IP Management
  IP_BLOCKED: 'ip_blocked',
  IP_UNBLOCKED: 'ip_unblocked',
  IP_WHITELISTED: 'ip_whitelisted',
  IP_WHITELIST_REMOVED: 'ip_whitelist_removed',
  
  // User Management
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  USER_DELETED: 'user_deleted',
  USER_ROLE_CHANGED: 'user_role_changed',
  
  // Config Changes
  CONFIG_UPDATED: 'config_updated',
  SECRET_ROTATED: 'secret_rotated',
  
  // Security Incidents
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  CSRF_ATTACK_DETECTED: 'csrf_attack_detected',
  INJECTION_ATTEMPT: 'injection_attempt',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',
  DISTRIBUTED_ATTACK: 'distributed_attack',
  
  // Data Access
  SENSITIVE_DATA_ACCESSED: 'sensitive_data_accessed',
  BULK_DATA_EXPORT: 'bulk_data_export',
  
  // System
  SERVICE_STARTED: 'service_started',
  SERVICE_STOPPED: 'service_stopped',
  BACKUP_CREATED: 'backup_created',
};

/**
 * Audit result types
 */
const AUDIT_RESULTS = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'error',
  BLOCKED: 'blocked',
  WARNING: 'warning',
};

/**
 * Create audit log entry
 * @param {Object} params - Audit parameters
 * @returns {Promise<string>} Audit log ID
 */
const createAuditLog = async ({
  category,
  action,
  actor,
  actorType = 'user',
  target = null,
  targetType = null,
  result = AUDIT_RESULTS.SUCCESS,
  ipAddress = null,
  userAgent = null,
  details = {},
  errorMessage = null,
  metadata = {},
}) => {
  try {
    const auditId = uuidv4();
    const timestamp = new Date().toISOString();
    const dateKey = timestamp.split('T')[0]; // YYYY-MM-DD
    
    const auditEntry = {
      id: auditId,
      timestamp,
      category,
      action,
      actor: {
        id: actor,
        type: actorType,
      },
      target: target ? {
        id: target,
        type: targetType,
      } : null,
      result,
      context: {
        ipAddress,
        userAgent,
      },
      details,
      errorMessage,
      metadata,
    };
    
    // Store in Redis if available
    if (isRedisConnected()) {
      const redis = getRedisClient();
      const key = `${AUDIT_CONFIG.KEY_PREFIX}${auditId}`;
      
      // Store audit entry as JSON
      await redis.set(key, JSON.stringify(auditEntry));
      
      // Set expiry based on retention policy
      const expirySeconds = AUDIT_CONFIG.RETENTION_DAYS * 24 * 60 * 60;
      await redis.expire(key, expirySeconds);
      
      // Add to main index (sorted by timestamp)
      const timestampScore = new Date(timestamp).getTime();
      await redis.zadd(AUDIT_CONFIG.INDEX_KEY, timestampScore, auditId);
      
      // Add to actor index
      await redis.zadd(
        `${AUDIT_CONFIG.ACTOR_INDEX_PREFIX}${actor}`,
        timestampScore,
        auditId
      );
      
      // Add to action index
      await redis.zadd(
        `${AUDIT_CONFIG.ACTION_INDEX_PREFIX}${action}`,
        timestampScore,
        auditId
      );
      
      // Add to date index
      await redis.zadd(
        `${AUDIT_CONFIG.DATE_INDEX_PREFIX}${dateKey}`,
        timestampScore,
        auditId
      );
      
      // Set expiry on indexes
      await redis.expire(AUDIT_CONFIG.INDEX_KEY, expirySeconds);
      await redis.expire(`${AUDIT_CONFIG.ACTOR_INDEX_PREFIX}${actor}`, expirySeconds);
      await redis.expire(`${AUDIT_CONFIG.ACTION_INDEX_PREFIX}${action}`, expirySeconds);
      await redis.expire(`${AUDIT_CONFIG.DATE_INDEX_PREFIX}${dateKey}`, expirySeconds);
    }
    
    // Always log to file system (immutable storage)
    logger.audit('Audit event', auditEntry);
    
    return auditId;
  } catch (error) {
    logger.error('Failed to create audit log', { error: error.message });
    // Don't throw - audit logging should never break application flow
    return null;
  }
};

/**
 * Query audit logs with filters
 * @param {Object} filters - Query filters
 * @returns {Promise<Array>} Audit log entries
 */
const queryAuditLogs = async ({
  actor = null,
  action = null,
  category = null,
  result = null,
  startDate = null,
  endDate = null,
  limit = AUDIT_CONFIG.DEFAULT_PAGE_SIZE,
  offset = 0,
} = {}) => {
  try {
    if (!isRedisConnected()) {
      logger.warn('Redis unavailable, cannot query audit logs');
      return { logs: [], total: 0 };
    }
    
    const redis = getRedisClient();
    let auditIds = [];
    
    // Determine which index to use
    if (actor) {
      // Query by actor
      const startScore = startDate ? new Date(startDate).getTime() : '-inf';
      const endScore = endDate ? new Date(endDate).getTime() : '+inf';
      
      auditIds = await redis.zrangebyscore(
        `${AUDIT_CONFIG.ACTOR_INDEX_PREFIX}${actor}`,
        startScore,
        endScore
      );
    } else if (action) {
      // Query by action
      const startScore = startDate ? new Date(startDate).getTime() : '-inf';
      const endScore = endDate ? new Date(endDate).getTime() : '+inf';
      
      auditIds = await redis.zrangebyscore(
        `${AUDIT_CONFIG.ACTION_INDEX_PREFIX}${action}`,
        startScore,
        endScore
      );
    } else {
      // Query main index
      const startScore = startDate ? new Date(startDate).getTime() : '-inf';
      const endScore = endDate ? new Date(endDate).getTime() : '+inf';
      
      auditIds = await redis.zrevrangebyscore(
        AUDIT_CONFIG.INDEX_KEY,
        endScore,
        startScore,
        'LIMIT',
        offset,
        Math.min(limit, AUDIT_CONFIG.MAX_QUERY_RESULTS)
      );
    }
    
    // Fetch full audit entries
    const logs = [];
    for (const auditId of auditIds) {
      const key = `${AUDIT_CONFIG.KEY_PREFIX}${auditId}`;
      const entryJson = await redis.get(key);
      
      if (entryJson) {
        const entry = JSON.parse(entryJson);
        
        // Apply additional filters
        if (category && entry.category !== category) continue;
        if (result && entry.result !== result) continue;
        
        logs.push(entry);
      }
    }
    
    return {
      logs,
      total: auditIds.length,
      limit,
      offset,
    };
  } catch (error) {
    logger.error('Failed to query audit logs', { error: error.message });
    return { logs: [], total: 0 };
  }
};

/**
 * Get audit logs for specific actor
 * @param {string} actorId - Actor identifier
 * @param {number} limit - Max results
 * @returns {Promise<Array>} Audit logs
 */
const getActorAuditLogs = async (actorId, limit = 50) => {
  return queryAuditLogs({ actor: actorId, limit });
};

/**
 * Get audit logs by action type
 * @param {string} action - Action type
 * @param {number} limit - Max results
 * @returns {Promise<Array>} Audit logs
 */
const getActionAuditLogs = async (action, limit = 50) => {
  return queryAuditLogs({ action, limit });
};

/**
 * Get recent audit logs
 * @param {number} limit - Max results
 * @returns {Promise<Array>} Recent audit logs
 */
const getRecentAuditLogs = async (limit = 50) => {
  return queryAuditLogs({ limit });
};

/**
 * Export audit logs to JSON
 * @param {Object} filters - Query filters
 * @returns {Promise<string>} JSON string
 */
const exportAuditLogsJSON = async (filters = {}) => {
  try {
    const result = await queryAuditLogs({
      ...filters,
      limit: AUDIT_CONFIG.MAX_QUERY_RESULTS,
    });
    
    return JSON.stringify(result.logs, null, 2);
  } catch (error) {
    logger.error('Failed to export audit logs to JSON', { error: error.message });
    throw error;
  }
};

/**
 * Export audit logs to CSV
 * @param {Object} filters - Query filters
 * @returns {Promise<string>} CSV string
 */
const exportAuditLogsCSV = async (filters = {}) => {
  try {
    const result = await queryAuditLogs({
      ...filters,
      limit: AUDIT_CONFIG.MAX_QUERY_RESULTS,
    });
    
    if (result.logs.length === 0) {
      return 'No audit logs found';
    }
    
    // CSV header
    const headers = [
      'Timestamp',
      'Category',
      'Action',
      'Actor ID',
      'Actor Type',
      'Target ID',
      'Target Type',
      'Result',
      'IP Address',
      'Error Message',
    ];
    
    let csv = headers.join(',') + '\n';
    
    // CSV rows
    for (const log of result.logs) {
      const row = [
        log.timestamp,
        log.category,
        log.action,
        log.actor.id,
        log.actor.type,
        log.target?.id || '',
        log.target?.type || '',
        log.result,
        log.context.ipAddress || '',
        log.errorMessage ? `"${log.errorMessage.replace(/"/g, '""')}"` : '',
      ];
      
      csv += row.join(',') + '\n';
    }
    
    return csv;
  } catch (error) {
    logger.error('Failed to export audit logs to CSV', { error: error.message });
    throw error;
  }
};

/**
 * Get audit statistics
 * @param {string} dateKey - Date key (YYYY-MM-DD)
 * @returns {Promise<Object>} Statistics
 */
const getAuditStats = async (dateKey = null) => {
  try {
    if (!isRedisConnected()) {
      return null;
    }
    
    const targetDate = dateKey || new Date().toISOString().split('T')[0];
    const redis = getRedisClient();
    
    // Get all audit IDs for date
    const auditIds = await redis.zrange(
      `${AUDIT_CONFIG.DATE_INDEX_PREFIX}${targetDate}`,
      0,
      -1
    );
    
    const stats = {
      date: targetDate,
      total: auditIds.length,
      byCategory: {},
      byAction: {},
      byResult: {},
    };
    
    // Aggregate statistics
    for (const auditId of auditIds) {
      const key = `${AUDIT_CONFIG.KEY_PREFIX}${auditId}`;
      const entryJson = await redis.get(key);
      
      if (entryJson) {
        const entry = JSON.parse(entryJson);
        
        // Count by category
        stats.byCategory[entry.category] = (stats.byCategory[entry.category] || 0) + 1;
        
        // Count by action
        stats.byAction[entry.action] = (stats.byAction[entry.action] || 0) + 1;
        
        // Count by result
        stats.byResult[entry.result] = (stats.byResult[entry.result] || 0) + 1;
      }
    }
    
    return stats;
  } catch (error) {
    logger.error('Failed to get audit stats', { error: error.message });
    return null;
  }
};

/**
 * Clean up expired audit logs
 * Called by data retention service
 */
const cleanupExpiredAuditLogs = async () => {
  try {
    if (!isRedisConnected()) {
      return;
    }
    
    const redis = getRedisClient();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - AUDIT_CONFIG.RETENTION_DAYS);
    const cutoffScore = cutoffDate.getTime();
    
    // Remove expired entries from main index
    const removedCount = await redis.zremrangebyscore(
      AUDIT_CONFIG.INDEX_KEY,
      '-inf',
      cutoffScore
    );
    
    logger.info('Cleaned up expired audit logs', {
      removedCount,
      retentionDays: AUDIT_CONFIG.RETENTION_DAYS,
    });
    
    return removedCount;
  } catch (error) {
    logger.error('Failed to cleanup expired audit logs', { error: error.message });
    return 0;
  }
};

module.exports = {
  createAuditLog,
  queryAuditLogs,
  getActorAuditLogs,
  getActionAuditLogs,
  getRecentAuditLogs,
  exportAuditLogsJSON,
  exportAuditLogsCSV,
  getAuditStats,
  cleanupExpiredAuditLogs,
  AUDIT_CATEGORIES,
  AUDIT_ACTIONS,
  AUDIT_RESULTS,
  AUDIT_CONFIG,
};
