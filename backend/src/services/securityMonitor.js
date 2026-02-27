/**
 * Security Monitoring and Alerting Service
 * 
 * Monitors security events and provides real-time alerting:
 * - Failed authentication attempts
 * - Rate limit violations
 * - CSRF attacks
 * - Injection attempts
 * - Distributed attacks
 * - Suspicious patterns
 * 
 * Features:
 * - Real-time event tracking
 * - Threshold-based alerting
 * - Alert suppression (prevent alert fatigue)
 * - Multiple notification channels (log, webhook, email placeholder)
 * - Event aggregation and correlation
 */

const { getRedisClient, isRedisConnected } = require('../config/redis');
const logger = require('../utils/logger');
const auditLog = require('./auditLog');

/**
 * Configuration
 */
const SECURITY_MONITOR_CONFIG = {
  // Alert thresholds
  FAILED_LOGIN_THRESHOLD: parseInt(process.env.ALERT_FAILED_LOGIN_THRESHOLD, 10) || 10,
  FAILED_LOGIN_WINDOW: 300, // 5 minutes
  
  RATE_LIMIT_THRESHOLD: parseInt(process.env.ALERT_RATE_LIMIT_THRESHOLD, 10) || 100,
  RATE_LIMIT_WINDOW: 300, // 5 minutes
  
  CSRF_ATTACK_THRESHOLD: parseInt(process.env.ALERT_CSRF_THRESHOLD, 10) || 5,
  CSRF_ATTACK_WINDOW: 300, // 5 minutes
  
  INJECTION_ATTEMPT_THRESHOLD: parseInt(process.env.ALERT_INJECTION_THRESHOLD, 10) || 5,
  INJECTION_ATTEMPT_WINDOW: 300, // 5 minutes
  
  // Alert suppression (prevent repeat alerts)
  ALERT_COOLDOWN: parseInt(process.env.ALERT_COOLDOWN, 10) || 900, // 15 minutes
  
  // Redis keys
  EVENT_KEY_PREFIX: 'security:event:',
  ALERT_KEY_PREFIX: 'security:alert:',
  METRICS_KEY: 'security:metrics:',
  
  // Retention
  EVENT_RETENTION: 86400, // 24 hours
};

/**
 * Security event types
 */
const SECURITY_EVENTS = {
  FAILED_LOGIN: 'failed_login',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  CSRF_ATTACK: 'csrf_attack',
  INJECTION_ATTEMPT: 'injection_attempt',
  DISTRIBUTED_ATTACK: 'distributed_attack',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',
  ACCOUNT_LOCKOUT: 'account_lockout',
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  INVALID_TOKEN: 'invalid_token',
};

/**
 * Alert severity levels
 */
const ALERT_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

/**
 * Track security event
 * @param {string} eventType - Event type
 * @param {Object} details - Event details
 */
const trackSecurityEvent = async (eventType, details = {}) => {
  try {
    const timestamp = Date.now();
    const eventKey = `${SECURITY_MONITOR_CONFIG.EVENT_KEY_PREFIX}${eventType}`;
    
    const eventData = {
      type: eventType,
      timestamp,
      ...details,
    };
    
    if (isRedisConnected()) {
      const redis = getRedisClient();
      
      // Add to sorted set with timestamp as score
      await redis.zadd(eventKey, timestamp, JSON.stringify(eventData));
      
      // Set expiry
      await redis.expire(eventKey, SECURITY_MONITOR_CONFIG.EVENT_RETENTION);
      
      // Increment metrics counter
      const dateKey = new Date().toISOString().split('T')[0];
      await redis.hincrby(`${SECURITY_MONITOR_CONFIG.METRICS_KEY}${dateKey}`, eventType, 1);
      await redis.expire(`${SECURITY_MONITOR_CONFIG.METRICS_KEY}${dateKey}`, SECURITY_MONITOR_CONFIG.EVENT_RETENTION);
    }
    
    // Log security event
    logger.security(`Security event: ${eventType}`, eventData);
    
    // Check if alert threshold reached
    await checkAlertThresholds(eventType, details);
    
  } catch (error) {
    logger.error('Failed to track security event', { error: error.message, eventType });
  }
};

/**
 * Check if alert thresholds are exceeded
 * @param {string} eventType - Event type
 * @param {Object} details - Event details
 */
const checkAlertThresholds = async (eventType, details) => {
  try {
    if (!isRedisConnected()) return;
    
    const redis = getRedisClient();
    const now = Date.now();
    let threshold, window, severity;
    
    // Determine threshold and window based on event type
    switch (eventType) {
    case SECURITY_EVENTS.FAILED_LOGIN:
      threshold = SECURITY_MONITOR_CONFIG.FAILED_LOGIN_THRESHOLD;
      window = SECURITY_MONITOR_CONFIG.FAILED_LOGIN_WINDOW * 1000;
      severity = ALERT_SEVERITY.HIGH;
      break;
      
    case SECURITY_EVENTS.RATE_LIMIT_EXCEEDED:
      threshold = SECURITY_MONITOR_CONFIG.RATE_LIMIT_THRESHOLD;
      window = SECURITY_MONITOR_CONFIG.RATE_LIMIT_WINDOW * 1000;
      severity = ALERT_SEVERITY.MEDIUM;
      break;
      
    case SECURITY_EVENTS.CSRF_ATTACK:
      threshold = SECURITY_MONITOR_CONFIG.CSRF_ATTACK_THRESHOLD;
      window = SECURITY_MONITOR_CONFIG.CSRF_ATTACK_WINDOW * 1000;
      severity = ALERT_SEVERITY.CRITICAL;
      break;
      
    case SECURITY_EVENTS.INJECTION_ATTEMPT:
      threshold = SECURITY_MONITOR_CONFIG.INJECTION_ATTEMPT_THRESHOLD;
      window = SECURITY_MONITOR_CONFIG.INJECTION_ATTEMPT_WINDOW * 1000;
      severity = ALERT_SEVERITY.CRITICAL;
      break;
      
    case SECURITY_EVENTS.DISTRIBUTED_ATTACK:
      threshold = 1; // Alert immediately
      window = SECURITY_MONITOR_CONFIG.INJECTION_ATTEMPT_WINDOW * 1000;
      severity = ALERT_SEVERITY.CRITICAL;
      break;
      
    default:
      return; // No threshold for this event type
    }
    
    // Count events in window
    const eventKey = `${SECURITY_MONITOR_CONFIG.EVENT_KEY_PREFIX}${eventType}`;
    const windowStart = now - window;
    const eventsInWindow = await redis.zcount(eventKey, windowStart, now);
    
    // Check if threshold exceeded
    if (eventsInWindow >= threshold) {
      // Check if alert already sent recently (cooldown)
      const alertKey = `${SECURITY_MONITOR_CONFIG.ALERT_KEY_PREFIX}${eventType}`;
      const recentAlert = await redis.get(alertKey);
      
      if (!recentAlert) {
        // Trigger alert
        await triggerAlert(eventType, severity, {
          count: eventsInWindow,
          threshold,
          window: window / 1000,
          details,
        });
        
        // Set cooldown
        await redis.setex(
          alertKey,
          SECURITY_MONITOR_CONFIG.ALERT_COOLDOWN,
          now.toString()
        );
      }
    }
  } catch (error) {
    logger.error('Failed to check alert thresholds', { error: error.message, eventType });
  }
};

/**
 * Trigger security alert
 * @param {string} eventType - Event type
 * @param {string} severity - Alert severity
 * @param {Object} context - Alert context
 */
const triggerAlert = async (eventType, severity, context) => {
  try {
    const alert = {
      id: `alert-${Date.now()}`,
      type: eventType,
      severity,
      timestamp: new Date().toISOString(),
      message: generateAlertMessage(eventType, context),
      context,
    };
    
    // Log alert
    logger.error(`🚨 SECURITY ALERT [${severity.toUpperCase()}]: ${alert.message}`, alert);
    
    // Create audit log entry
    await auditLog.createAuditLog({
      category: auditLog.AUDIT_CATEGORIES.SECURITY_INCIDENT,
      action: 'security_alert_triggered',
      actor: 'system',
      actorType: 'system',
      result: auditLog.AUDIT_RESULTS.WARNING,
      details: alert,
    });
    
    // Send notifications (webhook, email, etc.)
    await sendAlertNotifications(alert);
    
  } catch (error) {
    logger.error('Failed to trigger alert', { error: error.message, eventType });
  }
};

/**
 * Generate human-readable alert message
 * @param {string} eventType - Event type
 * @param {Object} context - Alert context
 * @returns {string}
 */
const generateAlertMessage = (eventType, context) => {
  const { count, threshold, window } = context;
  
  switch (eventType) {
  case SECURITY_EVENTS.FAILED_LOGIN:
    return `High number of failed login attempts detected: ${count} attempts in ${window}s (threshold: ${threshold})`;
    
  case SECURITY_EVENTS.RATE_LIMIT_EXCEEDED:
    return `Excessive rate limit violations: ${count} violations in ${window}s (threshold: ${threshold})`;
    
  case SECURITY_EVENTS.CSRF_ATTACK:
    return `CSRF attack pattern detected: ${count} attempts in ${window}s (threshold: ${threshold})`;
    
  case SECURITY_EVENTS.INJECTION_ATTEMPT:
    return `Injection attack attempts detected: ${count} attempts in ${window}s (threshold: ${threshold})`;
    
  case SECURITY_EVENTS.DISTRIBUTED_ATTACK:
    return `Distributed attack detected: ${context.uniqueIPs} unique IPs targeting ${context.endpoint}`;
    
  default:
    return `Security event threshold exceeded for ${eventType}: ${count} events in ${window}s`;
  }
};

/**
 * Send alert notifications to configured channels
 * @param {Object} alert - Alert object
 */
const sendAlertNotifications = async (alert) => {
  try {
    // Webhook notification (if configured)
    const webhookUrl = process.env.SECURITY_ALERT_WEBHOOK;
    if (webhookUrl) {
      // In production, implement actual webhook call
      logger.info('Alert would be sent to webhook', { webhook: webhookUrl, alert });
      // await axios.post(webhookUrl, alert);
    }
    
    // Email notification (if configured)
    const alertEmail = process.env.SECURITY_ALERT_EMAIL;
    if (alertEmail) {
      // In production, implement email sending
      logger.info('Alert would be sent to email', { email: alertEmail, alert });
    }
    
    // Slack/Teams notification (if configured)
    const slackWebhook = process.env.SECURITY_ALERT_SLACK_WEBHOOK;
    if (slackWebhook) {
      logger.info('Alert would be sent to Slack', { webhook: slackWebhook, alert });
    }
    
  } catch (error) {
    logger.error('Failed to send alert notifications', { error: error.message });
  }
};

/**
 * Get security metrics for date range
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Object>}
 */
const getSecurityMetrics = async (startDate = null, endDate = null) => {
  try {
    if (!isRedisConnected()) {
      return { metrics: {}, error: 'Redis unavailable' };
    }
    
    const redis = getRedisClient();
    const start = startDate || new Date().toISOString().split('T')[0];
    const end = endDate || start;
    
    const metrics = {};
    
    // Generate date range
    const currentDate = new Date(start);
    const lastDate = new Date(end);
    
    while (currentDate <= lastDate) {
      const dateKey = currentDate.toISOString().split('T')[0];
      const metricsKey = `${SECURITY_MONITOR_CONFIG.METRICS_KEY}${dateKey}`;
      
      const dayMetrics = await redis.hgetall(metricsKey);
      if (dayMetrics && Object.keys(dayMetrics).length > 0) {
        metrics[dateKey] = dayMetrics;
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return { metrics, startDate: start, endDate: end };
  } catch (error) {
    logger.error('Failed to get security metrics', { error: error.message });
    return { metrics: {}, error: error.message };
  }
};

/**
 * Get recent security events
 * @param {string} eventType - Event type filter (optional)
 * @param {number} limit - Max results
 * @returns {Promise<Array>}
 */
const getRecentSecurityEvents = async (eventType = null, limit = 50) => {
  try {
    if (!isRedisConnected()) {
      return [];
    }
    
    const redis = getRedisClient();
    const now = Date.now();
    const windowStart = now - (3600 * 1000); // Last hour
    
    if (eventType) {
      // Get specific event type
      const eventKey = `${SECURITY_MONITOR_CONFIG.EVENT_KEY_PREFIX}${eventType}`;
      const events = await redis.zrevrangebyscore(eventKey, now, windowStart, 'LIMIT', 0, limit);
      return events.map(e => JSON.parse(e));
    } else {
      // Get all event types
      const allEvents = [];
      for (const type of Object.values(SECURITY_EVENTS)) {
        const eventKey = `${SECURITY_MONITOR_CONFIG.EVENT_KEY_PREFIX}${type}`;
        const events = await redis.zrevrangebyscore(eventKey, now, windowStart, 'LIMIT', 0, limit);
        allEvents.push(...events.map(e => JSON.parse(e)));
      }
      
      // Sort by timestamp descending
      allEvents.sort((a, b) => b.timestamp - a.timestamp);
      
      return allEvents.slice(0, limit);
    }
  } catch (error) {
    logger.error('Failed to get recent security events', { error: error.message });
    return [];
  }
};

/**
 * Get security dashboard summary
 * @returns {Promise<Object>}
 */
const getSecurityDashboard = async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const [metrics, recentEvents] = await Promise.all([
      getSecurityMetrics(today, today),
      getRecentSecurityEvents(null, 10),
    ]);
    
    return {
      date: today,
      metrics: metrics.metrics[today] || {},
      recentEvents,
      config: {
        thresholds: {
          failedLogin: SECURITY_MONITOR_CONFIG.FAILED_LOGIN_THRESHOLD,
          rateLimit: SECURITY_MONITOR_CONFIG.RATE_LIMIT_THRESHOLD,
          csrf: SECURITY_MONITOR_CONFIG.CSRF_ATTACK_THRESHOLD,
          injection: SECURITY_MONITOR_CONFIG.INJECTION_ATTEMPT_THRESHOLD,
        },
        alertCooldown: SECURITY_MONITOR_CONFIG.ALERT_COOLDOWN,
      },
    };
  } catch (error) {
    logger.error('Failed to get security dashboard', { error: error.message });
    return { error: error.message };
  }
};

/**
 * Clear all security events (for testing)
 */
const clearSecurityEvents = async () => {
  try {
    if (!isRedisConnected()) return;
    
    const redis = getRedisClient();
    
    for (const type of Object.values(SECURITY_EVENTS)) {
      const eventKey = `${SECURITY_MONITOR_CONFIG.EVENT_KEY_PREFIX}${type}`;
      await redis.del(eventKey);
    }
    
    logger.info('Security events cleared');
  } catch (error) {
    logger.error('Failed to clear security events', { error: error.message });
  }
};

module.exports = {
  trackSecurityEvent,
  getSecurityMetrics,
  getRecentSecurityEvents,
  getSecurityDashboard,
  clearSecurityEvents,
  SECURITY_EVENTS,
  ALERT_SEVERITY,
  SECURITY_MONITOR_CONFIG,
};
