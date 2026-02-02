/**
 * Rule Validator
 * 
 * Validates rate limit rule schema and constraints
 * Uses express-validator for validation
 */

const { body, validationResult } = require('express-validator');

/**
 * Validation rules for creating/updating rate limit rules
 */
const ruleValidationRules = () => {
  return [
    // Name validation
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Rule name is required')
      .isLength({ min: 3, max: 100 })
      .withMessage('Rule name must be 3-100 characters')
      .matches(/^[a-zA-Z0-9-_]+$/)
      .withMessage('Rule name can only contain letters, numbers, hyphens, and underscores'),

    // Description validation (optional)
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),

    // Target validation
    body('target')
      .notEmpty()
      .withMessage('Target configuration is required')
      .isObject()
      .withMessage('Target must be an object'),

    body('target.type')
      .notEmpty()
      .withMessage('Target type is required')
      .isIn(['endpoint', 'ip', 'user', 'apikey'])
      .withMessage('Target type must be one of: endpoint, ip, user, apikey'),

    body('target.pattern')
      .notEmpty()
      .withMessage('Target pattern is required')
      .isString()
      .withMessage('Target pattern must be a string')
      .isLength({ min: 1, max: 200 })
      .withMessage('Target pattern must be 1-200 characters'),

    // Limit validation
    body('limit')
      .notEmpty()
      .withMessage('Limit configuration is required')
      .isObject()
      .withMessage('Limit must be an object'),

    body('limit.requests')
      .notEmpty()
      .withMessage('Request limit is required')
      .isInt({ min: 1, max: 1000000 })
      .withMessage('Request limit must be between 1 and 1,000,000'),

    body('limit.window')
      .notEmpty()
      .withMessage('Time window is required')
      .isString()
      .withMessage('Time window must be a string')
      .matches(/^(\d+)(s|m|h|d)$/)
      .withMessage('Time window must be in format: <number><unit> (e.g., 1m, 1h, 1d)')
      .custom((value) => {
        const match = value.match(/^(\d+)(s|m|h|d)$/);
        if (!match) return false;

        const num = parseInt(match[1]);
        const unit = match[2];

        // Convert to seconds for validation
        const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
        const seconds = num * multipliers[unit];

        // Window must be between 1 second and 1 day
        if (seconds < 1 || seconds > 86400) {
          throw new Error('Time window must be between 1 second and 1 day');
        }

        return true;
      }),

    // Action validation
    body('action')
      .optional()
      .isIn(['reject', 'throttle', 'log'])
      .withMessage('Action must be one of: reject, throttle, log'),

    // Priority validation
    body('priority')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Priority must be between 1 and 1000'),

    // Enabled validation
    body('enabled')
      .optional()
      .isBoolean()
      .withMessage('Enabled must be a boolean'),
  ];
};

/**
 * Validation rules for updating rules (partial updates allowed)
 */
const ruleUpdateValidationRules = () => {
  return [
    // Description (optional)
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),

    // Target (optional, but if provided must be complete)
    body('target')
      .optional()
      .isObject()
      .withMessage('Target must be an object'),

    body('target.type')
      .optional()
      .isIn(['endpoint', 'ip', 'user', 'apikey'])
      .withMessage('Target type must be one of: endpoint, ip, user, apikey'),

    body('target.pattern')
      .optional()
      .isString()
      .withMessage('Target pattern must be a string')
      .isLength({ min: 1, max: 200 })
      .withMessage('Target pattern must be 1-200 characters'),

    // Limit (optional, but if provided must be complete)
    body('limit')
      .optional()
      .isObject()
      .withMessage('Limit must be an object'),

    body('limit.requests')
      .optional()
      .isInt({ min: 1, max: 1000000 })
      .withMessage('Request limit must be between 1 and 1,000,000'),

    body('limit.window')
      .optional()
      .isString()
      .withMessage('Time window must be a string')
      .matches(/^(\d+)(s|m|h|d)$/)
      .withMessage('Time window must be in format: <number><unit>')
      .custom((value) => {
        const match = value.match(/^(\d+)(s|m|h|d)$/);
        if (!match) return false;
        const num = parseInt(match[1]);
        const unit = match[2];
        const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
        const seconds = num * multipliers[unit];
        if (seconds < 1 || seconds > 86400) {
          throw new Error('Time window must be between 1 second and 1 day');
        }
        return true;
      }),

    // Action
    body('action')
      .optional()
      .isIn(['reject', 'throttle', 'log'])
      .withMessage('Action must be one of: reject, throttle, log'),

    // Priority
    body('priority')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Priority must be between 1 and 1000'),

    // Enabled
    body('enabled')
      .optional()
      .isBoolean()
      .withMessage('Enabled must be a boolean'),
  ];
};

/**
 * Middleware to check validation results
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input data',
        details: errors.array().map(err => ({
          field: err.path,
          message: err.msg,
          value: err.value,
        })),
      },
    });
  }

  next();
};

/**
 * Custom validation: Check for pattern conflicts
 * This is applied in the route handler, not as middleware
 * 
 * @param {Object} ruleData - Rule data to validate
 * @param {Array} existingRules - Existing rules to check against
 * @returns {Array} Array of conflict warnings
 */
const checkPatternConflicts = (ruleData, existingRules) => {
  const conflicts = [];

  for (const rule of existingRules) {
    if (rule.target.type === ruleData.target.type) {
      const newPattern = ruleData.target.pattern;
      const existingPattern = rule.target.pattern;

      // Check for exact match
      if (newPattern === existingPattern) {
        conflicts.push({
          ruleId: rule.id,
          ruleName: rule.name,
          type: 'exact_match',
          message: `Pattern '${newPattern}' exactly matches existing rule`,
        });
      }

      // Check for wildcard overlaps (basic check)
      if (newPattern.includes('*') || existingPattern.includes('*')) {
        const newRegex = new RegExp('^' + newPattern.replace(/\*/g, '.*') + '$');
        const existingRegex = new RegExp('^' + existingPattern.replace(/\*/g, '.*') + '$');

        if (newRegex.test(existingPattern) || existingRegex.test(newPattern)) {
          conflicts.push({
            ruleId: rule.id,
            ruleName: rule.name,
            type: 'wildcard_overlap',
            message: `Pattern '${newPattern}' overlaps with existing pattern '${existingPattern}'`,
          });
        }
      }
    }
  }

  return conflicts;
};

module.exports = {
  ruleValidationRules,
  ruleUpdateValidationRules,
  validate,
  checkPatternConflicts,
};
