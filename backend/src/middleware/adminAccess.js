/**
 * Admin Access Control Middleware
 * 
 * Restricts admin endpoints to specific IP addresses or CIDR ranges
 * Provides an additional security layer for administrative operations
 */

const logger = require('../utils/logger');
const { createError } = require('./errorHandler');

/**
 * Parse CIDR notation (e.g., "192.168.1.0/24")
 * @param {string} cidr - CIDR notation string
 * @returns {Object} Object with network address and mask
 */
const parseCIDR = (cidr) => {
  const parts = cidr.split('/');
  if (parts.length !== 2) {
    return null;
  }

  const ip = parts[0];
  const bits = parseInt(parts[1], 10);

  if (isNaN(bits) || bits < 0 || bits > 32) {
    return null;
  }

  // Convert IP to 32-bit integer
  const ipParts = ip.split('.').map(Number);
  if (ipParts.length !== 4 || ipParts.some(p => p < 0 || p > 255)) {
    return null;
  }

  const ipInt = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
  const mask = bits === 0 ? 0 : ~((1 << (32 - bits)) - 1);

  return { ipInt, mask };
};

/**
 * Convert IP address string to 32-bit integer
 * @param {string} ip - IP address
 * @returns {number|null} IP as integer or null if invalid
 */
const ipToInt = (ip) => {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
};

/**
 * Check if IP matches a CIDR range
 * @param {string} ip - IP address to check
 * @param {string} cidr - CIDR notation (e.g., "192.168.1.0/24")
 * @returns {boolean} True if IP is in range
 */
const ipMatchesCIDR = (ip, cidr) => {
  const ipInt = ipToInt(ip);
  if (ipInt === null) {
    return false;
  }

  const cidrParsed = parseCIDR(cidr);
  if (!cidrParsed) {
    return false;
  }

  const { ipInt: networkInt, mask } = cidrParsed;
  return (ipInt & mask) === (networkInt & mask);
};

/**
 * Check if IP is in the allowlist
 * @param {string} clientIP - Client IP address
 * @param {Array<string>} allowlist - Array of allowed IPs or CIDR ranges
 * @returns {boolean} True if IP is allowed
 */
const isIPAllowed = (clientIP, allowlist) => {
  if (!clientIP || clientIP === 'unknown') {
    return false;
  }

  if (!allowlist || allowlist.length === 0) {
    // If no allowlist configured, allow all (permissive mode)
    return true;
  }

  for (const allowedEntry of allowlist) {
    const entry = allowedEntry.trim();

    // Exact IP match
    if (entry === clientIP) {
      return true;
    }

    // CIDR range match
    if (entry.includes('/')) {
      if (ipMatchesCIDR(clientIP, entry)) {
        return true;
      }
    }

    // Wildcard match (e.g., "192.168.1.*")
    if (entry.includes('*')) {
      const pattern = '^' + entry.replace(/\./g, '\\.').replace(/\*/g, '\\d{1,3}') + '$';
      const regex = new RegExp(pattern);
      if (regex.test(clientIP)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Extract client IP from request
 * Handles X-Forwarded-For and other proxy headers
 * @param {Object} req - Express request object
 * @returns {string} Client IP address
 */
const extractClientIP = (req) => {
  // Priority 1: X-Forwarded-For (if behind proxy)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    if (ips.length > 0 && ips[0]) {
      return ips[0];
    }
  }

  // Priority 2: X-Real-IP header (nginx)
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return realIP;
  }

  // Priority 3: CF-Connecting-IP (Cloudflare)
  const cfIP = req.headers['cf-connecting-ip'];
  if (cfIP) {
    return cfIP;
  }

  // Priority 4: req.ip (Express)
  if (req.ip) {
    return req.ip.replace(/^::ffff:/, '');
  }

  // Priority 5: Socket remote address
  const socketIP = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (socketIP) {
    return socketIP.replace(/^::ffff:/, '');
  }

  return 'unknown';
};

/**
 * Parse allowlist from environment variable
 * Supports comma-separated list of IPs and CIDR ranges
 * @returns {Array<string>} Array of allowed IPs/ranges
 */
const getAdminIPAllowlist = () => {
  const allowlistEnv = process.env.ADMIN_IP_ALLOWLIST;

  if (!allowlistEnv || allowlistEnv.trim() === '') {
    return []; // Empty array means no restrictions (all IPs allowed)
  }

  // Parse comma-separated list
  const allowlist = allowlistEnv
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);

  return allowlist;
};

/**
 * Admin IP Access Control Middleware
 * Restricts access to admin routes based on IP allowlist
 * 
 * Configuration via environment variable:
 * ADMIN_IP_ALLOWLIST=192.168.1.100,10.0.0.0/8,172.16.0.0/12
 * 
 * If ADMIN_IP_ALLOWLIST is not set or empty, all IPs are allowed (permissive mode)
 * 
 * @returns {Function} Express middleware function
 */
const adminIPAccessControl = () => {
  const allowlist = getAdminIPAllowlist();

  // Log configuration on startup
  if (allowlist.length > 0) {
    logger.info('Admin IP allowlist enabled', {
      entries: allowlist.length,
      allowlist: allowlist.map(entry => {
        // Mask IPs in logs for privacy
        if (entry.includes('/')) {
          return entry; // CIDR ranges are OK to log
        }
        const parts = entry.split('.');
        if (parts.length === 4) {
          return `${parts[0]}.${parts[1]}.xxx.xxx`;
        }
        return 'xxx.xxx.xxx.xxx';
      }),
    });
  } else {
    logger.warn('Admin IP allowlist not configured - all IPs allowed', {
      env: 'ADMIN_IP_ALLOWLIST',
      recommendation: 'Set ADMIN_IP_ALLOWLIST to restrict admin access',
    });
  }

  return (req, res, next) => {
    const clientIP = extractClientIP(req);

    // Check if IP is allowed
    if (isIPAllowed(clientIP, allowlist)) {
      logger.debug('Admin access allowed', {
        ip: clientIP,
        path: req.path,
        method: req.method,
      });
      return next();
    }

    // Access denied
    logger.warn('Admin access denied - IP not in allowlist', {
      ip: clientIP,
      path: req.path,
      method: req.method,
      userAgent: req.get('user-agent'),
    });

    // Track security event (if security monitor is available)
    try {
      const securityMonitor = require('../services/securityMonitor');
      securityMonitor.trackSecurityEvent(
        securityMonitor.SECURITY_EVENTS.UNAUTHORIZED_ACCESS,
        {
          ip: clientIP,
          path: req.path,
          method: req.method,
          reason: 'ip_not_in_allowlist',
        }
      );
    } catch (err) {
      // Security monitor might not be available, ignore
    }

    return next(createError('FORBIDDEN', 'Access denied. Your IP address is not authorized to access this resource.'));
  };
};

/**
 * Log admin IP allowlist configuration
 * Useful for startup logging and diagnostics
 */
const logAdminIPAllowlistConfig = () => {
  const allowlist = getAdminIPAllowlist();

  if (allowlist.length === 0) {
    logger.info('Admin IP Access Control: DISABLED (all IPs allowed)');
  } else {
    logger.info('Admin IP Access Control: ENABLED', {
      mode: 'allowlist',
      entries: allowlist.length,
      allowlist: allowlist.map(entry => {
        if (entry.includes('/')) {
          return entry;
        }
        const parts = entry.split('.');
        if (parts.length === 4) {
          return `${parts[0]}.${parts[1]}.xxx.xxx`;
        }
        return entry;
      }),
    });
  }
};

module.exports = {
  adminIPAccessControl,
  logAdminIPAllowlistConfig,
  isIPAllowed,
  ipMatchesCIDR,
  extractClientIP,
  getAdminIPAllowlist,
};
