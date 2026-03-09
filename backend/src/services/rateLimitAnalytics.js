/**
 * Rate Limit Analytics Service
 * 
 * Collects and analyzes rate limit events:
 * - Request patterns by endpoint
 * - Block rate by IP/user
 * - Peak usage times
 * - Violation trends
 * - Resource consumption analysis
 * 
 * Provides data-driven insights for:
 * - Capacity planning
 * - Abuse detection
 * - Rate limit optimization
 * - SLA monitoring
 */

const { getRedisClient, isRedisConnected } = require('../config/redis');
const { withCircuitBreaker } = require('./circuitBreaker');
const logger = require('../utils/logger');

/**
 * Analytics configuration
 */
const ANALYTICS_CONFIG = {
  // Redis key prefixes
  EVENTS_KEY: 'analytics:events:',
  ENDPOINT_STATS_KEY: 'analytics:endpoints:',
  IP_STATS_KEY: 'analytics:ips:',
  VIOLATIONS_KEY: 'analytics:violations:',
  TIME_SERIES_KEY: 'analytics:timeseries:',
  
  // Retention periods (seconds)
  EVENTS_RETENTION: 86400 * 7, // 7 days
  STATS_RETENTION: 86400 * 30, // 30 days
  
  // Time bucket sizes
  MINUTE_BUCKET: 60,
  HOUR_BUCKET: 3600,
  DAY_BUCKET: 86400,
};

/**
 * Record rate limit event
 * @param {Object} event - Event data
 */
const recordEvent = async (event) => {
  if (!isRedisConnected()) {
    logger.debug('Redis unavailable, skipping analytics');
    return;
  }
  
  try {
    await withCircuitBreaker(async () => {
      const redis = getRedisClient();
      const timestamp = Date.now();
      const timestampSec = Math.floor(timestamp / 1000);
      
      // Store event with expiry
      const eventKey = `${ANALYTICS_CONFIG.EVENTS_KEY}${timestamp}:${Math.random()}`;
      await redis.setex(
        eventKey,
        ANALYTICS_CONFIG.EVENTS_RETENTION,
        JSON.stringify({
          ...event,
          timestamp,
        })
      );
      
      // Update endpoint statistics
      if (event.endpoint) {
        const endpointKey = `${ANALYTICS_CONFIG.ENDPOINT_STATS_KEY}${event.endpoint}`;
        await redis.hincrby(endpointKey, 'total', 1);
        
        if (event.blocked) {
          await redis.hincrby(endpointKey, 'blocked', 1);
        }
        
        await redis.expire(endpointKey, ANALYTICS_CONFIG.STATS_RETENTION);
      }
      
      // Update IP statistics
      if (event.ip) {
        const ipKey = `${ANALYTICS_CONFIG.IP_STATS_KEY}${event.ip}`;
        await redis.hincrby(ipKey, 'total', 1);
        
        if (event.blocked) {
          await redis.hincrby(ipKey, 'blocked', 1);
          
          // Record violation
          const violationKey = `${ANALYTICS_CONFIG.VIOLATIONS_KEY}${event.ip}`;
          await redis.zadd(violationKey, timestampSec, `${timestamp}:${event.endpoint || 'unknown'}`);
          await redis.expire(violationKey, ANALYTICS_CONFIG.EVENTS_RETENTION);
        }
        
        await redis.expire(ipKey, ANALYTICS_CONFIG.STATS_RETENTION);
      }
      
      // Update time series (hourly buckets)
      const hourBucket = Math.floor(timestampSec / ANALYTICS_CONFIG.HOUR_BUCKET) * ANALYTICS_CONFIG.HOUR_BUCKET;
      const timeSeriesKey = `${ANALYTICS_CONFIG.TIME_SERIES_KEY}${hourBucket}`;
      await redis.hincrby(timeSeriesKey, 'requests', 1);
      
      if (event.blocked) {
        await redis.hincrby(timeSeriesKey, 'blocked', 1);
      }
      
      await redis.expire(timeSeriesKey, ANALYTICS_CONFIG.STATS_RETENTION);
    });
  } catch (error) {
    logger.error('Failed to record analytics event', { error: error.message });
  }
};

/**
 * Get endpoint statistics
 * @param {number} limit - Number of endpoints to return
 * @returns {Promise<Array>} Top endpoints by traffic
 */
const getEndpointStats = async (limit = 10) => {
  if (!isRedisConnected()) {
    return [];
  }
  
  try {
    return await withCircuitBreaker(async () => {
      const redis = getRedisClient();
      const keys = await redis.keys(`${ANALYTICS_CONFIG.ENDPOINT_STATS_KEY}*`);
      
      const stats = [];
      
      for (const key of keys) {
        const data = await redis.hgetall(key);
        const endpoint = key.replace(ANALYTICS_CONFIG.ENDPOINT_STATS_KEY, '');
        
        const total = parseInt(data.total || 0, 10);
        const blocked = parseInt(data.blocked || 0, 10);
        
        stats.push({
          endpoint,
          total,
          blocked,
          passed: total - blocked,
          blockRate: total > 0 ? ((blocked / total) * 100).toFixed(2) : '0.00',
        });
      }
      
      // Sort by total requests descending
      stats.sort((a, b) => b.total - a.total);
      
      return stats.slice(0, limit);
    });
  } catch (error) {
    logger.error('Failed to get endpoint stats', { error: error.message });
    return [];
  }
};

/**
 * Get IP statistics
 * @param {number} limit - Number of IPs to return
 * @returns {Promise<Array>} Top IPs by traffic
 */
const getIpStats = async (limit = 10) => {
  if (!isRedisConnected()) {
    return [];
  }
  
  try {
    return await withCircuitBreaker(async () => {
      const redis = getRedisClient();
      const keys = await redis.keys(`${ANALYTICS_CONFIG.IP_STATS_KEY}*`);
      
      const stats = [];
      
      for (const key of keys) {
        const data = await redis.hgetall(key);
        const ip = key.replace(ANALYTICS_CONFIG.IP_STATS_KEY, '');
        
        const total = parseInt(data.total || 0, 10);
        const blocked = parseInt(data.blocked || 0, 10);
        
        stats.push({
          ip,
          total,
          blocked,
          passed: total - blocked,
          blockRate: total > 0 ? ((blocked / total) * 100).toFixed(2) : '0.00',
        });
      }
      
      // Sort by total requests descending
      stats.sort((a, b) => b.total - a.total);
      
      return stats.slice(0, limit);
    });
  } catch (error) {
    logger.error('Failed to get IP stats', { error: error.message });
    return [];
  }
};

/**
 * Get violation history for IP
 * @param {string} ip - IP address
 * @param {number} limit - Number of violations to return
 * @returns {Promise<Array>} Violation history
 */
const getViolations = async (ip, limit = 50) => {
  if (!isRedisConnected()) {
    return [];
  }
  
  try {
    return await withCircuitBreaker(async () => {
      const redis = getRedisClient();
      const violationKey = `${ANALYTICS_CONFIG.VIOLATIONS_KEY}${ip}`;
      
      // Get recent violations (descending by score/timestamp)
      const violations = await redis.zrevrange(violationKey, 0, limit - 1, 'WITHSCORES');
      
      const result = [];
      for (let i = 0; i < violations.length; i += 2) {
        const [timestamp, endpoint] = violations[i].split(':');
        const score = parseInt(violations[i + 1], 10);
        
        result.push({
          timestamp: new Date(parseInt(timestamp, 10)).toISOString(),
          endpoint: endpoint || 'unknown',
          score,
        });
      }
      
      return result;
    });
  } catch (error) {
    logger.error('Failed to get violations', { error: error.message });
    return [];
  }
};

/**
 * Get time series data
 * @param {number} hours - Number of hours to retrieve
 * @returns {Promise<Array>} Time series data
 */
const getTimeSeries = async (hours = 24) => {
  if (!isRedisConnected()) {
    return [];
  }
  
  try {
    return await withCircuitBreaker(async () => {
      const redis = getRedisClient();
      const now = Math.floor(Date.now() / 1000);
      const startTime = now - (hours * 3600);
      
      const buckets = [];
      const series = [];
      
      // Generate bucket timestamps
      for (let t = startTime; t <= now; t += ANALYTICS_CONFIG.HOUR_BUCKET) {
        const bucket = Math.floor(t / ANALYTICS_CONFIG.HOUR_BUCKET) * ANALYTICS_CONFIG.HOUR_BUCKET;
        if (!buckets.includes(bucket)) {
          buckets.push(bucket);
        }
      }
      
      // Fetch data for each bucket
      for (const bucket of buckets) {
        const key = `${ANALYTICS_CONFIG.TIME_SERIES_KEY}${bucket}`;
        const data = await redis.hgetall(key);
        
        const requests = parseInt(data.requests || 0, 10);
        const blocked = parseInt(data.blocked || 0, 10);
        
        series.push({
          timestamp: new Date(bucket * 1000).toISOString(),
          timestampUnix: bucket,
          requests,
          blocked,
          passed: requests - blocked,
          blockRate: requests > 0 ? ((blocked / requests) * 100).toFixed(2) : '0.00',
        });
      }
      
      return series;
    });
  } catch (error) {
    logger.error('Failed to get time series', { error: error.message });
    return [];
  }
};

/**
 * Get overall analytics summary
 * @returns {Promise<Object>} Analytics summary
 */
const getSummary = async () => {
  if (!isRedisConnected()) {
    return {
      totalRequests: 0,
      totalBlocked: 0,
      uniqueEndpoints: 0,
      uniqueIps: 0,
    };
  }
  
  try {
    return await withCircuitBreaker(async () => {
      const redis = getRedisClient();
      
      // Count endpoints
      const endpointKeys = await redis.keys(`${ANALYTICS_CONFIG.ENDPOINT_STATS_KEY}*`);
      const ipKeys = await redis.keys(`${ANALYTICS_CONFIG.IP_STATS_KEY}*`);
      
      let totalRequests = 0;
      let totalBlocked = 0;
      
      // Sum endpoint stats
      for (const key of endpointKeys) {
        const data = await redis.hgetall(key);
        totalRequests += parseInt(data.total || 0, 10);
        totalBlocked += parseInt(data.blocked || 0, 10);
      }
      
      return {
        totalRequests,
        totalBlocked,
        totalPassed: totalRequests - totalBlocked,
        blockRate: totalRequests > 0 ? ((totalBlocked / totalRequests) * 100).toFixed(2) : '0.00',
        uniqueEndpoints: endpointKeys.length,
        uniqueIps: ipKeys.length,
      };
    });
  } catch (error) {
    logger.error('Failed to get analytics summary', { error: error.message });
    return {
      error: error.message,
      totalRequests: 0,
      totalBlocked: 0,
      uniqueEndpoints: 0,
      uniqueIps: 0,
    };
  }
};

/**
 * Get top violators
 * @param {number} limit - Number of violators to return
 * @returns {Promise<Array>} Top violators
 */
const getTopViolators = async (limit = 10) => {
  if (!isRedisConnected()) {
    return [];
  }
  
  try {
    return await withCircuitBreaker(async () => {
      const redis = getRedisClient();
      const ipStats = await getIpStats(100); // Get more for accurate sorting
      
      // Filter and sort by block rate and blocked count
      const violators = ipStats
        .filter(stat => stat.blocked > 0)
        .sort((a, b) => {
          // Sort by blocked count first, then block rate
          if (b.blocked !== a.blocked) {
            return b.blocked - a.blocked;
          }
          return parseFloat(b.blockRate) - parseFloat(a.blockRate);
        })
        .slice(0, limit);
      
      // Get recent violations for each
      for (const violator of violators) {
        violator.recentViolations = await getViolations(violator.ip, 5);
      }
      
      return violators;
    });
  } catch (error) {
    logger.error('Failed to get top violators', { error: error.message });
    return [];
  }
};

/**
 * Generate analytics report
 * @param {Object} options - Report options
 * @returns {Promise<Object>} Complete analytics report
 */
const generateReport = async (options = {}) => {
  const {
    includeEndpoints = true,
    includeIps = true,
    includeTimeSeries = true,
    includeViolators = true,
    endpointLimit = 20,
    ipLimit = 20,
    violatorLimit = 10,
    timeSeriesHours = 24,
  } = options;
  
  const report = {
    generatedAt: new Date().toISOString(),
    summary: await getSummary(),
  };
  
  if (includeEndpoints) {
    report.topEndpoints = await getEndpointStats(endpointLimit);
  }
  
  if (includeIps) {
    report.topIps = await getIpStats(ipLimit);
  }
  
  if (includeTimeSeries) {
    report.timeSeries = await getTimeSeries(timeSeriesHours);
  }
  
  if (includeViolators) {
    report.topViolators = await getTopViolators(violatorLimit);
  }
  
  return report;
};

/**
 * Clear analytics data
 * @returns {Promise<number>} Number of keys deleted
 */
const clearAnalytics = async () => {
  if (!isRedisConnected()) {
    return 0;
  }
  
  try {
    return await withCircuitBreaker(async () => {
      const redis = getRedisClient();
      const patterns = [
        `${ANALYTICS_CONFIG.EVENTS_KEY}*`,
        `${ANALYTICS_CONFIG.ENDPOINT_STATS_KEY}*`,
        `${ANALYTICS_CONFIG.IP_STATS_KEY}*`,
        `${ANALYTICS_CONFIG.VIOLATIONS_KEY}*`,
        `${ANALYTICS_CONFIG.TIME_SERIES_KEY}*`,
      ];
      
      let totalDeleted = 0;
      
      for (const pattern of patterns) {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          totalDeleted += await redis.del(...keys);
        }
      }
      
      logger.info('Analytics data cleared', { keysDeleted: totalDeleted });
      return totalDeleted;
    });
  } catch (error) {
    logger.error('Failed to clear analytics', { error: error.message });
    return 0;
  }
};

module.exports = {
  recordEvent,
  getEndpointStats,
  getIpStats,
  getViolations,
  getTimeSeries,
  getSummary,
  getTopViolators,
  generateReport,
  clearAnalytics,
  ANALYTICS_CONFIG,
};
