/**
 * Authorization Middleware
 * 
 * Checks user permissions based on RBAC system
 * Use after authenticate() middleware
 */

const { hasPermission, hasAnyPermission, hasRole, isAdmin } = require('../services/rbac');
const { createError } = require('./errorHandler');
const logger = require('../utils/logger');

/**
 * Require specific permission
 * 
 * @param {string} permission - Required permission
 * @returns {Function} Express middleware
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(createError('UNAUTHORIZED', 'Authentication required'));
    }

    if (!hasPermission(req.user, permission)) {
      logger.warn('Authorization failed - missing permission', {
        userId: req.user.id,
        role: req.user.role,
        requiredPermission: permission,
        ip: req.ip,
      });

      return next(createError('FORBIDDEN', `Insufficient permissions. Required: ${permission}`));
    }

    next();
  };
};

/**
 * Require any of the specified permissions
 * 
 * @param {Array<string>} permissions - Array of permissions (OR logic)
 * @returns {Function} Express middleware
 */
const requireAnyPermission = (permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(createError('UNAUTHORIZED', 'Authentication required'));
    }

    if (!hasAnyPermission(req.user, permissions)) {
      logger.warn('Authorization failed - missing any permission', {
        userId: req.user.id,
        role: req.user.role,
        requiredPermissions: permissions,
        ip: req.ip,
      });

      return next(createError('FORBIDDEN', `Insufficient permissions. Required any of: ${permissions.join(', ')}`));
    }

    next();
  };
};

/**
 * Require specific role
 * 
 * @param {string} roleName - Required role
 * @returns {Function} Express middleware
 */
const requireRole = (roleName) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(createError('UNAUTHORIZED', 'Authentication required'));
    }

    if (!hasRole(req.user, roleName)) {
      logger.warn('Authorization failed - incorrect role', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRole: roleName,
        ip: req.ip,
      });

      return next(createError('FORBIDDEN', `Access denied. Required role: ${roleName}`));
    }

    next();
  };
};

/**
 * Require admin role
 * Shortcut for requireRole('admin')
 * 
 * @returns {Function} Express middleware
 */
const requireAdmin = () => {
  return (req, res, next) => {
    if (!req.user) {
      return next(createError('UNAUTHORIZED', 'Authentication required'));
    }

    if (!isAdmin(req.user)) {
      logger.warn('Authorization failed - admin required', {
        userId: req.user.id,
        role: req.user.role,
        ip: req.ip,
      });

      return next(createError('FORBIDDEN', 'Admin access required'));
    }

    next();
  };
};

/**
 * Check if user owns the resource
 * Compares req.user.id with req.params.userId or req.params.id
 * 
 * @param {string} paramName - Name of parameter containing user ID (default: 'userId')
 * @returns {Function} Express middleware
 */
const requireOwnership = (paramName = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return next(createError('UNAUTHORIZED', 'Authentication required'));
    }

    const resourceUserId = req.params[paramName];
    
    if (!resourceUserId) {
      return next(createError('BAD_REQUEST', `Missing ${paramName} parameter`));
    }

    // Admins can access any resource
    if (isAdmin(req.user)) {
      return next();
    }

    // Check ownership
    if (req.user.id !== resourceUserId) {
      logger.warn('Authorization failed - not resource owner', {
        userId: req.user.id,
        resourceUserId,
        ip: req.ip,
      });

      return next(createError('FORBIDDEN', 'You can only access your own resources'));
    }

    next();
  };
};

/**
 * Allow access if user is admin OR owns the resource
 * 
 * @param {string} paramName - Name of parameter containing user ID
 * @returns {Function} Express middleware
 */
const requireAdminOrOwner = (paramName = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return next(createError('UNAUTHORIZED', 'Authentication required'));
    }

    const resourceUserId = req.params[paramName];

    // Admin can access
    if (isAdmin(req.user)) {
      return next();
    }

    // Owner can access
    if (resourceUserId && req.user.id === resourceUserId) {
      return next();
    }

    logger.warn('Authorization failed - not admin or owner', {
      userId: req.user.id,
      resourceUserId,
      role: req.user.role,
      ip: req.ip,
    });

    return next(createError('FORBIDDEN', 'Admin or owner access required'));
  };
};

module.exports = {
  requirePermission,
  requireAnyPermission,
  requireRole,
  requireAdmin,
  requireOwnership,
  requireAdminOrOwner,
};
