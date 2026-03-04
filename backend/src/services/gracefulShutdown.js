/**
 * Graceful Shutdown Handler
 * 
 * Manages graceful shutdown of the server:
 * - Stops accepting new connections
 * - Waits for in-flight requests to complete
 * - Closes Redis connections
 * - Cleans up resources
 * - Handles termination signals (SIGTERM, SIGINT)
 * 
 * Prevents data loss and connection errors during deployment or restart.
 */

const logger = require('../utils/logger');
const { closeRedis } = require('../config/redis');

/**
 * Graceful shutdown configuration
 */
const SHUTDOWN_CONFIG = {
  // Grace period for active requests (30 seconds)
  SHUTDOWN_TIMEOUT: 30000,
  
  // Signal poll interval (1 second)
  POLL_INTERVAL: 1000,
  
  // Force shutdown timeout (40 seconds total - 30s grace + 10s force)
  FORCE_SHUTDOWN_TIMEOUT: 40000,
};

/**
 * Track active connections and requests
 */
const connectionTracker = {
  activeRequests: 0,
  shuttingDown: false,
  server: null,
};

/**
 * Middleware to track active requests
 * Increments counter on request start, decrements on finish
 * @returns {Function} Express middleware
 */
const requestTracker = (req, res, next) => {
  if (connectionTracker.shuttingDown) {
    // Return 503 for new requests during shutdown
    res.set('Connection', 'close');
    return res.status(503).json({
      error: {
        code: 'SERVICE_SHUTTING_DOWN',
        message: 'Server is shutting down, please retry shortly',
      },
    });
  }
  
  connectionTracker.activeRequests++;
  
  const cleanup = () => {
    connectionTracker.activeRequests--;
  };
  
  // Decrement on response finish or connection close
  res.on('finish', cleanup);
  res.on('close', cleanup);
  
  next();
};

/**
 * Wait for active requests to complete
 * @returns {Promise<void>}
 */
const waitForActiveRequests = async () => {
  const startTime = Date.now();
  const timeout = SHUTDOWN_CONFIG.SHUTDOWN_TIMEOUT;
  
  logger.info('Waiting for active requests to complete', {
    activeRequests: connectionTracker.activeRequests,
    timeout: `${timeout / 1000}s`,
  });
  
  while (connectionTracker.activeRequests > 0) {
    const elapsed = Date.now() - startTime;
    
    if (elapsed >= timeout) {
      logger.warn('Shutdown timeout reached, force closing', {
        remainingRequests: connectionTracker.activeRequests,
        elapsed: `${elapsed / 1000}s`,
      });
      break;
    }
    
    // Log progress every 5 seconds
    if (elapsed > 0 && elapsed % 5000 === 0) {
      logger.info('Still waiting for requests to complete', {
        activeRequests: connectionTracker.activeRequests,
        elapsed: `${elapsed / 1000}s`,
      });
    }
    
    // Wait for poll interval
    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_CONFIG.POLL_INTERVAL));
  }
  
  logger.info('All active requests completed', {
    finalCount: connectionTracker.activeRequests,
  });
};

/**
 * Close server gracefully
 * @returns {Promise<void>}
 */
const closeServer = async () => {
  if (!connectionTracker.server) {
    logger.warn('Server instance not registered, skipping close');
    return;
  }
  
  return new Promise((resolve) => {
    connectionTracker.server.close((err) => {
      if (err) {
        logger.error('Error closing server', { error: err.message });
      } else {
        logger.info('HTTP server closed successfully');
      }
      resolve();
    });
  });
};

/**
 * Cleanup resources
 * - Close Redis connections
 * - Clear timers and intervals
 * - Release file handles
 * @returns {Promise<void>}
 */
const cleanupResources = async () => {
  logger.info('Cleaning up resources...');
  
  try {
    // Close Redis connection
    await closeRedis();
    logger.info('Redis connection closed');
  } catch (error) {
    logger.error('Error closing Redis', { error: error.message });
  }
  
  // Additional cleanup can be added here:
  // - Close database connections
  // - Clear scheduled tasks
  // - Release file handles
  // - Flush buffers
  
  logger.info('Resource cleanup completed');
};

/**
 * Perform graceful shutdown
 * @param {string} signal - Signal that triggered shutdown
 * @returns {Promise<void>}
 */
const gracefulShutdown = async (signal) => {
  if (connectionTracker.shuttingDown) {
    logger.warn('Shutdown already in progress, ignoring signal', { signal });
    return;
  }
  
  connectionTracker.shuttingDown = true;
  
  logger.info('Starting graceful shutdown', { signal });
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
  
  try {
    // Step 1: Stop accepting new connections
    await closeServer();
    
    // Step 2: Wait for active requests to complete
    await waitForActiveRequests();
    
    // Step 3: Cleanup resources
    await cleanupResources();
    
    logger.info('Graceful shutdown completed successfully');
    console.log('✅ Shutdown complete\n');
    
    // Exit cleanly
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', { error: error.message, signal });
    console.error(`❌ Shutdown error: ${error.message}\n`);
    
    // Force exit with error code
    process.exit(1);
  }
};

/**
 * Setup graceful shutdown handlers
 * Registers signal handlers for SIGTERM and SIGINT
 * @param {Object} server - HTTP server instance
 */
const setupGracefulShutdown = (server) => {
  // Register server instance
  connectionTracker.server = server;
  
  // Handle SIGTERM (Kubernetes, Docker, systemd)
  process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM');
  });
  
  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    gracefulShutdown('SIGINT');
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception, initiating shutdown', {
      error: error.message,
      stack: error.stack,
    });
    console.error('❌ Uncaught exception:', error);
    gracefulShutdown('uncaughtException');
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection, initiating shutdown', {
      reason: String(reason),
      promise: String(promise),
    });
    console.error('❌ Unhandled rejection:', reason);
    gracefulShutdown('unhandledRejection');
  });
  
  // Set force shutdown timeout as last resort
  const forceShutdownTimer = setTimeout(() => {
    logger.error('Force shutdown timeout reached, terminating immediately');
    console.error('❌ Force shutdown - timeout exceeded\n');
    process.exit(1);
  }, SHUTDOWN_CONFIG.FORCE_SHUTDOWN_TIMEOUT);
  
  // Don't keep process alive just for this timer
  forceShutdownTimer.unref();
  
  logger.info('Graceful shutdown handlers registered');
};

/**
 * Get shutdown status
 * @returns {Object} Shutdown status
 */
const getShutdownStatus = () => {
  return {
    shuttingDown: connectionTracker.shuttingDown,
    activeRequests: connectionTracker.activeRequests,
    serverRegistered: !!connectionTracker.server,
  };
};

module.exports = {
  setupGracefulShutdown,
  requestTracker,
  gracefulShutdown,
  getShutdownStatus,
  SHUTDOWN_CONFIG,
};
