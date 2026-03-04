/**
 * Advanced Metrics Collection Service
 * 
 * Collects and exposes comprehensive system metrics:
 * - Request latency (p50, p95, p99)
 * - Rate limit hits and misses
 * - Authentication success/failure rates
 * - Error rates by type
 * - Redis performance metrics
 * - System health indicators
 * 
 * Format compatible with Prometheus scraping.
 */

const { getRedisClient, isRedisConnected } = require('../config/redis');
const logger = require('../utils/logger');
const os = require('os');

/**
 * Configuration
 */
const METRICS_CONFIG = {
  // Redis keys
  METRICS_KEY_PREFIX: 'metrics:',
  HISTOGRAM_KEY_PREFIX: 'metrics:histogram:',
  COUNTER_KEY_PREFIX: 'metrics:counter:',
  
  // Retention
  RETENTION_SECONDS: 86400, // 24 hours
  
  // Histogram buckets (latency in ms)
  LATENCY_BUCKETS: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
};

/**
 * Metric types
 */
const METRIC_TYPES = {
  COUNTER: 'counter',
  GAUGE: 'gauge',
  HISTOGRAM: 'histogram',
};

/**
 * In-memory metrics store (for current process)
 */
const metricsStore = {
  counters: new Map(),
  gauges: new Map(),
  histograms: new Map(),
  startTime: Date.now(),
};

/**
 * Initialize histogram for a metric
 * @param {string} name - Metric name
 */
const initHistogram = (name) => {
  if (!metricsStore.histograms.has(name)) {
    metricsStore.histograms.set(name, {
      samples: [],
      sum: 0,
      count: 0,
      buckets: new Map(METRICS_CONFIG.LATENCY_BUCKETS.map(b => [b, 0])),
    });
  }
};

/**
 * Increment counter
 * @param {string} name - Counter name
 * @param {number} value - Increment value (default: 1)
 * @param {Object} labels - Labels
 */
const incrementCounter = (name, value = 1, labels = {}) => {
  const key = `${name}${JSON.stringify(labels)}`;
  const current = metricsStore.counters.get(key) || { name, labels, value: 0 };
  current.value += value;
  metricsStore.counters.set(key, current);
};

/**
 * Set gauge value
 * @param {string} name - Gauge name
 * @param {number} value - Gauge value
 * @param {Object} labels - Labels
 */
const setGauge = (name, value, labels = {}) => {
  const key = `${name}${JSON.stringify(labels)}`;
  metricsStore.gauges.set(key, { name, labels, value });
};

/**
 * Record histogram observation
 * @param {string} name - Histogram name
 * @param {number} value - Observed value
 * @param {Object} labels - Labels
 */
const observeHistogram = (name, value, labels = {}) => {
  const key = `${name}${JSON.stringify(labels)}`;
  
  if (!metricsStore.histograms.has(key)) {
    metricsStore.histograms.set(key, {
      name,
      labels,
      samples: [],
      sum: 0,
      count: 0,
      buckets: new Map(METRICS_CONFIG.LATENCY_BUCKETS.map(b => [b, 0])),
    });
  }
  
  const histogram = metricsStore.histograms.get(key);
  histogram.samples.push(value);
  histogram.sum += value;
  histogram.count++;
  
  // Update buckets
  for (const [bucket, ] of histogram.buckets) {
    if (value <= bucket) {
      histogram.buckets.set(bucket, histogram.buckets.get(bucket) + 1);
    }
  }
  
  // Keep only last 1000 samples
  if (histogram.samples.length > 1000) {
    histogram.samples = histogram.samples.slice(-1000);
  }
};

/**
 * Calculate percentile from samples
 * @param {Array} samples - Sorted sample array
 * @param {number} percentile - Percentile (0-1)
 * @returns {number}
 */
const calculatePercentile = (samples, percentile) => {
  if (samples.length === 0) return 0;
  
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * percentile) - 1;
  return sorted[Math.max(0, index)];
};

/**
 * Record request metrics
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {number} duration - Request duration in ms
 */
const recordRequest = (req, res, duration) => {
  const method = req.method;
  const path = req.route?.path || req.path;
  const status = res.statusCode;
  const statusClass = `${Math.floor(status / 100)}xx`;
  
  // Increment request counter
  incrementCounter('http_requests_total', 1, { method, path, status: statusClass });
  
  // Record latency histogram
  observeHistogram('http_request_duration_ms', duration, { method, path });
  
  // Record response size if available
  const contentLength = res.get('content-length');
  if (contentLength) {
    observeHistogram('http_response_size_bytes', parseInt(contentLength, 10), { method, path });
  }
};

/**
 * Record rate limit event
 * @param {string} type - Event type (hit/miss/blocked)
 * @param {string} identifier - Client identifier
 * @param {string} endpoint - Endpoint
 */
const recordRateLimit = (type, identifier, endpoint) => {
  incrementCounter('rate_limit_events_total', 1, { type, endpoint });
};

/**
 * Record authentication event
 * @param {string} type - Event type (success/failure)
 * @param {string} method - Auth method (jwt/api_key)
 */
const recordAuth = (type, method) => {
  incrementCounter('auth_events_total', 1, { type, method });
};

/**
 * Record error
 * @param {string} type - Error type
 * @param {string} code - Error code
 */
const recordError = (type, code) => {
  incrementCounter('errors_total', 1, { type, code });
};

/**
 * Get system metrics
 * @returns {Object} System metrics
 */
const getSystemMetrics = () => {
  const uptime = (Date.now() - metricsStore.startTime) / 1000;
  
  return {
    process_uptime_seconds: uptime,
    process_heap_bytes: process.memoryUsage().heapUsed,
    process_heap_total_bytes: process.memoryUsage().heapTotal,
    process_external_bytes: process.memoryUsage().external,
    process_rss_bytes: process.memoryUsage().rss,
    nodejs_version: process.version,
    cpu_count: os.cpus().length,
    os_platform: os.platform(),
    os_type: os.type(),
    os_free_memory_bytes: os.freemem(),
    os_total_memory_bytes: os.totalmem(),
    os_load_average_1m: os.loadavg()[0],
    os_load_average_5m: os.loadavg()[1],
    os_load_average_15m: os.loadavg()[2],
  };
};

/**
 * Get Redis metrics
 * @returns {Promise<Object>} Redis metrics
 */
const getRedisMetrics = async () => {
  if (!isRedisConnected()) {
    return {
      redis_connected: 0,
      redis_ping_latency_ms: -1,
    };
  }
  
  try {
    const redis = getRedisClient();
    const start = Date.now();
    await redis.ping();
    const latency = Date.now() - start;
    
    // Get Redis info
    const info = await redis.info();
    const infoLines = info.split('\r\n');
    const redisInfo = {};
    
    for (const line of infoLines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        redisInfo[key] = value;
      }
    }
    
    return {
      redis_connected: 1,
      redis_ping_latency_ms: latency,
      redis_used_memory_bytes: parseInt(redisInfo.used_memory || 0, 10),
      redis_connected_clients: parseInt(redisInfo.connected_clients || 0, 10),
      redis_total_commands_processed: parseInt(redisInfo.total_commands_processed || 0, 10),
      redis_total_connections_received: parseInt(redisInfo.total_connections_received || 0, 10),
    };
  } catch (error) {
    logger.error('Failed to get Redis metrics', { error: error.message });
    return {
      redis_connected: 0,
      redis_ping_latency_ms: -1,
    };
  }
};

/**
 * Export metrics in Prometheus format
 * @returns {Promise<string>} Prometheus-formatted metrics
 */
const exportPrometheusMetrics = async () => {
  const lines = [];
  
  // Add metadata
  lines.push('# HELP http_requests_total Total HTTP requests');
  lines.push('# TYPE http_requests_total counter');
  
  // Export counters
  for (const [, metric] of metricsStore.counters) {
    const labels = Object.entries(metric.labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    lines.push(`${metric.name}{${labels}} ${metric.value}`);
  }
  
  // Export gauges
  for (const [, metric] of metricsStore.gauges) {
    const labels = Object.entries(metric.labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    lines.push(`${metric.name}{${labels}} ${metric.value}`);
  }
  
  // Export histograms
  for (const [, histogram] of metricsStore.histograms) {
    const labels = Object.entries(histogram.labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    const baseLabels = labels ? `{${labels}}` : '';
    
    lines.push(`# HELP ${histogram.name} Request duration histogram`);
    lines.push(`# TYPE ${histogram.name} histogram`);
    
    // Export buckets
    for (const [bucket, count] of histogram.buckets) {
      const bucketLabels = labels ? `${labels},le="${bucket}"` : `le="${bucket}"`;
      lines.push(`${histogram.name}_bucket{${bucketLabels}} ${count}`);
    }
    
    // Export sum and count
    lines.push(`${histogram.name}_sum${baseLabels} ${histogram.sum}`);
    lines.push(`${histogram.name}_count${baseLabels} ${histogram.count}`);
  }
  
  // Export system metrics
  const systemMetrics = getSystemMetrics();
  for (const [name, value] of Object.entries(systemMetrics)) {
    if (typeof value === 'number') {
      lines.push(`${name} ${value}`);
    } else {
      lines.push(`${name}{value="${value}"} 1`);
    }
  }
  
  // Export Redis metrics
  const redisMetrics = await getRedisMetrics();
  for (const [name, value] of Object.entries(redisMetrics)) {
    lines.push(`${name} ${value}`);
  }
  
  return lines.join('\n') + '\n';
};

/**
 * Export metrics in JSON format
 * @returns {Promise<Object>} JSON metrics
 */
const exportJsonMetrics = async () => {
  const counters = {};
  for (const [, metric] of metricsStore.counters) {
    const key = `${metric.name}${JSON.stringify(metric.labels)}`;
    counters[key] = { name: metric.name, labels: metric.labels, value: metric.value };
  }
  
  const gauges = {};
  for (const [, metric] of metricsStore.gauges) {
    const key = `${metric.name}${JSON.stringify(metric.labels)}`;
    gauges[key] = { name: metric.name, labels: metric.labels, value: metric.value };
  }
  
  const histograms = {};
  for (const [, histogram] of metricsStore.histograms) {
    const key = `${histogram.name}${JSON.stringify(histogram.labels)}`;
    histograms[key] = {
      name: histogram.name,
      labels: histogram.labels,
      count: histogram.count,
      sum: histogram.sum,
      mean: histogram.count > 0 ? histogram.sum / histogram.count : 0,
      p50: calculatePercentile(histogram.samples, 0.50),
      p95: calculatePercentile(histogram.samples, 0.95),
      p99: calculatePercentile(histogram.samples, 0.99),
    };
  }
  
  return {
    timestamp: new Date().toISOString(),
    counters,
    gauges,
    histograms,
    system: getSystemMetrics(),
    redis: await getRedisMetrics(),
  };
};

/**
 * Reset all metrics
 */
const resetMetrics = () => {
  metricsStore.counters.clear();
  metricsStore.gauges.clear();
  metricsStore.histograms.clear();
  logger.info('Metrics reset');
};

/**
 * Metrics middleware
 * Records request metrics automatically
 */
const metricsMiddleware = (req, res, next) => {
  const start = Date.now();
  
  // Capture response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    recordRequest(req, res, duration);
  });
  
  next();
};

module.exports = {
  incrementCounter,
  setGauge,
  observeHistogram,
  recordRequest,
  recordRateLimit,
  recordAuth,
  recordError,
  getSystemMetrics,
  getRedisMetrics,
  exportPrometheusMetrics,
  exportJsonMetrics,
  resetMetrics,
  metricsMiddleware,
  METRIC_TYPES,
  METRICS_CONFIG,
};
