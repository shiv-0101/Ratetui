/**
 * Circuit Breaker for Redis Operations
 * 
 * Implements the Circuit Breaker pattern to prevent cascading failures:
 * - Tracks Redis operation failures
 * - Opens circuit after threshold failures (blocks requests)
 * - Half-open state for testing recovery
 * - Automatic recovery when Redis is healthy
 * 
 * States:
 * - CLOSED: Normal operation, all requests pass through
 * - OPEN: Too many failures, reject requests immediately
 * - HALF_OPEN: Testing if service recovered, allow limited requests
 * 
 * Benefits:
 * - Prevents overwhelming failing services
 * - Fast-fail instead of waiting for timeouts
 * - Automatic recovery detection
 * - Reduces latency during outages
 */

const logger = require('../utils/logger');
const { recordError } = require('./advancedMetrics');

/**
 * Circuit breaker states
 */
const CircuitState = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open',
};

/**
 * Circuit breaker configuration
 */
const CIRCUIT_CONFIG = {
  // Failure threshold to open circuit
  FAILURE_THRESHOLD: 5,
  
  // Success threshold in half-open to close circuit
  SUCCESS_THRESHOLD: 2,
  
  // Time to wait before trying half-open (ms)
  RESET_TIMEOUT: 30000, // 30 seconds
  
  // Request timeout for circuit breaker (ms)
  REQUEST_TIMEOUT: 5000,
  
  // Rolling window for failure counting (ms)
  ROLLING_WINDOW: 60000, // 1 minute
};

/**
 * Circuit breaker class
 */
class CircuitBreaker {
  constructor(name, config = {}) {
    this.name = name;
    this.state = CircuitState.CLOSED;
    
    this.config = {
      ...CIRCUIT_CONFIG,
      ...config,
    };
    
    // Statistics
    this.failures = [];
    this.successes = 0;
    this.totalRequests = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    
    // State management
    this.nextAttempt = Date.now();
    this.stateChangeTime = Date.now();
    
    logger.info(`Circuit breaker initialized: ${name}`, {
      failureThreshold: this.config.FAILURE_THRESHOLD,
      resetTimeout: this.config.RESET_TIMEOUT,
    });
  }
  
  /**
   * Get current state
   * @returns {string} Current circuit state
   */
  getState() {
    // Check if we should try half-open
    if (this.state === CircuitState.OPEN && Date.now() >= this.nextAttempt) {
      this.setState(CircuitState.HALF_OPEN);
    }
    
    return this.state;
  }
  
  /**
   * Set circuit state
   * @param {string} newState - New state
   */
  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    this.stateChangeTime = Date.now();
    
    if (newState === CircuitState.OPEN) {
      this.nextAttempt = Date.now() + this.config.RESET_TIMEOUT;
      logger.warn(`Circuit breaker opened: ${this.name}`, {
        failures: this.getRecentFailureCount(),
        nextAttempt: new Date(this.nextAttempt).toISOString(),
      });
      recordError('circuit_breaker', 'opened');
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successes = 0;
      logger.info(`Circuit breaker half-open: ${this.name}`, {
        testing: 'recovery',
      });
    } else if (newState === CircuitState.CLOSED) {
      this.failures = [];
      logger.info(`Circuit breaker closed: ${this.name}`, {
        previousState: oldState,
      });
    }
  }
  
  /**
   * Get recent failure count in rolling window
   * @returns {number} Number of recent failures
   */
  getRecentFailureCount() {
    const now = Date.now();
    const cutoff = now - this.config.ROLLING_WINDOW;
    
    // Remove old failures
    this.failures = this.failures.filter(timestamp => timestamp > cutoff);
    
    return this.failures.length;
  }
  
  /**
   * Record success
   */
  recordSuccess() {
    this.totalRequests++;
    this.totalSuccesses++;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      
      // Close circuit if enough successes
      if (this.successes >= this.config.SUCCESS_THRESHOLD) {
        this.setState(CircuitState.CLOSED);
      }
    }
  }
  
  /**
   * Record failure
   */
  recordFailure() {
    this.totalRequests++;
    this.totalFailures++;
    this.failures.push(Date.now());
    
    const recentFailures = this.getRecentFailureCount();
    
    if (this.state === CircuitState.HALF_OPEN) {
      // Go back to open on any failure in half-open
      this.setState(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      // Open circuit if threshold exceeded
      if (recentFailures >= this.config.FAILURE_THRESHOLD) {
        this.setState(CircuitState.OPEN);
      }
    }
  }
  
  /**
   * Execute function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} Function result
   * @throws {Error} Circuit open error or execution error
   */
  async execute(fn) {
    const state = this.getState();
    
    // Reject immediately if circuit is open
    if (state === CircuitState.OPEN) {
      const error = new Error(`Circuit breaker open for ${this.name}`);
      error.code = 'CIRCUIT_OPEN';
      error.nextAttempt = this.nextAttempt;
      recordError('circuit_breaker', 'rejected');
      throw error;
    }
    
    try {
      // Execute with timeout
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Circuit breaker timeout')), this.config.REQUEST_TIMEOUT)
        ),
      ]);
      
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
  
  /**
   * Force open the circuit
   */
  forceOpen() {
    this.setState(CircuitState.OPEN);
  }
  
  /**
   * Force close the circuit
   */
  forceClose() {
    this.setState(CircuitState.CLOSED);
  }
  
  /**
   * Reset circuit breaker statistics
   */
  reset() {
    this.failures = [];
    this.successes = 0;
    this.totalRequests = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.setState(CircuitState.CLOSED);
    logger.info(`Circuit breaker reset: ${this.name}`);
  }
  
  /**
   * Get circuit breaker statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      name: this.name,
      state: this.state,
      recentFailures: this.getRecentFailureCount(),
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      successRate: this.totalRequests > 0 
        ? ((this.totalSuccesses / this.totalRequests) * 100).toFixed(2) + '%'
        : 'N/A',
      stateChangeTime: new Date(this.stateChangeTime).toISOString(),
      nextAttempt: this.state === CircuitState.OPEN 
        ? new Date(this.nextAttempt).toISOString()
        : null,
      config: {
        failureThreshold: this.config.FAILURE_THRESHOLD,
        successThreshold: this.config.SUCCESS_THRESHOLD,
        resetTimeout: this.config.RESET_TIMEOUT,
        requestTimeout: this.config.REQUEST_TIMEOUT,
        rollingWindow: this.config.ROLLING_WINDOW,
      },
    };
  }
}

/**
 * Create Redis circuit breaker
 * @param {string} operationName - Operation name for logging
 * @returns {CircuitBreaker} Circuit breaker instance
 */
const createRedisCircuitBreaker = (operationName = 'redis') => {
  return new CircuitBreaker(operationName, {
    FAILURE_THRESHOLD: parseInt(process.env.CIRCUIT_FAILURE_THRESHOLD, 10) || 5,
    SUCCESS_THRESHOLD: parseInt(process.env.CIRCUIT_SUCCESS_THRESHOLD, 10) || 2,
    RESET_TIMEOUT: parseInt(process.env.CIRCUIT_RESET_TIMEOUT, 10) || 30000,
    REQUEST_TIMEOUT: parseInt(process.env.CIRCUIT_REQUEST_TIMEOUT, 10) || 5000,
  });
};

/**
 * Global circuit breaker instance for Redis
 */
const redisCircuitBreaker = createRedisCircuitBreaker('redis-main');

/**
 * Wrap Redis command with circuit breaker
 * @param {Function} fn - Redis command function
 * @returns {Promise<any>} Command result
 */
const withCircuitBreaker = async (fn) => {
  return redisCircuitBreaker.execute(fn);
};

/**
 * Check if circuit is open
 * @returns {boolean} True if circuit is open
 */
const isCircuitOpen = () => {
  return redisCircuitBreaker.getState() === CircuitState.OPEN;
};

/**
 * Get circuit breaker statistics
 * @returns {Object} Statistics
 */
const getCircuitStats = () => {
  return redisCircuitBreaker.getStats();
};

/**
 * Reset circuit breaker
 */
const resetCircuit = () => {
  redisCircuitBreaker.reset();
};

module.exports = {
  CircuitBreaker,
  CircuitState,
  createRedisCircuitBreaker,
  redisCircuitBreaker,
  withCircuitBreaker,
  isCircuitOpen,
  getCircuitStats,
  resetCircuit,
  CIRCUIT_CONFIG,
};
