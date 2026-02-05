/**
 * Rate Limiter Backend - Entry Point
 * 
 * This is the main entry point for the rate limiter service.
 * It initializes the Express server, connects to Redis, and sets up all middleware.
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const logger = require('./utils/logger');
const { connectRedis, closeRedis } = require('./config/redis');
const { corsOptions } = require('./config/cors');
const errorHandler = require('./middleware/errorHandler');
const { 
  addRequestId, 
  morganMiddleware, 
  logSlowRequest,
  requestTimeout,
} = require('./middleware/requestLogger');

// Import routes
const healthRoutes = require('./routes/health');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');

const app = express();

// ===========================================
// Security Middleware
// ===========================================

// Helmet - Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ['\'self\''],
      scriptSrc: ['\'self\''],
      styleSrc: ['\'self\'', '\'unsafe-inline\''],
      imgSrc: ['\'self\'', 'data:'],
      connectSrc: ['\'self\''],
      fontSrc: ['\'self\''],
      objectSrc: ['\'none\''],
      mediaSrc: ['\'self\''],
      frameSrc: ['\'none\''],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: 'same-site' },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
}));

// CORS
app.use(cors(corsOptions));

// Trust proxy (important for correct IP extraction)
const trustProxy = process.env.TRUST_PROXY || 'loopback';
app.set('trust proxy', trustProxy);

// ===========================================
// Request Parsing & Logging
// ===========================================

// Add request ID to all requests
app.use(addRequestId);

// Request timeout (30 seconds)
app.use(requestTimeout(30000));

// Body parsing with size limits
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Request logging with request ID, IP masking, and timing
if (process.env.NODE_ENV !== 'test') {
  app.use(morganMiddleware);
  app.use(logSlowRequest);
}

// ===========================================
// Routes
// ===========================================

// Health check (no rate limiting)
app.use('/health', healthRoutes);

// API routes (will have rate limiting applied)
app.use('/api', apiRoutes);

// Auth routes (login, logout, refresh)
app.use('/admin/auth', authRoutes);

// Admin routes (authentication required)
app.use('/admin', adminRoutes);

// ===========================================
// Error Handling
// ===========================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found',
    }
  });
});

// Global error handler
app.use(errorHandler);

// ===========================================
// Server Startup
// ===========================================

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Load package info for startup banner
const pkg = require('../package.json');

/**
 * Display startup banner with version and config info
 */
const displayStartupBanner = () => {
  const banner = `
╔══════════════════════════════════════════════════════════╗
║                   RATETUI RATE LIMITER                   ║
╠══════════════════════════════════════════════════════════╣
║  Version:     ${pkg.version.padEnd(42)}║
║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(42)}║
║  Node.js:     ${process.version.padEnd(42)}║
║  Host:        ${HOST.padEnd(42)}║
║  Port:        ${String(PORT).padEnd(42)}║
║  Redis:       ${(process.env.REDIS_HOST || 'localhost').padEnd(42)}║
╚══════════════════════════════════════════════════════════╝
`;
  console.log(banner);
};

async function startServer() {
  try {
    // Display startup banner
    displayStartupBanner();

    // Connect to Redis
    await connectRedis();
    logger.info('Connected to Redis');

    // Start server
    const server = app.listen(PORT, HOST, () => {
      logger.info(`Rate Limiter Server running on http://${HOST}:${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Track active connections for graceful shutdown
    const activeConnections = new Set();
    let isShuttingDown = false;

    server.on('connection', (socket) => {
      activeConnections.add(socket);
      socket.on('close', () => activeConnections.delete(socket));
    });

    // Graceful shutdown with connection draining
    const shutdown = async (signal) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      
      logger.info(`${signal} received. Shutting down gracefully...`);
      logger.info(`Active connections: ${activeConnections.size}`);

      // Stop accepting new connections
      server.close(async () => {
        logger.info('HTTP server closed');
        
        await closeRedis();
        logger.info('Redis connection closed');
        
        process.exit(0);
      });

      // Gracefully close existing connections
      for (const socket of activeConnections) {
        socket.end();
      }

      // Wait for connections to drain
      const drainInterval = setInterval(() => {
        if (activeConnections.size === 0) {
          clearInterval(drainInterval);
          logger.info('All connections drained');
        } else {
          logger.info(`Waiting for ${activeConnections.size} connections to close...`);
        }
      }, 1000);

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        for (const socket of activeConnections) {
          socket.destroy();
        }
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app; // For testing
