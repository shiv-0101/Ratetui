/**
 * CORS Configuration
 * 
 * Configures Cross-Origin Resource Sharing with security in mind.
 */

const logger = require('../utils/logger');

/**
 * Parse allowed origins from environment
 */
const getAllowedOrigins = () => {
  const origins = process.env.CORS_ORIGINS || 'http://localhost:3001';
  return origins.split(',').map(origin => origin.trim());
};

/**
 * CORS options
 */
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = getAllowedOrigins();
    
    // Allow requests with no origin (like mobile apps or curl)
    // In production, you might want to restrict this
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        logger.warn('CORS: Request with no origin blocked in production');
        return callback(new Error('CORS: Origin required'), false);
      }
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    logger.warn(`CORS: Blocked request from origin: ${origin}`);
    return callback(new Error('CORS: Origin not allowed'), false);
  },
  
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-ID',
  ],
  
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Retry-After',
  ],
  
  credentials: true,
  
  maxAge: 86400, // 24 hours
  
  preflightContinue: false,
  
  optionsSuccessStatus: 204,
};

module.exports = {
  corsOptions,
  getAllowedOrigins,
};
