/**
 * Distributed Coordination Service
 * 
 * Enables multi-instance synchronization using Redis pub/sub:
 * - Cache invalidation broadcasts
 * - Rate limit rule updates
 * - Configuration changes
 * - System events
 * 
 * Ensures consistency across distributed deployments:
 * - Load-balanced environments
 * - Kubernetes clusters
 * - Cloud auto-scaling groups
 */

const { getRedisClient, isRedisConnected } = require('../config/redis');
const { withCircuitBreaker } = require('./circuitBreaker');
const logger = require('../utils/logger');

/**
 * Pub/Sub channels
 */
const CHANNELS = {
  CACHE_INVALIDATE: 'coordination:cache:invalidate',
  CACHE_CLEAR: 'coordination:cache:clear',
  RULE_UPDATE: 'coordination:rule:update',
  RULE_DELETE: 'coordination:rule:delete',
  CONFIG_UPDATE: 'coordination:config:update',
  SYSTEM_EVENT: 'coordination:system:event',
};

/**
 * Subscriber client (separate from publisher for Redis best practice)
 */
let subscriberClient = null;
let messageHandlers = new Map();
let isInitialized = false;

/**
 * Initialize pub/sub system
 * @returns {Promise<boolean>} Success status
 */
const initialize = async () => {
  if (isInitialized) {
    logger.debug('Pub/sub already initialized');
    return true;
  }

  if (!isRedisConnected()) {
    logger.warn('Redis unavailable, skipping pub/sub initialization');
    return false;
  }

  try {
    await withCircuitBreaker(async () => {
      const redis = getRedisClient();
      
      // Create duplicate client for subscribing
      subscriberClient = redis.duplicate();
      
      // Wait for connection
      await new Promise((resolve, reject) => {
        subscriberClient.on('ready', resolve);
        subscriberClient.on('error', reject);
      });

      // Subscribe to all channels
      const channels = Object.values(CHANNELS);
      await subscriberClient.subscribe(...channels);

      // Handle incoming messages
      subscriberClient.on('message', (channel, message) => {
        handleMessage(channel, message);
      });

      isInitialized = true;
      logger.info('Pub/sub system initialized', { channels: channels.length });
    });

    return true;
  } catch (error) {
    logger.error('Failed to initialize pub/sub', { error: error.message });
    return false;
  }
};

/**
 * Handle incoming messages
 * @param {string} channel - Channel name
 * @param {string} message - Message payload
 */
const handleMessage = (channel, message) => {
  try {
    const data = JSON.parse(message);
    
    logger.debug('Received pub/sub message', { channel, data });

    // Get handlers for this channel
    const handlers = messageHandlers.get(channel) || [];
    
    // Execute all handlers
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (error) {
        logger.error('Pub/sub handler error', { 
          channel, 
          error: error.message 
        });
      }
    }
  } catch (error) {
    logger.error('Failed to parse pub/sub message', { 
      channel, 
      error: error.message 
    });
  }
};

/**
 * Register message handler
 * @param {string} channel - Channel name
 * @param {Function} handler - Handler function
 */
const onMessage = (channel, handler) => {
  if (!messageHandlers.has(channel)) {
    messageHandlers.set(channel, []);
  }
  
  messageHandlers.get(channel).push(handler);
  
  logger.debug('Registered pub/sub handler', { channel });
};

/**
 * Publish message to channel
 * @param {string} channel - Channel name
 * @param {Object} data - Message data
 * @returns {Promise<number>} Number of subscribers that received message
 */
const publish = async (channel, data) => {
  if (!isRedisConnected()) {
    logger.debug('Redis unavailable, skipping pub/sub publish');
    return 0;
  }

  try {
    return await withCircuitBreaker(async () => {
      const redis = getRedisClient();
      const message = JSON.stringify(data);
      const receivers = await redis.publish(channel, message);
      
      logger.debug('Published pub/sub message', { 
        channel, 
        receivers,
        data 
      });
      
      return receivers;
    });
  } catch (error) {
    logger.error('Failed to publish message', { 
      channel, 
      error: error.message 
    });
    return 0;
  }
};

/**
 * Broadcast cache invalidation
 * @param {string} key - Cache key or pattern
 */
const broadcastCacheInvalidate = async (key) => {
  await publish(CHANNELS.CACHE_INVALIDATE, { key, timestamp: Date.now() });
};

/**
 * Broadcast cache clear
 */
const broadcastCacheClear = async () => {
  await publish(CHANNELS.CACHE_CLEAR, { timestamp: Date.now() });
};

/**
 * Broadcast rule update
 * @param {string} ruleId - Rule ID
 */
const broadcastRuleUpdate = async (ruleId) => {
  await publish(CHANNELS.RULE_UPDATE, { ruleId, timestamp: Date.now() });
};

/**
 * Broadcast rule deletion
 * @param {string} ruleId - Rule ID
 */
const broadcastRuleDelete = async (ruleId) => {
  await publish(CHANNELS.RULE_DELETE, { ruleId, timestamp: Date.now() });
};

/**
 * Broadcast configuration update
 * @param {string} key - Config key
 * @param {*} value - Config value
 */
const broadcastConfigUpdate = async (key, value) => {
  await publish(CHANNELS.CONFIG_UPDATE, { 
    key, 
    value, 
    timestamp: Date.now() 
  });
};

/**
 * Broadcast system event
 * @param {string} event - Event type
 * @param {Object} data - Event data
 */
const broadcastSystemEvent = async (event, data = {}) => {
  await publish(CHANNELS.SYSTEM_EVENT, { 
    event, 
    data, 
    timestamp: Date.now() 
  });
};

/**
 * Get subscription status
 * @returns {Object} Status information
 */
const getStatus = () => {
  return {
    initialized: isInitialized,
    connected: subscriberClient?.connected || false,
    channels: Object.values(CHANNELS),
    handlers: Array.from(messageHandlers.entries()).map(([channel, handlers]) => ({
      channel,
      handlerCount: handlers.length,
    })),
  };
};

/**
 * Shutdown pub/sub system
 */
const shutdown = async () => {
  if (!isInitialized) {
    return;
  }

  try {
    if (subscriberClient) {
      await subscriberClient.unsubscribe();
      subscriberClient.quit();
      subscriberClient = null;
    }

    messageHandlers.clear();
    isInitialized = false;
    
    logger.info('Pub/sub system shutdown complete');
  } catch (error) {
    logger.error('Failed to shutdown pub/sub', { error: error.message });
  }
};

module.exports = {
  CHANNELS,
  initialize,
  onMessage,
  publish,
  broadcastCacheInvalidate,
  broadcastCacheClear,
  broadcastRuleUpdate,
  broadcastRuleDelete,
  broadcastConfigUpdate,
  broadcastSystemEvent,
  getStatus,
  shutdown,
};
