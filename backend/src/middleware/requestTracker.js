/**
 * Request Tracking Middleware
 * 
 * Tracks incoming requests and integrates with the metrics service
 * to collect statistics about API usage, performance, and rate limiting.
 */

const metricsService = require('../services/metricsService');
const logger = require('../utils/logger');

/**
 * Extract IP address from request
 * @param {Object} req - Express request object
 * @returns {string} Client IP address
 */
function extractIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.headers['x-real-ip'] ||
         req.socket.remoteAddress ||
         req.ip ||
         'unknown';
}

/**
 * Request tracking middleware
 * Tracks all incoming requests and records metrics
 */
function requestTracker(req, res, next) {
  const startTime = Date.now();
  const ip = extractIP(req);
  const endpoint = req.route?.path || req.path;
  
  // Store tracking data on request object
  req.tracking = {
    startTime,
    ip,
    endpoint,
    method: req.method,
  };
  
  // Track request event immediately
  metricsService.recordEvent({
    type: 'request',
    endpoint,
    ip,
    userId: req.user?.id,
  }).catch(error => {
    logger.error('Failed to record request event', { error: error.message });
  });
  
  // Hook into response finish event
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const statusCode = res.statusCode;
    
    // Determine event type based on status code
    let eventType = 'allowed';
    if (statusCode === 429) {
      eventType = 'blocked';
    } else if (statusCode >= 400) {
      eventType = 'error';
    }
    
    // Record the completion event with timing
    metricsService.recordEvent({
      type: eventType,
      endpoint,
      ip,
      userId: req.user?.id,
      ruleId: req.rateLimit?.ruleId,
      responseTime,
    }).catch(error => {
      logger.error('Failed to record completion event', { error: error.message });
    });
    
    // Log request details
    logger.info('Request completed', {
      method: req.method,
      endpoint,
      ip,
      statusCode,
      responseTime: `${responseTime}ms`,
      userId: req.user?.id,
    });
  });
  
  next();
}

/**
 * Enhanced request tracker with IP checks
 * Integrates with IP whitelist/blacklist management
 */
async function requestTrackerWithIPCheck(req, res, next) {
  const startTime = Date.now();
  const ip = extractIP(req);
  const endpoint = req.route?.path || req.path;
  
  // Store tracking data on request object
  req.tracking = {
    startTime,
    ip,
    endpoint,
    method: req.method,
  };
  
  try {
    // Check IP blacklist (if ipManagement is available)
    const ipManagement = require('../services/ipManagement');
    const blacklistEntry = await ipManagement.isIPBlacklisted(ip);
    
    if (blacklistEntry) {
      // Record blocked event
      await metricsService.recordEvent({
        type: 'blocked',
        endpoint,
        ip,
        responseTime: Date.now() - startTime,
      });
      
      logger.warn('Request from blacklisted IP', { ip, endpoint });
      
      return res.status(403).json({
        success: false,
        error: {
          code: 'IP_BLACKLISTED',
          message: 'Your IP address has been blocked',
          reason: blacklistEntry.reason,
        }
      });
    }
    
    // Check IP whitelist
    const whitelistEntry = await ipManagement.isIPWhitelisted(ip);
    if (whitelistEntry) {
      req.ipWhitelisted = true;
    }
    
    // Track request event
    await metricsService.recordEvent({
      type: 'request',
      endpoint,
      ip,
      userId: req.user?.id,
    });
    
    // Hook into response finish event
    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      const statusCode = res.statusCode;
      
      // Determine event type based on status code
      let eventType = 'allowed';
      if (statusCode === 429) {
        eventType = 'blocked';
      } else if (statusCode >= 400) {
        eventType = 'error';
      }
      
      // Record the completion event with timing
      metricsService.recordEvent({
        type: eventType,
        endpoint,
        ip,
        userId: req.user?.id,
        ruleId: req.rateLimit?.ruleId,
        responseTime,
      }).catch(error => {
        logger.error('Failed to record completion event', { error: error.message });
      });
      
      // Log request details
      logger.info('Request completed', {
        method: req.method,
        endpoint,
        ip,
        statusCode,
        responseTime: `${responseTime}ms`,
        userId: req.user?.id,
        whitelisted: req.ipWhitelisted || false,
      });
    });
    
    next();
  } catch (error) {
    logger.error('Request tracker error', { error: error.message });
    // Continue even if tracking fails
    next();
  }
}

/**
 * Request statistics aggregator
 * Provides real-time statistics about active requests
 */
class RequestStats {
  constructor() {
    this.activeRequests = new Map();
    this.requestCounts = {
      total: 0,
      active: 0,
      completed: 0,
      blocked: 0,
    };
  }
  
  /**
   * Record request start
   */
  startRequest(requestId, data) {
    this.activeRequests.set(requestId, {
      ...data,
      startTime: Date.now(),
    });
    this.requestCounts.total++;
    this.requestCounts.active++;
  }
  
  /**
   * Record request completion
   */
  endRequest(requestId, statusCode) {
    const request = this.activeRequests.get(requestId);
    if (request) {
      this.activeRequests.delete(requestId);
      this.requestCounts.active--;
      this.requestCounts.completed++;
      
      if (statusCode === 429) {
        this.requestCounts.blocked++;
      }
    }
  }
  
  /**
   * Get current statistics
   */
  getStats() {
    return {
      ...this.requestCounts,
      activeRequests: Array.from(this.activeRequests.values()).map(req => ({
        ip: req.ip,
        endpoint: req.endpoint,
        method: req.method,
        duration: Date.now() - req.startTime,
      })),
    };
  }
  
  /**
   * Reset statistics
   */
  reset() {
    this.activeRequests.clear();
    this.requestCounts = {
      total: 0,
      active: 0,
      completed: 0,
      blocked: 0,
    };
  }
}

// Global request stats instance
const requestStats = new RequestStats();

/**
 * Middleware that tracks requests in memory for real-time stats
 */
function requestStatsTracker(req, res, next) {
  const requestId = `${Date.now()}-${Math.random()}`;
  const ip = extractIP(req);
  
  requestStats.startRequest(requestId, {
    ip,
    endpoint: req.route?.path || req.path,
    method: req.method,
  });
  
  res.on('finish', () => {
    requestStats.endRequest(requestId, res.statusCode);
  });
  
  next();
}

/**
 * Get current request statistics
 */
function getRequestStats() {
  return requestStats.getStats();
}

/**
 * Reset request statistics
 */
function resetRequestStats() {
  requestStats.reset();
}

module.exports = {
  requestTracker,
  requestTrackerWithIPCheck,
  requestStatsTracker,
  getRequestStats,
  resetRequestStats,
  extractIP,
};
