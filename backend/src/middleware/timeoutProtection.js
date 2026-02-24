/**
 * Advanced Timeout Protection Middleware
 * 
 * Protects against slow loris attacks, connection hanging, and DoS via slow requests.
 * Based on TRD security requirements for timeout handling.
 */

const logger = require('../utils/logger');

/**
 * Configuration for timeout protection
 */
const TIMEOUT_CONFIG = {
  // Overall request timeout (max time for entire request lifecycle)
  REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT, 10) || 30000, // 30s
  
  // Header timeout (time to receive complete headers)
  HEADER_TIMEOUT: parseInt(process.env.HEADER_TIMEOUT, 10) || 10000, // 10s
  
  // Body timeout (time between receiving body chunks)
  BODY_TIMEOUT: parseInt(process.env.BODY_TIMEOUT, 10) || 15000, // 15s
  
  // Keep-alive timeout (idle connection timeout)
  KEEP_ALIVE_TIMEOUT: parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10) || 65000, // 65s
  
  // Maximum number of requests per connection
  MAX_REQUESTS_PER_CONNECTION: parseInt(process.env.MAX_REQUESTS_PER_CONNECTION, 10) || 100,
};

/**
 * Track slow requests for monitoring
 */
const slowRequestStats = {
  count: 0,
  byPath: {},
  byIP: {},
};

/**
 * Enhanced request timeout middleware with slow attack protection
 * @param {Object} options - Configuration options
 * @returns {Function} Express middleware
 */
const requestTimeoutProtection = (options = {}) => {
  const timeout = options.timeout || TIMEOUT_CONFIG.REQUEST_TIMEOUT;
  const warnThreshold = options.warnThreshold || timeout * 0.7; // Warn at 70%
  
  return (req, res, next) => {
    const startTime = Date.now();
    let timedOut = false;
    let warned = false;
    
    // Set timeout for the entire request
    const timeoutId = setTimeout(() => {
      if (timedOut) return;
      timedOut = true;
      
      const duration = Date.now() - startTime;
      
      // Track slow request
      slowRequestStats.count++;
      slowRequestStats.byPath[req.path] = (slowRequestStats.byPath[req.path] || 0) + 1;
      slowRequestStats.byIP[req.ip] = (slowRequestStats.byIP[req.ip] || 0) + 1;
      
      logger.warn('Request timeout exceeded', {
        path: req.path,
        method: req.method,
        ip: req.ip,
        duration: `${duration}ms`,
        timeout: `${timeout}ms`,
        userAgent: req.get('user-agent'),
      });
      
      // Log security event if this IP has multiple timeouts
      if (slowRequestStats.byIP[req.ip] > 5) {
        logger.security('Potential slow loris attack detected', {
          ip: req.ip,
          timeoutCount: slowRequestStats.byIP[req.ip],
          path: req.path,
        });
      }
      
      // Destroy the socket to prevent hanging
      if (req.socket) {
        req.socket.destroy();
      }
      
      // Send timeout response if headers not sent
      if (!res.headersSent) {
        res.status(408).json({
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Request timeout - the server took too long to process your request',
            timeout: `${timeout}ms`,
            timestamp: new Date().toISOString(),
          }
        });
      }
    }, timeout);
    
    // Warning threshold timer
    const warnTimeoutId = setTimeout(() => {
      if (timedOut || warned) return;
      warned = true;
      
      logger.warn('Request approaching timeout', {
        path: req.path,
        method: req.method,
        ip: req.ip,
        elapsed: `${Date.now() - startTime}ms`,
        threshold: `${warnThreshold}ms`,
      });
    }, warnThreshold);
    
    // Clear timeouts when response finishes
    const cleanup = () => {
      clearTimeout(timeoutId);
      clearTimeout(warnTimeoutId);
      
      // Track timing for slow requests (even if they complete)
      const duration = Date.now() - startTime;
      if (duration > timeout * 0.5 && !timedOut) {
        logger.debug('Slow request completed', {
          path: req.path,
          method: req.method,
          duration: `${duration}ms`,
        });
      }
    };
    
    res.on('finish', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    
    next();
  };
};

/**
 * Configure server-level timeouts
 * Apply to the HTTP server instance
 * @param {Object} server - HTTP/HTTPS server instance
 */
const configureServerTimeouts = (server) => {
  if (!server) {
    logger.warn('No server provided for timeout configuration');
    return;
  }
  
  // Overall request timeout
  server.timeout = TIMEOUT_CONFIG.REQUEST_TIMEOUT;
  
  // Headers timeout (protection against slow loris)
  server.headersTimeout = TIMEOUT_CONFIG.HEADER_TIMEOUT;
  
  // Request timeout (time to receive complete request)
  server.requestTimeout = TIMEOUT_CONFIG.BODY_TIMEOUT;
  
  // Keep-alive timeout
  server.keepAliveTimeout = TIMEOUT_CONFIG.KEEP_ALIVE_TIMEOUT;
  
  // Max requests per connection (prevent connection reuse abuse)
  server.maxRequestsPerSocket = TIMEOUT_CONFIG.MAX_REQUESTS_PER_CONNECTION;
  
  logger.info('Server timeouts configured', {
    timeout: `${server.timeout}ms`,
    headersTimeout: `${server.headersTimeout}ms`,
    requestTimeout: `${server.requestTimeout}ms`,
    keepAliveTimeout: `${server.keepAliveTimeout}ms`,
    maxRequestsPerSocket: server.maxRequestsPerSocket,
  });
  
  // Log timeout events
  server.on('timeout', (socket) => {
    logger.warn('Server socket timeout', {
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
    });
    
    // Track by IP
    const ip = socket.remoteAddress;
    if (ip) {
      slowRequestStats.byIP[ip] = (slowRequestStats.byIP[ip] || 0) + 1;
      
      if (slowRequestStats.byIP[ip] > 10) {
        logger.security('Multiple socket timeouts from IP', {
          ip,
          count: slowRequestStats.byIP[ip],
        });
      }
    }
  });
};

/**
 * Body receive timeout middleware
 * Protects against slow body attacks
 */
const bodyReceiveTimeout = (timeout = TIMEOUT_CONFIG.BODY_TIMEOUT) => {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
      // No body expected for these methods
      return next();
    }
    
    let lastChunkTime = Date.now();
    let timeoutId = null;
    let timedOut = false;
    
    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      
      timeoutId = setTimeout(() => {
        if (timedOut) return;
        timedOut = true;
        
        const idleTime = Date.now() - lastChunkTime;
        
        logger.warn('Body receive timeout', {
          path: req.path,
          method: req.method,
          ip: req.ip,
          idleTime: `${idleTime}ms`,
          timeout: `${timeout}ms`,
        });
        
        // Destroy socket
        if (req.socket) {
          req.socket.destroy();
        }
        
        if (!res.headersSent) {
          res.status(408).json({
            error: {
              code: 'BODY_TIMEOUT',
              message: 'Request body receive timeout',
              timestamp: new Date().toISOString(),
            }
          });
        }
      }, timeout);
    };
    
    // Monitor data chunks
    req.on('data', () => {
      lastChunkTime = Date.now();
      resetTimeout();
    });
    
    // Cleanup
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
    
    req.on('end', cleanup);
    req.on('error', cleanup);
    res.on('finish', cleanup);
    res.on('close', cleanup);
    
    // Start timeout
    resetTimeout();
    
    next();
  };
};

/**
 * Get slow request statistics
 * @returns {Object} Statistics
 */
const getSlowRequestStats = () => {
  return {
    totalSlowRequests: slowRequestStats.count,
    slowByPath: { ...slowRequestStats.byPath },
    slowByIP: { ...slowRequestStats.byIP },
    topSlowPaths: Object.entries(slowRequestStats.byPath)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([path, count]) => ({ path, count })),
    topSlowIPs: Object.entries(slowRequestStats.byIP)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, count })),
  };
};

/**
 * Reset slow request statistics
 */
const resetSlowRequestStats = () => {
  slowRequestStats.count = 0;
  slowRequestStats.byPath = {};
  slowRequestStats.byIP = {};
  logger.info('Slow request statistics reset');
};

/**
 * Log timeout configuration
 */
const logTimeoutConfiguration = () => {
  logger.info('Timeout Protection: Configuration loaded');
  logger.info(`Request timeout: ${TIMEOUT_CONFIG.REQUEST_TIMEOUT}ms`);
  logger.info(`Header timeout: ${TIMEOUT_CONFIG.HEADER_TIMEOUT}ms`);
  logger.info(`Body timeout: ${TIMEOUT_CONFIG.BODY_TIMEOUT}ms`);
  logger.info(`Keep-alive timeout: ${TIMEOUT_CONFIG.KEEP_ALIVE_TIMEOUT}ms`);
  logger.info(`Max requests per connection: ${TIMEOUT_CONFIG.MAX_REQUESTS_PER_CONNECTION}`);
  
  if (TIMEOUT_CONFIG.REQUEST_TIMEOUT > 30000) {
    logger.warn('⚠ REQUEST_TIMEOUT is set above 30s - consider reducing for better security');
  }
  
  if (TIMEOUT_CONFIG.HEADER_TIMEOUT > 15000) {
    logger.warn('⚠ HEADER_TIMEOUT is set above 15s - may be vulnerable to slow loris attacks');
  }
};

module.exports = {
  requestTimeoutProtection,
  bodyReceiveTimeout,
  configureServerTimeouts,
  getSlowRequestStats,
  resetSlowRequestStats,
  logTimeoutConfiguration,
  TIMEOUT_CONFIG,
};
