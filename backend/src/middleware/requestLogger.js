/**
 * Request Logging Middleware
 * 
 * Logs all HTTP requests with timing, IP, and request details
 */

const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Add unique request ID to each request
 */
const addRequestId = (req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
};

/**
 * Mask IP address for privacy in production
 * @param {string} ip - IP address to mask
 * @returns {string} Masked IP address
 */
const maskIP = (ip) => {
  if (process.env.NODE_ENV !== 'production') {
    return ip;
  }

  // IPv4: Show first two octets only (e.g., 192.168.x.x)
  if (ip.includes('.')) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.x.x`;
  }

  // IPv6: Show first two groups only
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts[0]}:${parts[1]}:x:x:x:x:x:x`;
  }

  return 'x.x.x.x';
};

/**
 * Custom Morgan token for request ID
 */
morgan.token('id', (req) => req.id);

/**
 * Custom Morgan token for masked IP
 */
morgan.token('masked-ip', (req) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  return maskIP(ip);
});

/**
 * Custom Morgan token for user agent
 */
morgan.token('user-agent', (req) => req.get('user-agent') || 'unknown');

/**
 * Custom Morgan token for status with color coding (development only)
 */
morgan.token('status-colored', (req, res) => {
  const status = res.statusCode;
  
  if (process.env.NODE_ENV === 'production') {
    return status;
  }

  // Color codes for development
  if (status >= 500) return `\x1b[31m${status}\x1b[0m`; // Red
  if (status >= 400) return `\x1b[33m${status}\x1b[0m`; // Yellow
  if (status >= 300) return `\x1b[36m${status}\x1b[0m`; // Cyan
  if (status >= 200) return `\x1b[32m${status}\x1b[0m`; // Green
  return status;
});

/**
 * Development format with colors and full details
 */
const devFormat = ':id [:date[iso]] :method :url :status-colored :response-time ms - :res[content-length] bytes - IP: :masked-ip - ":user-agent"';

/**
 * Production format - JSON for log aggregation
 */
const prodFormat = (tokens, req, res) => {
  return JSON.stringify({
    requestId: tokens.id(req, res),
    timestamp: tokens.date(req, res, 'iso'),
    method: tokens.method(req, res),
    url: tokens.url(req, res),
    status: tokens.status(req, res),
    responseTime: tokens['response-time'](req, res),
    contentLength: tokens.res(req, res, 'content-length'),
    ip: tokens['masked-ip'](req, res),
    userAgent: tokens['user-agent'](req, res),
  });
};

/**
 * Stream that writes to Winston logger
 */
const stream = {
  write: (message) => {
    const msg = message.trim();
    
    // In production, log as JSON
    if (process.env.NODE_ENV === 'production') {
      try {
        const logData = JSON.parse(msg);
        logger.info('HTTP Request', logData);
      } catch (err) {
        logger.info(msg);
      }
    } else {
      // In development, log as formatted string
      logger.info(msg);
    }
  },
};

/**
 * Configure Morgan middleware based on environment
 */
const morganMiddleware = process.env.NODE_ENV === 'production'
  ? morgan(prodFormat, { stream })
  : morgan(devFormat, { stream });

/**
 * Log errors with full details
 */
const logError = (err, req, _res) => {
  logger.error('Request Error', {
    requestId: req.id,
    method: req.method,
    url: req.url,
    ip: maskIP(req.ip || 'unknown'),
    error: {
      message: err.message,
      code: err.code,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    },
  });
};

/**
 * Log slow requests (> 1 second)
 */
const logSlowRequest = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    
    if (duration > 1000) {
      logger.warn('Slow Request Detected', {
        requestId: req.id,
        method: req.method,
        url: req.url,
        duration: `${duration}ms`,
        status: res.statusCode,
      });
    }
  });

  next();
};

module.exports = {
  addRequestId,
  morganMiddleware,
  logError,
  logSlowRequest,
  maskIP,
};

/**
 * Request timeout middleware
 * Terminates requests that exceed the specified timeout
 * @param {number} timeout - Timeout in milliseconds (default: 30000)
 */
const requestTimeout = (timeout = 30000) => {
  return (req, res, next) => {
    const timeoutId = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('Request timeout', {
          requestId: req.id,
          method: req.method,
          url: req.url,
          timeout: `${timeout}ms`,
        });

        res.status(408).json({
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Request timeout - the server did not receive a complete request in time',
          },
        });
      }
    }, timeout);

    res.on('finish', () => clearTimeout(timeoutId));
    res.on('close', () => clearTimeout(timeoutId));

    next();
  };
};

module.exports = {
  addRequestId,
  morganMiddleware,
  logError,
  logSlowRequest,
  maskIP,
  requestTimeout,
};
