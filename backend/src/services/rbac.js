/**
 * Role-Based Access Control (RBAC) Service
 * 
 * Defines roles, permissions, and access control logic
 */

const logger = require('../utils/logger');

// Define roles and their permissions
const ROLES = {
  admin: {
    name: 'admin',
    description: 'Full system access',
    permissions: [
      // User management
      'users.create',
      'users.read',
      'users.update',
      'users.delete',
      'users.list',
      
      // Rate limit rules
      'rules.create',
      'rules.read',
      'rules.update',
      'rules.delete',
      'rules.list',
      'rules.apply',
      
      // API keys
      'apikeys.create',
      'apikeys.read',
      'apikeys.update',
      'apikeys.delete',
      'apikeys.list',
      
      // System
      'system.health',
      'system.metrics',
      'system.logs',
      'system.config',
    ],
  },
  
  viewer: {
    name: 'viewer',
    description: 'Read-only access',
    permissions: [
      // Read-only permissions
      'rules.read',
      'rules.list',
      'apikeys.read',
      'apikeys.list',
      'system.health',
      'system.metrics',
    ],
  },
};

/**
 * Get role definition
 * 
 * @param {string} roleName - Role name
 * @returns {Object|null} Role definition
 */
const getRole = (roleName) => {
  return ROLES[roleName] || null;
};

/**
 * Get all roles
 * 
 * @returns {Array} Array of role definitions
 */
const getAllRoles = () => {
  return Object.values(ROLES);
};

/**
 * Check if role exists
 * 
 * @param {string} roleName - Role name
 * @returns {boolean} Whether role exists
 */
const roleExists = (roleName) => {
  return roleName in ROLES;
};

/**
 * Check if user has permission
 * 
 * @param {Object} user - User object
 * @param {string} user.role - User role
 * @param {string} permission - Permission to check
 * @returns {boolean} Whether user has permission
 */
const hasPermission = (user, permission) => {
  if (!user || !user.role) {
    logger.warn('Invalid user object for permission check', { user });
    return false;
  }

  const role = getRole(user.role);
  if (!role) {
    logger.warn('Unknown role for permission check', { role: user.role, userId: user.id });
    return false;
  }

  return role.permissions.includes(permission);
};

/**
 * Check if user has any of the permissions
 * 
 * @param {Object} user - User object
 * @param {Array<string>} permissions - Array of permissions
 * @returns {boolean} Whether user has any permission
 */
const hasAnyPermission = (user, permissions) => {
  return permissions.some(permission => hasPermission(user, permission));
};

/**
 * Check if user has all permissions
 * 
 * @param {Object} user - User object
 * @param {Array<string>} permissions - Array of permissions
 * @returns {boolean} Whether user has all permissions
 */
const hasAllPermissions = (user, permissions) => {
  return permissions.every(permission => hasPermission(user, permission));
};

/**
 * Get user permissions
 * 
 * @param {Object} user - User object
 * @returns {Array<string>} Array of permissions
 */
const getUserPermissions = (user) => {
  if (!user || !user.role) {
    return [];
  }

  const role = getRole(user.role);
  return role ? role.permissions : [];
};

/**
 * Check if user has role
 * 
 * @param {Object} user - User object
 * @param {string} roleName - Role name
 * @returns {boolean} Whether user has role
 */
const hasRole = (user, roleName) => {
  return user && user.role === roleName;
};

/**
 * Check if user has any of the roles
 * 
 * @param {Object} user - User object
 * @param {Array<string>} roleNames - Array of role names
 * @returns {boolean} Whether user has any role
 */
const hasAnyRole = (user, roleNames) => {
  return user && roleNames.includes(user.role);
};

/**
 * Check if user is admin
 * 
 * @param {Object} user - User object
 * @returns {boolean} Whether user is admin
 */
const isAdmin = (user) => {
  return hasRole(user, 'admin');
};

/**
 * Check if user is viewer
 * 
 * @param {Object} user - User object
 * @returns {boolean} Whether user is viewer
 */
const isViewer = (user) => {
  return hasRole(user, 'viewer');
};

module.exports = {
  ROLES,
  getRole,
  getAllRoles,
  roleExists,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getUserPermissions,
  hasRole,
  hasAnyRole,
  isAdmin,
  isViewer,
};
