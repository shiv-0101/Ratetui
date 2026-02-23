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
const { getRequestStats, resetRequestStats } = require('../middleware/requestTracker');
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

module.exports = router;
