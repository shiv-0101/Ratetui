/**
 * Rate Limit Bypass Prevention
 * 
 * Protects against common rate limit bypass techniques:
 * - Header spoofing (X-Forwarded-For manipulation)
 * - User agent rotation
 * - Multiple identifier abuse
 * - Distributed attacks from similar patterns
 * 
 * Based on TRD security requirements for rate limiting.
 */

const logger = require('../utils/logger');
const { getRedisClient } = require('../config/redis');

/**
 * Configuration
 */
const BYPASS_PREVENTION_CONFIG = {
  // Track suspicious patterns
  PATTERN_TRACKING_WINDOW: 3600, // 1 hour
  
  // Thresholds for suspicious behavior
  MAX_USER_AGENTS_PER_IP: parseInt(process.env.MAX_USER_AGENTS_PER_IP, 10) || 20,
  MAX_IPS_PER_USER: parseInt(process.env.MAX_IPS_PER_USER, 10) || 10,
  MAX_FORWARDED_IPS: parseInt(process.env.MAX_FORWARDED_IPS, 10) || 5,
  
  // Distributed attack detection
  DISTRIBUTED_ATTACK_THRESHOLD: parseInt(process.env.DISTRIBUTED_ATTACK_THRESHOLD, 10) || 50,
  DISTRIBUTED_ATTACK_WINDOW: 300, // 5 minutes
};

/**
 * Validate IP address format
 * @param {string} ip - IP address to validate
 * @returns {boolean}
 */
const isValidIP = (ip) => {
  if (!ip || typeof ip !== 'string') return false;
  
  // IPv4
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(ip)) {
    const parts = ip.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }
  
  // IPv6 (basic validation)
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv6Regex.test(ip);
};

/**
 * Extract and validate client IP with spoofing prevention
 * @param {Object} req - Express request
 * @returns {Object} IP information
 */
const extractSecureClientIP = (req) => {
  const result = {
    ip: null,
    forwarded: [],
    suspicious: false,
    reason: null,
  };
  
  // Get direct connection IP (most reliable)
  const directIP = req.socket?.remoteAddress || req.ip;
  result.ip = directIP;
  
  // Check for X-Forwarded-For header
  const forwardedHeader = req.get('x-forwarded-for');
  
  if (forwardedHeader) {
    // Parse forwarded IPs
    const forwardedIPs = forwardedHeader
      .split(',')
      .map(ip => ip.trim())
      .filter(ip => ip && isValidIP(ip));
    
    result.forwarded = forwardedIPs;
    
    // Suspicious if too many forwarded IPs (potential spoofing)
    if (forwardedIPs.length > BYPASS_PREVENTION_CONFIG.MAX_FORWARDED_IPS) {
      result.suspicious = true;
      result.reason = `Too many forwarded IPs: ${forwardedIPs.length}`;
      logger.security('Suspicious X-Forwarded-For header', {
        directIP,
        forwardedHeader,
        count: forwardedIPs.length,
      });
    }
    
    // If behind trusted proxy, use first forwarded IP
    if (req.app.get('trust proxy') && forwardedIPs.length > 0) {
      result.ip = forwardedIPs[0];
    }
  }
  
  // Validate final IP
  if (!isValidIP(result.ip)) {
    result.suspicious = true;
    result.reason = 'Invalid IP format';
    result.ip = directIP; // Fallback to direct IP
  }
  
  return result;
};

/**
 * Detect user agent rotation attacks
 * @param {string} ip - Client IP
 * @param {string} userAgent - User agent string
 * @returns {Promise<Object>} Detection result
 */
const detectUserAgentRotation = async (ip, userAgent) => {
  const redis = getRedisClient();
  if (!redis) return { suspicious: false };
  
  const key = `bypass:ua:${ip}`;
  
  try {
    // Add user agent to set with expiry
    await redis.sadd(key, userAgent);
    await redis.expire(key, BYPASS_PREVENTION_CONFIG.PATTERN_TRACKING_WINDOW);
    
    // Count unique user agents
    const uaCount = await redis.scard(key);
    
    if (uaCount > BYPASS_PREVENTION_CONFIG.MAX_USER_AGENTS_PER_IP) {
      logger.security('User agent rotation detected', {
        ip,
        uniqueUserAgents: uaCount,
        threshold: BYPASS_PREVENTION_CONFIG.MAX_USER_AGENTS_PER_IP,
      });
      
      return {
        suspicious: true,
        reason: 'user_agent_rotation',
        count: uaCount,
      };
    }
    
    return { suspicious: false, count: uaCount };
  } catch (error) {
    logger.error('Error detecting UA rotation:', { error: error.message });
    return { suspicious: false, error: error.message };
  }
};

/**
 * Detect multiple IPs for same user
 * @param {string} userId - User identifier
 * @param {string} ip - Client IP
 * @returns {Promise<Object>} Detection result
 */
const detectIPRotation = async (userId, ip) => {
  if (!userId) return { suspicious: false };
  
  const redis = getRedisClient();
  if (!redis) return { suspicious: false };
  
  const key = `bypass:ip:user:${userId}`;
  
  try {
    // Add IP to user's IP set
    await redis.sadd(key, ip);
    await redis.expire(key, BYPASS_PREVENTION_CONFIG.PATTERN_TRACKING_WINDOW);
    
    // Count unique IPs
    const ipCount = await redis.scard(key);
    
    if (ipCount > BYPASS_PREVENTION_CONFIG.MAX_IPS_PER_USER) {
      logger.security('IP rotation detected for user', {
        userId,
        currentIP: ip,
        uniqueIPs: ipCount,
        threshold: BYPASS_PREVENTION_CONFIG.MAX_IPS_PER_USER,
      });
      
      return {
        suspicious: true,
        reason: 'ip_rotation',
        count: ipCount,
      };
    }
    
    return { suspicious: false, count: ipCount };
  } catch (error) {
    logger.error('Error detecting IP rotation:', { error: error.message });
    return { suspicious: false, error: error.message };
  }
};

/**
 * Detect distributed attacks from similar patterns
 * Tracks requests per endpoint and detects coordinated attacks
 * @param {string} endpoint - Endpoint being accessed
 * @param {string} ip - Client IP
 * @returns {Promise<Object>} Detection result
 */
const detectDistributedAttack = async (endpoint, ip) => {
  const redis = getRedisClient();
  if (!redis) return { suspicious: false };
  
  const key = `bypass:distributed:${endpoint}`;
  const timestamp = Date.now();
  
  try {
    // Add IP with timestamp to sorted set
    await redis.zadd(key, timestamp, `${ip}:${timestamp}`);
    await redis.expire(key, BYPASS_PREVENTION_CONFIG.DISTRIBUTED_ATTACK_WINDOW);
    
    // Remove old entries
    const cutoff = timestamp - (BYPASS_PREVENTION_CONFIG.DISTRIBUTED_ATTACK_WINDOW * 1000);
    await redis.zremrangebyscore(key, '-inf', cutoff);
    
    // Count unique IPs in window
    const entries = await redis.zrange(key, 0, -1);
    const uniqueIPs = new Set(entries.map(e => e.split(':')[0]));
    
    if (uniqueIPs.size > BYPASS_PREVENTION_CONFIG.DISTRIBUTED_ATTACK_THRESHOLD) {
      logger.security('Distributed attack pattern detected', {
        endpoint,
        uniqueIPs: uniqueIPs.size,
        totalRequests: entries.length,
        threshold: BYPASS_PREVENTION_CONFIG.DISTRIBUTED_ATTACK_THRESHOLD,
        window: `${BYPASS_PREVENTION_CONFIG.DISTRIBUTED_ATTACK_WINDOW}s`,
      });
      
      return {
        suspicious: true,
        reason: 'distributed_attack',
        uniqueIPs: uniqueIPs.size,
        totalRequests: entries.length,
      };
    }
    
    return {
      suspicious: false,
      uniqueIPs: uniqueIPs.size,
      totalRequests: entries.length,
    };
  } catch (error) {
    logger.error('Error detecting distributed attack:', { error: error.message });
    return { suspicious: false, error: error.message };
  }
};

/**
 * Validate rate limit key integrity
 * Prevents bypass attempts through malformed keys
 * @param {string} key - Rate limit key
 * @returns {boolean}
 */
const validateRateLimitKey = (key) => {
  if (!key || typeof key !== 'string') return false;
  
  // Check for suspicious patterns
  const suspiciousPatterns = [
    /\.\./,           // Path traversal
    /[<>'"]/,         // Injection attempts
    /[\x00-\x1F]/,    // Control characters
    /\s{10,}/,        // Excessive whitespace
  ];
  
  if (suspiciousPatterns.some(pattern => pattern.test(key))) {
    logger.security('Suspicious rate limit key detected', { key });
    return false;
  }
  
  // Check length
  if (key.length > 500) {
    logger.security('Rate limit key too long', { length: key.length });
    return false;
  }
  
  return true;
};

/**
 * Comprehensive bypass prevention middleware
 */
const bypassPreventionMiddleware = async (req, res, next) => {
  try {
    // Extract and validate IP
    const ipInfo = extractSecureClientIP(req);
    if (ipInfo.suspicious) {
      logger.security('Suspicious IP detected', {
        ip: ipInfo.ip,
        reason: ipInfo.reason,
        forwarded: ipInfo.forwarded,
      });
      
      // Still allow but mark for additional scrutiny
      req.suspiciousIP = true;
    }
    
    req.secureIP = ipInfo.ip;
    
    // Detect user agent rotation
    const userAgent = req.get('user-agent') || 'unknown';
    const uaCheck = await detectUserAgentRotation(ipInfo.ip, userAgent);
    if (uaCheck.suspicious) {
      req.suspiciousUA = true;
      req.suspiciousReason = uaCheck.reason;
    }
    
    // Detect IP rotation for authenticated users
    if (req.user && req.user.id) {
      const ipRotation = await detectIPRotation(req.user.id, ipInfo.ip);
      if (ipRotation.suspicious) {
        req.suspiciousIPRotation = true;
        req.suspiciousReason = ipRotation.reason;
      }
    }
    
    // Detect distributed attacks
    const distributedCheck = await detectDistributedAttack(req.path, ipInfo.ip);
    if (distributedCheck.suspicious) {
      req.distributedAttack = true;
      req.suspiciousReason = distributedCheck.reason;
      
      // Log detailed info for investigation
      logger.security('Request part of potential distributed attack', {
        endpoint: req.path,
        ip: ipInfo.ip,
        uniqueIPs: distributedCheck.uniqueIPs,
        totalRequests: distributedCheck.totalRequests,
      });
    }
    
    // If multiple suspicious signals, apply stricter rate limiting
    const suspiciousCount = [
      req.suspiciousIP,
      req.suspiciousUA,
      req.suspiciousIPRotation,
      req.distributedAttack,
    ].filter(Boolean).length;
    
    if (suspiciousCount >= 2) {
      logger.security('Multiple suspicious signals detected', {
        ip: ipInfo.ip,
        path: req.path,
        suspiciousCount,
        signals: {
          ip: req.suspiciousIP,
          userAgent: req.suspiciousUA,
          ipRotation: req.suspiciousIPRotation,
          distributed: req.distributedAttack,
        },
      });
      
      req.highRisk = true;
      
      // Could apply additional rate limiting here
      // For now, just flag for stricter limits
    }
    
    next();
  } catch (error) {
    logger.error('Bypass prevention middleware error:', { error: error.message });
    // Don't block on errors, but log them
    next();
  }
};

/**
 * Log bypass prevention configuration
 */
const logBypassPreventionConfig = () => {
  logger.info('Rate Limit Bypass Prevention: Configuration loaded');
  logger.info(`Max user agents per IP: ${BYPASS_PREVENTION_CONFIG.MAX_USER_AGENTS_PER_IP}`);
  logger.info(`Max IPs per user: ${BYPASS_PREVENTION_CONFIG.MAX_IPS_PER_USER}`);
  logger.info(`Max forwarded IPs: ${BYPASS_PREVENTION_CONFIG.MAX_FORWARDED_IPS}`);
  logger.info(`Distributed attack threshold: ${BYPASS_PREVENTION_CONFIG.DISTRIBUTED_ATTACK_THRESHOLD} IPs`);
  logger.info(`Tracking window: ${BYPASS_PREVENTION_CONFIG.PATTERN_TRACKING_WINDOW}s`);
};

module.exports = {
  bypassPreventionMiddleware,
  extractSecureClientIP,
  detectUserAgentRotation,
  detectIPRotation,
  detectDistributedAttack,
  validateRateLimitKey,
  logBypassPreventionConfig,
  isValidIP,
  BYPASS_PREVENTION_CONFIG,
};
