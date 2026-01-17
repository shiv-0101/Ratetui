/**
 * Logger Configuration
 * 
 * Winston-based logger with structured logging support.
 */

const winston = require('winston');

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const configLevel = process.env.LOG_LEVEL;
  
  if (configLevel && levels[configLevel] !== undefined) {
    return configLevel;
  }
  
  return env === 'development' ? 'debug' : 'info';
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(colors);

/**
 * Custom format for sanitizing sensitive data
 */
const sanitizeFormat = winston.format((info) => {
  // Sanitize sensitive fields
  const sensitiveFields = ['password', 'token', 'authorization', 'secret', 'apiKey'];
  
  const sanitize = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    
    const sanitized = Array.isArray(obj) ? [...obj] : { ...obj };
    
    for (const key of Object.keys(sanitized)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveFields.some(field => lowerKey.includes(field))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object') {
        sanitized[key] = sanitize(sanitized[key]);
      }
    }
    
    return sanitized;
  };

  return sanitize(info);
});

/**
 * Format for development
 */
const devFormat = winston.format.combine(
  sanitizeFormat(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}${
      info.error ? ` - ${info.error}` : ''
    }${
      Object.keys(info).filter(k => !['timestamp', 'level', 'message', 'error'].includes(k)).length > 0
        ? ` ${JSON.stringify(Object.fromEntries(Object.entries(info).filter(([k]) => !['timestamp', 'level', 'message', 'error'].includes(k))))}`
        : ''
    }`
  )
);

/**
 * Format for production (JSON)
 */
const prodFormat = winston.format.combine(
  sanitizeFormat(),
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/**
 * Create logger instance
 */
const logger = winston.createLogger({
  level: level(),
  levels,
  format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
  ],
  exitOnError: false,
});

/**
 * Create audit logger for security events
 */
const auditLogger = winston.createLogger({
  level: 'info',
  levels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    // Add file transport for audit logs in production
    // new winston.transports.File({ filename: 'audit.log' }),
  ],
  exitOnError: false,
});

/**
 * Log audit event
 */
const logAudit = (action, actor, resource, details = {}, result = 'success') => {
  auditLogger.info({
    type: 'audit',
    action,
    actor: {
      id: actor.id,
      email: actor.email,
      ip: actor.ip,
    },
    resource,
    details,
    result,
    timestamp: new Date().toISOString(),
  });
};

module.exports = logger;
module.exports.auditLogger = auditLogger;
module.exports.logAudit = logAudit;
