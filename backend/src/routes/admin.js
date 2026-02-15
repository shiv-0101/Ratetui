/**
 * Admin Routes
 * 
 * Administrative endpoints for managing rate limit rules.
 * All routes require authentication (will be enforced in Week 2).
 */

const express = require('express');
const { rateLimiters } = require('../middleware/rateLimiter');
const { ruleValidationRules, validate } = require('../validators/ruleValidator');
const ruleService = require('../services/ruleService');
const { createError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// Apply admin rate limiting
router.use(rateLimiters.admin);

/**
 * Mock authentication middleware (will be replaced with real auth in Week 2)
 * For now, inject a mock admin user for testing
 */
const mockAuth = (req, res, next) => {
  req.user = {
    id: 'admin-001',
    email: 'admin@example.com',
    role: 'admin',
  };
  next();
};

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
router.get('/rules', mockAuth, async (req, res, next) => {
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
router.get('/rules/:id', mockAuth, async (req, res, next) => {
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
router.post('/rules', mockAuth, ruleValidationRules(), validate, async (req, res, next) => {
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
router.put('/rules/:id', mockAuth, ruleValidationRules(), validate, async (req, res, next) => {
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
router.delete('/rules/:id', mockAuth, async (req, res, next) => {
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
router.post('/rules/:id/enable', mockAuth, async (req, res, next) => {
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
router.post('/rules/:id/disable', mockAuth, async (req, res, next) => {
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
router.get('/audit', mockAuth, async (req, res, next) => {
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
router.get('/rules/:id/audit', mockAuth, async (req, res, next) => {
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
 * Get blocked IPs (placeholder for Week 2)
 * GET /admin/ip/blocked
 */
router.get('/ip/blocked', mockAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      blocked: [],
      message: 'IP management coming in Week 2',
    }
  });
});

/**
 * Get metrics (placeholder for Week 3)
 * GET /admin/metrics
 */
router.get('/metrics', mockAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      totalRequests: 0,
      blockedRequests: 0,
      activeRules: 0,
      message: 'Metrics coming in Week 3',
    }
  });
});

module.exports = router;
