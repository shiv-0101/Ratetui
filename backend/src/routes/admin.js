/**
 * Admin Routes
 * 
 * Administrative endpoints for managing rate limit rules.
 * All routes require authentication (will be enforced in Week 2).
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/authorize');
const { rateLimiters } = require('../middleware/rateLimiter');
const { ruleValidationRules, validate } = require('../validators/ruleValidator');
const ruleService = require('../services/ruleService');
const ipManagement = require('../services/ipManagement');
const metricsService = require('../services/metricsService');
const dataRetention = require('../services/dataRetention');
const auditLog = require('../services/auditLog');
const securityMonitor = require('../services/securityMonitor');
const apiKeyService = require('../services/apiKeyService');
const advancedMetrics = require('../services/advancedMetrics');
const { getShutdownStatus } = require('../services/gracefulShutdown');
const { getCircuitStats, resetCircuit } = require('../services/circuitBreaker');
const { invalidateCache, clearCache, getCacheStats } = require('../middleware/caching');
const { getRequestStats, resetRequestStats } = require('../middleware/requestTracker');
const analytics = require('../services/rateLimitAnalytics');
const pubSub = require('../services/pubSubCoordination');
const { createError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// Apply authentication and admin authorization to all admin routes
router.use(authenticate);
router.use(requireAdmin());

// Apply admin rate limiting
router.use(rateLimiters.admin);

/**
 * Admin dashboard info
 * GET /admin/info
 */
router.get('/info', (req, res) => {
  res.json({
    success: true,
    data: {
      message: 'Admin API - Rule Management Active',
      version: '1.0.0',
      endpoints: {
        rules: {
          list: 'GET /admin/rules',
          get: 'GET /admin/rules/:id',
          create: 'POST /admin/rules',
          update: 'PUT /admin/rules/:id',
          delete: 'DELETE /admin/rules/:id',
          enable: 'POST /admin/rules/:id/enable',
          disable: 'POST /admin/rules/:id/disable',
          audit: 'GET /admin/rules/:id/audit',
        },
        audit: {
          list: 'GET /admin/audit',
          byRule: 'GET /admin/rules/:id/audit',
        },
        coming_soon: {
          auth: '/admin/auth/* (Week 2)',
          ip: '/admin/ip/* (Week 2)',
          metrics: '/admin/metrics (Week 3)',
        }
      }
    }
  });
});

/**
 * List all rate limit rules
 * GET /admin/rules
 * Query params: enabled (true/false), sort (priority/name/created)
 */
router.get('/rules', async (req, res, next) => {
  try {
    const { enabled, sort = 'priority' } = req.query;
    
    const options = {
      sortByPriority: sort === 'priority',
    };

    if (enabled !== undefined) {
      options.enabledOnly = enabled === 'true';
    }

    const rules = await ruleService.getAllRules(options);

    logger.info('Rules listed', { 
      count: rules.length, 
      user: req.user.id,
      filters: { enabled, sort },
    });

    res.json({
      success: true,
      data: {
        rules,
        count: rules.length,
        filters: { enabled, sort },
      }
    });
  } catch (error) {
    logger.error('Failed to list rules', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve rules'));
  }
});

/**
 * Get a single rule by ID
 * GET /admin/rules/:id
 */
router.get('/rules/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const rule = await ruleService.getRule(id);

    if (!rule) {
      return next(createError('NOT_FOUND', 'Rule not found'));
    }

    logger.info('Rule retrieved', { ruleId: id, user: req.user.id });

    res.json({
      success: true,
      data: { rule }
    });
  } catch (error) {
    logger.error('Failed to get rule', { ruleId: req.params.id, error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve rule'));
  }
});

/**
 * Create a new rate limit rule
 * POST /admin/rules
 */
router.post('/rules', ruleValidationRules(), validate, async (req, res, next) => {
  try {
    const rule = await ruleService.createRule(req.body, req.user);

    logger.info('Rule created', { ruleId: rule.id, name: rule.name, user: req.user.id });

    res.status(201).json({
      success: true,
      data: { rule },
      message: 'Rule created successfully'
    });
  } catch (error) {
    if (error.message.includes('already exists')) {
      return next(createError('CONFLICT', error.message));
    }
    logger.error('Failed to create rule', { error: error.message, user: req.user.id });
    next(createError('INTERNAL_ERROR', error.message || 'Failed to create rule'));
  }
});

/**
 * Update an existing rule
 * PUT /admin/rules/:id
 */
router.put('/rules/:id', ruleValidationRules(), validate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const rule = await ruleService.updateRule(id, req.body, req.user);

    logger.info('Rule updated', { ruleId: id, user: req.user.id });

    res.json({
      success: true,
      data: { rule },
      message: 'Rule updated successfully'
    });
  } catch (error) {
    if (error.message === 'Rule not found') {
      return next(createError('NOT_FOUND', 'Rule not found'));
    }
    logger.error('Failed to update rule', { ruleId: req.params.id, error: error.message });
    next(createError('INTERNAL_ERROR', error.message || 'Failed to update rule'));
  }
});

/**
 * Delete a rule
 * DELETE /admin/rules/:id
 */
router.delete('/rules/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const success = await ruleService.deleteRule(id, req.user);

    if (!success) {
      return next(createError('NOT_FOUND', 'Rule not found'));
    }

    logger.info('Rule deleted', { ruleId: id, user: req.user.id });

    res.json({
      success: true,
      message: 'Rule deleted successfully'
    });
  } catch (error) {
    if (error.message === 'Rule not found') {
      return next(createError('NOT_FOUND', 'Rule not found'));
    }
    logger.error('Failed to delete rule', { ruleId: req.params.id, error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to delete rule'));
  }
});

/**
 * Enable a rule
 * POST /admin/rules/:id/enable
 */
router.post('/rules/:id/enable', async (req, res, next) => {
  try {
    const { id } = req.params;
    const rule = await ruleService.enableRule(id, req.user);

    logger.info('Rule enabled', { ruleId: id, user: req.user.id });

    res.json({
      success: true,
      data: { rule },
      message: 'Rule enabled successfully'
    });
  } catch (error) {
    if (error.message === 'Rule not found') {
      return next(createError('NOT_FOUND', 'Rule not found'));
    }
    logger.error('Failed to enable rule', { ruleId: req.params.id, error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to enable rule'));
  }
});

/**
 * Disable a rule
 * POST /admin/rules/:id/disable
 */
router.post('/rules/:id/disable', async (req, res, next) => {
  try {
    const { id } = req.params;
    const rule = await ruleService.disableRule(id, req.user);

    logger.info('Rule disabled', { ruleId: id, user: req.user.id });

    res.json({
      success: true,
      data: { rule },
      message: 'Rule disabled successfully'
    });
  } catch (error) {
    if (error.message === 'Rule not found') {
      return next(createError('NOT_FOUND', 'Rule not found'));
    }
    logger.error('Failed to disable rule', { ruleId: req.params.id, error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to disable rule'));
  }
});

/**
 * Get audit log for a specific date
 * GET /admin/audit
 * Query params: date (YYYY-MM-DD, defaults to today), limit (default 100)
 */
router.get('/audit', async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const limit = parseInt(req.query.limit) || 100;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return next(createError('VALIDATION_ERROR', 'Invalid date format. Use YYYY-MM-DD'));
    }

    const entries = await ruleService.getAuditLog(date, limit);

    logger.info('Audit log retrieved', { date, count: entries.length, user: req.user.id });

    res.json({
      success: true,
      data: {
        entries,
        count: entries.length,
        date,
        limit,
      }
    });
  } catch (error) {
    logger.error('Failed to retrieve audit log', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve audit log'));
  }
});

/**
 * Get audit log for a specific rule
 * GET /admin/rules/:id/audit
 * Query params: days (default 7)
 */
router.get('/rules/:id/audit', async (req, res, next) => {
  try {
    const { id } = req.params;
    const days = parseInt(req.query.days) || 7;

    if (days < 1 || days > 90) {
      return next(createError('VALIDATION_ERROR', 'Days must be between 1 and 90'));
    }

    const entries = await ruleService.getRuleAuditLog(id, days);

    logger.info('Rule audit log retrieved', { 
      ruleId: id, 
      count: entries.length, 
      days,
      user: req.user.id 
    });

    res.json({
      success: true,
      data: {
        ruleId: id,
        entries,
        count: entries.length,
        days,
      }
    });
  } catch (error) {
    logger.error('Failed to retrieve rule audit log', { 
      ruleId: req.params.id, 
      error: error.message 
    });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve rule audit log'));
  }
});

/**
 * Get blocked IPs
 * GET /admin/ip/blocked
 * Query params: limit, offset
 */
router.get('/ip/blocked', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const blacklistedIPs = await ipManagement.getBlacklistedIPs({ limit, offset });
    const stats = await ipManagement.getIPStats();

    logger.info('Blacklisted IPs retrieved', { 
      count: blacklistedIPs.length, 
      user: req.user.id 
    });

    res.json({
      success: true,
      data: {
        blacklisted: blacklistedIPs,
        count: blacklistedIPs.length,
        total: stats.blacklisted,
        limit,
        offset,
      }
    });
  } catch (error) {
    logger.error('Failed to retrieve blacklisted IPs', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve blacklisted IPs'));
  }
});

/**
 * Get whitelisted IPs
 * GET /admin/ip/whitelisted
 * Query params: limit, offset
 */
router.get('/ip/whitelisted', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const whitelistedIPs = await ipManagement.getWhitelistedIPs({ limit, offset });
    const stats = await ipManagement.getIPStats();

    logger.info('Whitelisted IPs retrieved', { 
      count: whitelistedIPs.length, 
      user: req.user.id 
    });

    res.json({
      success: true,
      data: {
        whitelisted: whitelistedIPs,
        count: whitelistedIPs.length,
        total: stats.whitelisted,
        limit,
        offset,
      }
    });
  } catch (error) {
    logger.error('Failed to retrieve whitelisted IPs', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve whitelisted IPs'));
  }
});

/**
 * Check IP status
 * GET /admin/ip/check/:ip
 */
router.get('/ip/check/:ip', async (req, res, next) => {
  try {
    const { ip } = req.params;

    const blacklistEntry = await ipManagement.isIPBlacklisted(ip);
    const whitelistEntry = await ipManagement.isIPWhitelisted(ip);

    let status = 'normal';
    if (blacklistEntry) status = 'blacklisted';
    if (whitelistEntry) status = 'whitelisted';

    res.json({
      success: true,
      data: {
        ip,
        status,
        blacklist: blacklistEntry,
        whitelist: whitelistEntry,
      }
    });
  } catch (error) {
    logger.error('Failed to check IP status', { ip: req.params.ip, error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to check IP status'));
  }
});

/**
 * Blacklist an IP
 * POST /admin/ip/blacklist
 * Body: { ip, duration, reason }
 */
router.post('/ip/blacklist', [
  body('ip').notEmpty().withMessage('IP address is required')
    .matches(/^(\d{1,3}\.){3}\d{1,3}$/).withMessage('Invalid IP address format'),
  body('duration').optional().isInt({ min: 0 }).withMessage('Duration must be a positive integer'),
  body('reason').optional().isString().withMessage('Reason must be a string'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createError('VALIDATION_ERROR', 'Invalid input', { errors: errors.array() }));
    }

    const { ip, duration = 0, reason = '' } = req.body;

    const entry = await ipManagement.blacklistIP(ip, duration, reason, req.user);

    logger.info('IP blacklisted', { ip, duration, user: req.user.id });

    res.status(201).json({
      success: true,
      data: { entry },
      message: `IP ${ip} blacklisted successfully`
    });
  } catch (error) {
    logger.error('Failed to blacklist IP', { error: error.message });
    next(createError('INTERNAL_ERROR', error.message || 'Failed to blacklist IP'));
  }
});

/**
 * Unblacklist an IP
 * DELETE /admin/ip/blacklist/:ip
 */
router.delete('/ip/blacklist/:ip', async (req, res, next) => {
  try {
    const { ip } = req.params;

    await ipManagement.unblacklistIP(ip, req.user);

    logger.info('IP unblacklisted', { ip, user: req.user.id });

    res.json({
      success: true,
      message: `IP ${ip} removed from blacklist`
    });
  } catch (error) {
    logger.error('Failed to unblacklist IP', { ip: req.params.ip, error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to unblacklist IP'));
  }
});

/**
 * Whitelist an IP
 * POST /admin/ip/whitelist
 * Body: { ip, reason }
 */
router.post('/ip/whitelist', [
  body('ip').notEmpty().withMessage('IP address is required')
    .matches(/^(\d{1,3}\.){3}\d{1,3}$/).withMessage('Invalid IP address format'),
  body('reason').optional().isString().withMessage('Reason must be a string'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createError('VALIDATION_ERROR', 'Invalid input', { errors: errors.array() }));
    }

    const { ip, reason = '' } = req.body;

    const entry = await ipManagement.whitelistIP(ip, reason, req.user);

    logger.info('IP whitelisted', { ip, user: req.user.id });

    res.status(201).json({
      success: true,
      data: { entry },
      message: `IP ${ip} whitelisted successfully`
    });
  } catch (error) {
    logger.error('Failed to whitelist IP', { error: error.message });
    next(createError('INTERNAL_ERROR', error.message || 'Failed to whitelist IP'));
  }
});

/**
 * Remove IP from whitelist
 * DELETE /admin/ip/whitelist/:ip
 */
router.delete('/ip/whitelist/:ip', async (req, res, next) => {
  try {
    const { ip } = req.params;

    await ipManagement.unwhitelistIP(ip, req.user);

    logger.info('IP removed from whitelist', { ip, user: req.user.id });

    res.json({
      success: true,
      message: `IP ${ip} removed from whitelist`
    });
  } catch (error) {
    logger.error('Failed to remove IP from whitelist', { ip: req.params.ip, error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to remove IP from whitelist'));
  }
});

/**
 * Get IP statistics
 * GET /admin/ip/stats
 */
router.get('/ip/stats', async (req, res, next) => {
  try {
    const stats = await ipManagement.getIPStats();

    res.json({
      success: true,
      data: { stats }
    });
  } catch (error) {
    logger.error('Failed to get IP stats', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to get IP statistics'));
  }
});

/**
 * Get comprehensive metrics
 * GET /admin/metrics
 */
router.get('/metrics', async (req, res, next) => {
  try {
    const summary = await metricsService.getMetricsSummary();

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    logger.error('Failed to get metrics summary', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve metrics'));
  }
});

/**
 * Get global metrics
 * GET /admin/metrics/global
 */
router.get('/metrics/global', async (req, res, next) => {
  try {
    const metrics = await metricsService.getGlobalMetrics();

    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Failed to get global metrics', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve global metrics'));
  }
});

/**
 * Get time-series metrics
 * GET /admin/metrics/timeseries
 * Query params: period (hour|day), count
 */
router.get('/metrics/timeseries', async (req, res, next) => {
  try {
    const period = req.query.period || 'hour';
    const count = parseInt(req.query.count) || (period === 'hour' ? 24 : 7);

    if (!['hour', 'day'].includes(period)) {
      return next(createError('VALIDATION_ERROR', 'Period must be hour or day'));
    }

    const metrics = await metricsService.getTimeSeriesMetrics(period, count);

    res.json({
      success: true,
      data: {
        period,
        count,
        metrics
      }
    });
  } catch (error) {
    logger.error('Failed to get time-series metrics', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve time-series metrics'));
  }
});

/**
 * Get endpoint metrics
 * GET /admin/metrics/endpoint/:endpoint
 */
router.get('/metrics/endpoint/:endpoint(*)', async (req, res, next) => {
  try {
    const endpoint = '/' + req.params.endpoint;
    const metrics = await metricsService.getEndpointMetrics(endpoint);

    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Failed to get endpoint metrics', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve endpoint metrics'));
  }
});

/**
 * Get top endpoints
 * GET /admin/metrics/top/endpoints
 * Query params: limit
 */
router.get('/metrics/top/endpoints', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const endpoints = await metricsService.getTopEndpoints(limit);

    res.json({
      success: true,
      data: {
        endpoints,
        count: endpoints.length,
        limit
      }
    });
  } catch (error) {
    logger.error('Failed to get top endpoints', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve top endpoints'));
  }
});

/**
 * Get IP metrics
 * GET /admin/metrics/ip/:ip
 */
router.get('/metrics/ip/:ip', async (req, res, next) => {
  try {
    const { ip } = req.params;
    const metrics = await metricsService.getIPMetrics(ip);

    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Failed to get IP metrics', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve IP metrics'));
  }
});

/**
 * Get top IPs
 * GET /admin/metrics/top/ips
 * Query params: limit
 */
router.get('/metrics/top/ips', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const ips = await metricsService.getTopIPs(limit);

    res.json({
      success: true,
      data: {
        ips,
        count: ips.length,
        limit
      }
    });
  } catch (error) {
    logger.error('Failed to get top IPs', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve top IPs'));
  }
});

/**
 * Get rule metrics
 * GET /admin/metrics/rule/:ruleId
 */
router.get('/metrics/rule/:ruleId', async (req, res, next) => {
  try {
    const { ruleId } = req.params;
    const metrics = await metricsService.getRuleMetrics(ruleId);

    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Failed to get rule metrics', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve rule metrics'));
  }
});

/**
 * Get performance metrics
 * GET /admin/metrics/performance
 */
router.get('/metrics/performance', async (req, res, next) => {
  try {
    const percentiles = await metricsService.getResponseTimePercentiles();

    res.json({
      success: true,
      data: percentiles
    });
  } catch (error) {
    logger.error('Failed to get performance metrics', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve performance metrics'));
  }
});

/**
 * Reset metrics
 * POST /admin/metrics/reset
 */
router.post('/metrics/reset', async (req, res, next) => {
  try {
    await metricsService.resetMetrics();

    logger.warn('Metrics reset', { user: req.user.id });

    res.json({
      success: true,
      message: 'All metrics have been reset'
    });
  } catch (error) {
    logger.error('Failed to reset metrics', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to reset metrics'));
  }
});

/**
 * Get real-time request statistics
 * GET /admin/stats/requests
 */
router.get('/stats/requests', (req, res, next) => {
  try {
    const stats = getRequestStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Failed to get request stats', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve request statistics'));
  }
});

/**
 * Reset request statistics
 * POST /admin/stats/requests/reset
 */
router.post('/stats/requests/reset', (req, res, next) => {
  try {
    resetRequestStats();

    logger.warn('Request stats reset', { user: req.user.id });

    res.json({
      success: true,
      message: 'Request statistics have been reset'
    });
  } catch (error) {
    logger.error('Failed to reset request stats', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to reset request statistics'));
  }
});

// ===========================================
// Data Retention Management
// ===========================================

/**
 * Get data retention statistics
 * GET /admin/retention/stats
 */
router.get('/retention/stats', async (req, res, next) => {
  try {
    const stats = await dataRetention.getRetentionStatistics();

    res.json({
      success: true,
      data: {
        policies: dataRetention.RETENTION_POLICIES,
        statistics: stats,
        timestamp: new Date().toISOString(),
      }
    });
  } catch (error) {
    logger.error('Failed to get retention stats', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve retention statistics'));
  }
});

/**
 * Run manual cleanup
 * POST /admin/retention/cleanup
 */
router.post('/retention/cleanup', async (req, res, next) => {
  try {
    logger.info('Manual retention cleanup triggered', { user: req.user.id });
    
    const results = await dataRetention.runPeriodicCleanup();

    res.json({
      success: true,
      data: {
        message: 'Cleanup completed',
        results,
        timestamp: new Date().toISOString(),
      }
    });
  } catch (error) {
    logger.error('Failed to run cleanup', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to run cleanup'));
  }
});

// ===========================================
// Audit Log Management
// ===========================================

/**
 * Query audit logs with filters
 * GET /admin/audit/logs
 */
router.get('/audit/logs', async (req, res, next) => {
  try {
    const {
      actor,
      action,
      category,
      result,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = req.query;

    const auditData = await auditLog.queryAuditLogs({
      actor,
      action,
      category,
      result,
      startDate,
      endDate,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    res.json({
      success: true,
      data: auditData,
    });
  } catch (error) {
    logger.error('Failed to query audit logs', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve audit logs'));
  }
});

/**
 * Get audit logs for specific actor
 * GET /admin/audit/actor/:actorId
 */
router.get('/audit/actor/:actorId', async (req, res, next) => {
  try {
    const { actorId } = req.params;
    const { limit = 50 } = req.query;

    const auditData = await auditLog.getActorAuditLogs(actorId, parseInt(limit, 10));

    res.json({
      success: true,
      data: auditData,
    });
  } catch (error) {
    logger.error('Failed to get actor audit logs', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve actor audit logs'));
  }
});

/**
 * Get recent audit logs
 * GET /admin/audit/recent
 */
router.get('/audit/recent', async (req, res, next) => {
  try {
    const { limit = 50 } = req.query;

    const auditData = await auditLog.getRecentAuditLogs(parseInt(limit, 10));

    res.json({
      success: true,
      data: auditData,
    });
  } catch (error) {
    logger.error('Failed to get recent audit logs', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve recent audit logs'));
  }
});

/**
 * Get audit statistics
 * GET /admin/audit/stats
 */
router.get('/audit/stats', async (req, res, next) => {
  try {
    const { date } = req.query;

    const stats = await auditLog.getAuditStats(date);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Failed to get audit stats', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve audit statistics'));
  }
});

/**
 * Export audit logs to JSON
 * GET /admin/audit/export/json
 */
router.get('/audit/export/json', async (req, res, next) => {
  try {
    const {
      actor,
      action,
      category,
      result,
      startDate,
      endDate,
    } = req.query;

    const jsonData = await auditLog.exportAuditLogsJSON({
      actor,
      action,
      category,
      result,
      startDate,
      endDate,
    });

    // Log audit export action
    await auditLog.createAuditLog({
      category: auditLog.AUDIT_CATEGORIES.DATA_ACCESS,
      action: auditLog.AUDIT_ACTIONS.BULK_DATA_EXPORT,
      actor: req.user.id,
      actorType: 'user',
      result: auditLog.AUDIT_RESULTS.SUCCESS,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { format: 'json', filters: req.query },
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString()}.json"`);
    res.send(jsonData);
  } catch (error) {
    logger.error('Failed to export audit logs (JSON)', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to export audit logs'));
  }
});

/**
 * Export audit logs to CSV
 * GET /admin/audit/export/csv
 */
router.get('/audit/export/csv', async (req, res, next) => {
  try {
    const {
      actor,
      action,
      category,
      result,
      startDate,
      endDate,
    } = req.query;

    const csvData = await auditLog.exportAuditLogsCSV({
      actor,
      action,
      category,
      result,
      startDate,
      endDate,
    });

    // Log audit export action
    await auditLog.createAuditLog({
      category: auditLog.AUDIT_CATEGORIES.DATA_ACCESS,
      action: auditLog.AUDIT_ACTIONS.BULK_DATA_EXPORT,
      actor: req.user.id,
      actorType: 'user',
      result: auditLog.AUDIT_RESULTS.SUCCESS,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { format: 'csv', filters: req.query },
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString()}.csv"`);
    res.send(csvData);
  } catch (error) {
    logger.error('Failed to export audit logs (CSV)', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to export audit logs'));
  }
});

// ===========================================
// Security Monitoring
// ===========================================

/**
 * Get security dashboard
 * GET /admin/security/dashboard
 */
router.get('/security/dashboard', async (req, res, next) => {
  try {
    const dashboard = await securityMonitor.getSecurityDashboard();

    res.json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    logger.error('Failed to get security dashboard', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve security dashboard'));
  }
});

/**
 * Get security metrics for date range
 * GET /admin/security/metrics
 */
router.get('/security/metrics', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const metrics = await securityMonitor.getSecurityMetrics(startDate, endDate);

    res.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    logger.error('Failed to get security metrics', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve security metrics'));
  }
});

/**
 * Get recent security events
 * GET /admin/security/events
 */
router.get('/security/events', async (req, res, next) => {
  try {
    const { eventType, limit = 50 } = req.query;

    const events = await securityMonitor.getRecentSecurityEvents(
      eventType,
      parseInt(limit, 10)
    );

    res.json({
      success: true,
      data: {
        events,
        count: events.length,
      },
    });
  } catch (error) {
    logger.error('Failed to get security events', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve security events'));
  }
});

// ===========================================
// API Key Management
// ===========================================

/**
 * List user's API keys
 * GET /admin/apikeys
 */
router.get('/apikeys', async (req, res, next) => {
  try {
    const keys = await apiKeyService.listUserApiKeys(req.user.id);

    res.json({
      success: true,
      data: {
        keys,
        count: keys.length,
      },
    });
  } catch (error) {
    logger.error('Failed to list API keys', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve API keys'));
  }
});

/**
 * Create new API key
 * POST /admin/apikeys
 */
router.post(
  '/apikeys',
  [
    body('name').trim().isLength({ min: 3, max: 100 }).withMessage('Name must be 3-100 characters'),
    body('scopes').isArray().withMessage('Scopes must be an array'),
    body('rateLimit').optional().isInt({ min: 1 }).withMessage('Rate limit must be positive integer'),
    body('expiresInDays').optional().isInt({ min: 1, max: 365 }).withMessage('Expiry must be 1-365 days'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw createError('VALIDATION_ERROR', 'Invalid API key parameters', { errors: errors.array() });
      }

      const { name, scopes, rateLimit, expiresInDays, metadata } = req.body;

      const keyInfo = await apiKeyService.createApiKey({
        userId: req.user.id,
        name,
        scopes,
        rateLimit,
        expiresInDays,
        metadata,
      });

      res.json({
        success: true,
        data: keyInfo,
        message: 'API key created successfully. Save the key securely - it will not be shown again.',
      });
    } catch (error) {
      logger.error('Failed to create API key', { error: error.message });
      next(createError('INTERNAL_ERROR', error.message || 'Failed to create API key'));
    }
  }
);

/**
 * Revoke API key
 * DELETE /admin/apikeys/:keyId
 */
router.delete('/apikeys/:keyId', async (req, res, next) => {
  try {
    const { keyId } = req.params;

    await apiKeyService.revokeApiKey(keyId, req.user.id);

    res.json({
      success: true,
      message: 'API key revoked successfully',
    });
  } catch (error) {
    logger.error('Failed to revoke API key', { error: error.message });
    next(createError('INTERNAL_ERROR', error.message || 'Failed to revoke API key'));
  }
});

/**
 * Get API key statistics
 * GET /admin/apikeys/stats
 */
router.get('/apikeys/stats', async (req, res, next) => {
  try {
    const stats = await apiKeyService.getApiKeyStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Failed to get API key stats', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve API key statistics'));
  }
});

// ===========================================
// Advanced Metrics Management
// ===========================================

/**
 * Get metrics in JSON format
 * GET /admin/metrics
 */
router.get('/metrics', async (req, res, next) => {
  try {
    const metrics = await advancedMetrics.exportJsonMetrics();

    res.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    logger.error('Failed to export metrics', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve metrics'));
  }
});

/**
 * Get metrics in Prometheus format
 * GET /admin/metrics/prometheus
 */
router.get('/metrics/prometheus', async (req, res, next) => {
  try {
    const metrics = await advancedMetrics.exportPrometheusMetrics();

    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (error) {
    logger.error('Failed to export Prometheus metrics', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve Prometheus metrics'));
  }
});

/**
 * Reset metrics
 * POST /admin/metrics/reset
 */
router.post('/metrics/reset', (req, res) => {
  try {
    advancedMetrics.resetMetrics();

    res.json({
      success: true,
      message: 'Metrics reset successfully',
    });
  } catch (error) {
    logger.error('Failed to reset metrics', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to reset metrics'));
  }
});

/**
 * Get server health and shutdown status
 * GET /admin/health/status
 */
router.get('/health/status', (req, res) => {
  const shutdownStatus = getShutdownStatus();
  const systemMetrics = advancedMetrics.getSystemMetrics();

  res.json({
    success: true,
    data: {
      status: shutdownStatus.shuttingDown ? 'shutting_down' : 'healthy',
      shutdown: shutdownStatus,
      uptime: systemMetrics.process_uptime_seconds,
      memory: {
        heapUsed: systemMetrics.process_heap_bytes,
        heapTotal: systemMetrics.process_heap_total_bytes,
        rss: systemMetrics.process_rss_bytes,
      },
      timestamp: new Date().toISOString(),
    },
  });
});

// ===========================================
// Circuit Breaker Management
// ===========================================

/**
 * Get circuit breaker status
 * GET /admin/circuit/status
 */
router.get('/circuit/status', (req, res) => {
  const stats = getCircuitStats();

  res.json({
    success: true,
    data: stats,
  });
});

/**
 * Reset circuit breaker
 * POST /admin/circuit/reset
 */
router.post('/circuit/reset', (req, res) => {
  try {
    resetCircuit();

    res.json({
      success: true,
      message: 'Circuit breaker reset successfully',
    });
  } catch (error) {
    logger.error('Failed to reset circuit breaker', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to reset circuit breaker'));
  }
});

// ===========================================
// Cache Management
// ===========================================

/**
 * Get cache statistics
 * GET /admin/cache/stats
 */
router.get('/cache/stats', async (req, res, next) => {
  try {
    const stats = await getCacheStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Failed to get cache stats', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve cache statistics'));
  }
});

/**
 * Invalidate cache by key or pattern
 * DELETE /admin/cache/:key
 */
router.delete('/cache/:key', async (req, res, next) => {
  try {
    const { key } = req.params;
    const count = await invalidateCache(key);

    res.json({
      success: true,
      data: {
        invalidated: count,
        key,
      },
      message: `Invalidated ${count} cache entries`,
    });
  } catch (error) {
    logger.error('Failed to invalidate cache', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to invalidate cache'));
  }
});

/**
 * Clear all cache
 * POST /admin/cache/clear
 */
router.post('/cache/clear', async (req, res, next) => {
  try {
    await clearCache();

    res.json({
      success: true,
      message: 'Cache cleared successfully',
    });
  } catch (error) {
    logger.error('Failed to clear cache', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to clear cache'));
  }
});

// ===========================================
// Rate Limit Analytics
// ===========================================

/**
 * Get analytics summary
 * GET /admin/analytics/summary
 */
router.get('/analytics/summary', async (req, res, next) => {
  try {
    const summary = await analytics.getSummary();

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    logger.error('Failed to get analytics summary', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve analytics summary'));
  }
});

/**
 * Get endpoint statistics
 * GET /admin/analytics/endpoints
 */
router.get('/analytics/endpoints', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const endpoints = await analytics.getEndpointStats(limit);

    res.json({
      success: true,
      data: endpoints,
    });
  } catch (error) {
    logger.error('Failed to get endpoint stats', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve endpoint statistics'));
  }
});

/**
 * Get IP statistics
 * GET /admin/analytics/ips
 */
router.get('/analytics/ips', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const ips = await analytics.getIpStats(limit);

    res.json({
      success: true,
      data: ips,
    });
  } catch (error) {
    logger.error('Failed to get IP stats', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve IP statistics'));
  }
});

/**
 * Get top violators
 * GET /admin/analytics/violators
 */
router.get('/analytics/violators', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const violators = await analytics.getTopViolators(limit);

    res.json({
      success: true,
      data: violators,
    });
  } catch (error) {
    logger.error('Failed to get top violators', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve violators'));
  }
});

/**
 * Get violations for specific IP
 * GET /admin/analytics/violations/:ip
 */
router.get('/analytics/violations/:ip', async (req, res, next) => {
  try {
    const { ip } = req.params;
    const limit = parseInt(req.query.limit, 10) || 50;
    const violations = await analytics.getViolations(ip, limit);

    res.json({
      success: true,
      data: violations,
      ip,
    });
  } catch (error) {
    logger.error('Failed to get violations', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve violations'));
  }
});

/**
 * Get time series data
 * GET /admin/analytics/timeseries
 */
router.get('/analytics/timeseries', async (req, res, next) => {
  try {
    const hours = parseInt(req.query.hours, 10) || 24;
    const timeSeries = await analytics.getTimeSeries(hours);

    res.json({
      success: true,
      data: timeSeries,
    });
  } catch (error) {
    logger.error('Failed to get time series', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve time series data'));
  }
});

/**
 * Generate complete analytics report
 * GET /admin/analytics/report
 */
router.get('/analytics/report', async (req, res, next) => {
  try {
    const options = {
      endpointLimit: parseInt(req.query.endpointLimit, 10) || 20,
      ipLimit: parseInt(req.query.ipLimit, 10) || 20,
      violatorLimit: parseInt(req.query.violatorLimit, 10) || 10,
      timeSeriesHours: parseInt(req.query.timeSeriesHours, 10) || 24,
    };

    const report = await analytics.generateReport(options);

    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    logger.error('Failed to generate analytics report', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to generate report'));
  }
});

/**
 * Clear analytics data
 * DELETE /admin/analytics
 */
router.delete('/analytics', async (req, res, next) => {
  try {
    const deleted = await analytics.clearAnalytics();

    res.json({
      success: true,
      data: { deleted },
      message: `Cleared ${deleted} analytics keys`,
    });
  } catch (error) {
    logger.error('Failed to clear analytics', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to clear analytics data'));
  }
});

// ===========================================
// Distributed Coordination
// ===========================================

/**
 * Get pub/sub coordination status
 * GET /admin/coordination/status
 */
router.get('/coordination/status', async (req, res, next) => {
  try {
    const status = pubSub.getStatus();

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    logger.error('Failed to get coordination status', { error: error.message });
    next(createError('INTERNAL_ERROR', 'Failed to retrieve coordination status'));
  }
});

module.exports = router;
