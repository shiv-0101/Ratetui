/**
 * Metrics Service
 * 
 * Handles collection and aggregation of system metrics including:
 * - Request counts (total, allowed, blocked)
 * - Active rate limit rules
 * - Request distribution by endpoint, IP, and time
 * - Performance metrics
 */

const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

const METRICS_PREFIX = 'metrics:';
const METRICS_TIMESERIES_PREFIX = 'metrics:ts:';
const METRICS_COUNTER_PREFIX = 'metrics:counter:';

/**
 * Record a request event
 * @param {Object} event - Event details
 * @param {string} event.type - Event type (request, allowed, blocked)
 * @param {string} event.endpoint - Endpoint path
 * @param {string} event.ip - Client IP
 * @param {string} [event.userId] - User ID if authenticated
 * @param {string} [event.ruleId] - Rule ID that triggered the limit
 * @param {number} [event.responseTime] - Response time in ms
 */
async function recordEvent(event) {
  const redis = getRedisClient();
  const timestamp = Date.now();
  const hour = Math.floor(timestamp / 3600000); // Hour bucket
  const day = Math.floor(timestamp / 86400000); // Day bucket
  
  const pipeline = redis.pipeline();
  
  // Increment global counters
  pipeline.hincrby(`${METRICS_COUNTER_PREFIX}global`, event.type, 1);
  pipeline.hincrby(`${METRICS_COUNTER_PREFIX}global`, 'total', 1);
  
  // Increment hourly counters
  pipeline.hincrby(`${METRICS_TIMESERIES_PREFIX}hour:${hour}`, event.type, 1);
  pipeline.hincrby(`${METRICS_TIMESERIES_PREFIX}hour:${hour}`, 'total', 1);
  pipeline.expire(`${METRICS_TIMESERIES_PREFIX}hour:${hour}`, 172800); // 48 hours
  
  // Increment daily counters
  pipeline.hincrby(`${METRICS_TIMESERIES_PREFIX}day:${day}`, event.type, 1);
  pipeline.hincrby(`${METRICS_TIMESERIES_PREFIX}day:${day}`, 'total', 1);
  pipeline.expire(`${METRICS_TIMESERIES_PREFIX}day:${day}`, 2592000); // 30 days
  
  // Track endpoint-specific metrics
  if (event.endpoint) {
    const endpointKey = `${METRICS_COUNTER_PREFIX}endpoint:${event.endpoint}`;
    pipeline.hincrby(endpointKey, event.type, 1);
    pipeline.hincrby(endpointKey, 'total', 1);
    pipeline.expire(endpointKey, 604800); // 7 days
  }
  
  // Track IP-specific metrics
  if (event.ip) {
    const ipKey = `${METRICS_COUNTER_PREFIX}ip:${event.ip}`;
    pipeline.hincrby(ipKey, event.type, 1);
    pipeline.hincrby(ipKey, 'total', 1);
    pipeline.expire(ipKey, 604800); // 7 days
  }
  
  // Track rule-specific metrics
  if (event.ruleId) {
    const ruleKey = `${METRICS_COUNTER_PREFIX}rule:${event.ruleId}`;
    pipeline.hincrby(ruleKey, 'triggered', 1);
    pipeline.expire(ruleKey, 604800); // 7 days
  }
  
  // Track response times
  if (event.responseTime !== undefined) {
    pipeline.lpush(`${METRICS_PREFIX}response_times`, event.responseTime);
    pipeline.ltrim(`${METRICS_PREFIX}response_times`, 0, 999); // Keep last 1000
  }
  
  await pipeline.exec();
}

/**
 * Get global metrics summary
 * @returns {Promise<Object>} Global metrics
 */
async function getGlobalMetrics() {
  const redis = getRedisClient();
  const counters = await redis.hgetall(`${METRICS_COUNTER_PREFIX}global`);
  
  return {
    total: parseInt(counters.total || 0),
    allowed: parseInt(counters.allowed || 0),
    blocked: parseInt(counters.blocked || 0),
    requests: parseInt(counters.request || 0),
  };
}

/**
 * Get time-series metrics
 * @param {string} period - Period type (hour, day)
 * @param {number} count - Number of periods to retrieve
 * @returns {Promise<Array>} Time-series data
 */
async function getTimeSeriesMetrics(period = 'hour', count = 24) {
  const redis = getRedisClient();
  const timestamp = Date.now();
  const divisor = period === 'hour' ? 3600000 : 86400000;
  const current = Math.floor(timestamp / divisor);
  
  const pipeline = redis.pipeline();
  const buckets = [];
  
  for (let i = count - 1; i >= 0; i--) {
    const bucket = current - i;
    buckets.push(bucket);
    pipeline.hgetall(`${METRICS_TIMESERIES_PREFIX}${period}:${bucket}`);
  }
  
  const results = await pipeline.exec();
  
  return buckets.map((bucket, index) => {
    const data = results[index][1] || {};
    return {
      timestamp: bucket * divisor,
      period: bucket,
      total: parseInt(data.total || 0),
      allowed: parseInt(data.allowed || 0),
      blocked: parseInt(data.blocked || 0),
      requests: parseInt(data.request || 0),
    };
  });
}

/**
 * Get endpoint-specific metrics
 * @param {string} endpoint - Endpoint path
 * @returns {Promise<Object>} Endpoint metrics
 */
async function getEndpointMetrics(endpoint) {
  const redis = getRedisClient();
  const key = `${METRICS_COUNTER_PREFIX}endpoint:${endpoint}`;
  const data = await redis.hgetall(key);
  
  return {
    endpoint,
    total: parseInt(data.total || 0),
    allowed: parseInt(data.allowed || 0),
    blocked: parseInt(data.blocked || 0),
    requests: parseInt(data.request || 0),
  };
}

/**
 * Get top endpoints by request count
 * @param {number} limit - Number of top endpoints to return
 * @returns {Promise<Array>} Top endpoints
 */
async function getTopEndpoints(limit = 10) {
  const redis = getRedisClient();
  const pattern = `${METRICS_COUNTER_PREFIX}endpoint:*`;
  const keys = await redis.keys(pattern);
  
  if (keys.length === 0) return [];
  
  const pipeline = redis.pipeline();
  keys.forEach(key => pipeline.hgetall(key));
  
  const results = await pipeline.exec();
  const endpoints = keys.map((key, index) => {
    const endpoint = key.replace(`${METRICS_COUNTER_PREFIX}endpoint:`, '');
    const data = results[index][1] || {};
    return {
      endpoint,
      total: parseInt(data.total || 0),
      allowed: parseInt(data.allowed || 0),
      blocked: parseInt(data.blocked || 0),
    };
  });
  
  return endpoints
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * Get IP-specific metrics
 * @param {string} ip - IP address
 * @returns {Promise<Object>} IP metrics
 */
async function getIPMetrics(ip) {
  const redis = getRedisClient();
  const key = `${METRICS_COUNTER_PREFIX}ip:${ip}`;
  const data = await redis.hgetall(key);
  
  return {
    ip,
    total: parseInt(data.total || 0),
    allowed: parseInt(data.allowed || 0),
    blocked: parseInt(data.blocked || 0),
    requests: parseInt(data.request || 0),
  };
}

/**
 * Get top IPs by request count
 * @param {number} limit - Number of top IPs to return
 * @returns {Promise<Array>} Top IPs
 */
async function getTopIPs(limit = 10) {
  const redis = getRedisClient();
  const pattern = `${METRICS_COUNTER_PREFIX}ip:*`;
  const keys = await redis.keys(pattern);
  
  if (keys.length === 0) return [];
  
  const pipeline = redis.pipeline();
  keys.forEach(key => pipeline.hgetall(key));
  
  const results = await pipeline.exec();
  const ips = keys.map((key, index) => {
    const ip = key.replace(`${METRICS_COUNTER_PREFIX}ip:`, '');
    const data = results[index][1] || {};
    return {
      ip,
      total: parseInt(data.total || 0),
      allowed: parseInt(data.allowed || 0),
      blocked: parseInt(data.blocked || 0),
    };
  });
  
  return ips
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * Get rule-specific metrics
 * @param {string} ruleId - Rule ID
 * @returns {Promise<Object>} Rule metrics
 */
async function getRuleMetrics(ruleId) {
  const redis = getRedisClient();
  const key = `${METRICS_COUNTER_PREFIX}rule:${ruleId}`;
  const data = await redis.hgetall(key);
  
  return {
    ruleId,
    triggered: parseInt(data.triggered || 0),
  };
}

/**
 * Get average response time
 * @returns {Promise<number>} Average response time in ms
 */
async function getAverageResponseTime() {
  const redis = getRedisClient();
  const times = await redis.lrange(`${METRICS_PREFIX}response_times`, 0, 999);
  
  if (times.length === 0) return 0;
  
  const sum = times.reduce((acc, time) => acc + parseFloat(time), 0);
  return Math.round(sum / times.length);
}

/**
 * Get response time percentiles
 * @returns {Promise<Object>} Response time percentiles
 */
async function getResponseTimePercentiles() {
  const redis = getRedisClient();
  const times = await redis.lrange(`${METRICS_PREFIX}response_times`, 0, 999);
  
  if (times.length === 0) {
    return { p50: 0, p95: 0, p99: 0 };
  }
  
  const sorted = times.map(t => parseFloat(t)).sort((a, b) => a - b);
  const len = sorted.length;
  
  return {
    p50: sorted[Math.floor(len * 0.5)],
    p95: sorted[Math.floor(len * 0.95)],
    p99: sorted[Math.floor(len * 0.99)],
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / len),
  };
}

/**
 * Reset all metrics
 * @returns {Promise<void>}
 */
async function resetMetrics() {
  const redis = getRedisClient();
  
  // Get all metrics keys
  const patterns = [
    `${METRICS_PREFIX}*`,
    `${METRICS_TIMESERIES_PREFIX}*`,
    `${METRICS_COUNTER_PREFIX}*`,
  ];
  
  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
  
  logger.info('All metrics reset');
}

/**
 * Get comprehensive metrics summary
 * @returns {Promise<Object>} Complete metrics summary
 */
async function getMetricsSummary() {
  const [
    global,
    hourly,
    daily,
    topEndpoints,
    topIPs,
    responseTime,
  ] = await Promise.all([
    getGlobalMetrics(),
    getTimeSeriesMetrics('hour', 24),
    getTimeSeriesMetrics('day', 7),
    getTopEndpoints(10),
    getTopIPs(10),
    getResponseTimePercentiles(),
  ]);
  
  return {
    global,
    timeSeries: {
      hourly,
      daily,
    },
    topEndpoints,
    topIPs,
    performance: responseTime,
    timestamp: Date.now(),
  };
}

module.exports = {
  recordEvent,
  getGlobalMetrics,
  getTimeSeriesMetrics,
  getEndpointMetrics,
  getTopEndpoints,
  getIPMetrics,
  getTopIPs,
  getRuleMetrics,
  getAverageResponseTime,
  getResponseTimePercentiles,
  resetMetrics,
  getMetricsSummary,
};
