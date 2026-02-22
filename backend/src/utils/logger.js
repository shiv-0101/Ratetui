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
 * Comprehensive data masking rules for logging
 * Based on TRD section 9.5 Data Masking requirements
 */
const MASKING_RULES = {
  // Full masking - completely hide these values
  fullMask: {
    fields: ['password', 'secret', 'apiKey', 'api_key', 'token', 'accessToken', 'refreshToken', 'authorization', 'privateKey', 'private_key'],
    patterns: [
      /Bearer\s+[\w-]+\.[\w-]+\.[\w-]+/gi, // JWT tokens
      /\bsk_[a-zA-Z0-9]{24,}\b/gi, // Stripe secret keys
      /\bpk_[a-zA-Z0-9]{24,}\b/gi, // Stripe public keys
    ],
  },
  
  // Partial masking - show part of the value for debugging
  partialMask: {
    email: {
      fields: ['email', 'userEmail', 'user_email', 'emailAddress'],
      mask: (value) => {
        if (typeof value !== 'string' || !value.includes('@')) return value;
        const [local, domain] = value.split('@');
        const maskedLocal = local.length > 2 
          ? local.substring(0, 2) + '*'.repeat(Math.min(local.length - 2, 5))
          : local;
        return `${maskedLocal}@${domain}`;
      },
    },
    ip: {
      fields: ['ip', 'clientIp', 'remoteAddress', 'ipAddress', 'sourceIp'],
      mask: (value) => {
        if (typeof value !== 'string') return value;
        // IPv4: show first two octets
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) {
          const parts = value.split('.');
          return `${parts[0]}.${parts[1]}.***.**`;
        }
        // IPv6: show first two segments
        if (/:/.test(value)) {
          const parts = value.split(':');
          return `${parts[0]}:${parts[1]}:****:****`;
        }
        return value;
      },
    },
    creditCard: {
      patterns: [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g],
      mask: (value) => {
        if (typeof value !== 'string') return value;
        return value.replace(/\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})\b/g, '****-****-****-$4');
      },
    },
    ssn: {
      patterns: [/\b\d{3}-\d{2}-\d{4}\b/g],
      mask: (value) => {
        if (typeof value !== 'string') return value;
        return value.replace(/\b(\d{3})-(\d{2})-(\d{4})\b/g, '***-**-$3');
      },
    },
  },
};

/**
 * Mask sensitive data in logs according to data classification policies
 * @param {any} obj - Object to mask
 * @param {string} path - Current path in object (for debugging)
 * @returns {any} Masked object
 */
const maskSensitiveData = (obj, path = '') => {
  if (!obj || typeof obj !== 'object') {
    // Check for patterns in string values
    if (typeof obj === 'string') {
      let masked = obj;
      
      // Apply full mask patterns
      MASKING_RULES.fullMask.patterns.forEach(pattern => {
        masked = masked.replace(pattern, '[REDACTED]');
      });
      
      // Apply partial mask patterns
      Object.values(MASKING_RULES.partialMask).forEach(rule => {
        if (rule.patterns) {
          rule.patterns.forEach(pattern => {
            masked = masked.replace(pattern, (match) => rule.mask(match));
          });
        }
      });
      
      return masked;
    }
    return obj;
  }
  
  const masked = Array.isArray(obj) ? [] : {};
  
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    // Check for full masking
    if (MASKING_RULES.fullMask.fields.some(field => lowerKey.includes(field.toLowerCase()))) {
      masked[key] = '[REDACTED]';
      continue;
    }
    
    // Check for partial masking - email
    if (MASKING_RULES.partialMask.email.fields.some(field => lowerKey.includes(field.toLowerCase()))) {
      masked[key] = MASKING_RULES.partialMask.email.mask(value);
      continue;
    }
    
    // Check for partial masking - IP
    if (MASKING_RULES.partialMask.ip.fields.some(field => lowerKey.includes(field.toLowerCase()))) {
      masked[key] = MASKING_RULES.partialMask.ip.mask(value);
      continue;
    }
    
    // Recursively mask nested objects
    if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveData(value, `${path}.${key}`);
    } else if (typeof value === 'string') {
      masked[key] = maskSensitiveData(value, `${path}.${key}`);
    } else {
      masked[key] = value;
    }
  }
  
  return masked;
};

/**
 * Custom format for sanitizing sensitive data
 * Enhanced version with comprehensive masking rules
 */
const sanitizeFormat = winston.format((info) => {
  return maskSensitiveData(info);
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
 * Includes sensitive data masking for audit logs
 */
const auditLogger = winston.createLogger({
  level: 'info',
  levels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format((info) => maskSensitiveData(info))(),
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
 * Log audit event with automatic data masking
 */
const logAudit = (action, actor, resource, details = {}, result = 'success') => {
  auditLogger.info({
    type: 'audit',
    action,
    actor: {
      id: actor.id,
      email: actor.email, // Will be masked automatically
      ip: actor.ip, // Will be masked automatically
    },
    resource,
    details, // Will be masked automatically
    result,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Log security event
 */
logger.security = (message, meta = {}) => {
  logger.warn({
    type: 'security',
    message,
    ...meta,
    timestamp: new Date().toISOString(),
  });
};

module.exports = logger;
module.exports.auditLogger = auditLogger;
module.exports.logAudit = logAudit;
module.exports.maskSensitiveData = maskSensitiveData;
module.exports.MASKING_RULES = MASKING_RULES;
