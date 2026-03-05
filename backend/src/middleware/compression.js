/**
 * Response Compression Middleware
 * 
 * Implements intelligent response compression:
 * - Gzip compression for broad compatibility
 * - Brotli compression for modern browsers (better compression ratio)
 * - Selective compression based on content type and size
 * - Performance optimized with caching and thresholds
 * 
 * Reduces bandwidth usage and improves response times.
 */

const compression = require('compression');
const zlib = require('zlib');
const logger = require('../utils/logger');

/**
 * Compression configuration
 */
const COMPRESSION_CONFIG = {
  // Minimum response size to compress (1KB)
  THRESHOLD: 1024,
  
  // Compression level (0-9, higher = better compression but slower)
  GZIP_LEVEL: 6,
  BROTLI_QUALITY: 4,
  
  // Memory level for gzip (1-9, higher uses more memory)
  GZIP_MEMORY_LEVEL: 8,
  
  // Window size for gzip (9-15, higher = better compression)
  GZIP_WINDOW_BITS: 15,
};

/**
 * Content types that should be compressed
 * Text-based formats benefit most from compression
 */
const COMPRESSIBLE_TYPES = [
  'text/html',
  'text/css',
  'text/plain',
  'text/xml',
  'text/javascript',
  'application/json',
  'application/javascript',
  'application/xml',
  'application/xml+rss',
  'application/xhtml+xml',
  'application/atom+xml',
  'application/ld+json',
  'application/manifest+json',
  'application/vnd.api+json',
  'image/svg+xml',
  'font/woff',
  'font/woff2',
];

/**
 * Check if content type should be compressed
 * @param {string} contentType - Content-Type header value
 * @returns {boolean} True if should compress
 */
const shouldCompress = (contentType) => {
  if (!contentType) {
    return false;
  }
  
  const type = contentType.split(';')[0].trim().toLowerCase();
  return COMPRESSIBLE_TYPES.includes(type);
};

/**
 * Custom filter function for compression
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {boolean} True if should compress
 */
const compressionFilter = (req, res) => {
  // Don't compress if explicitly disabled
  if (req.headers['x-no-compression']) {
    return false;
  }
  
  // Check if request accepts compressed response
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip') && !acceptEncoding.includes('br')) {
    return false;
  }
  
  // Check content type
  const contentType = res.getHeader('Content-Type');
  if (!shouldCompress(contentType)) {
    return false;
  }
  
  // Check cache-control (don't compress if no-transform)
  const cacheControl = res.getHeader('Cache-Control');
  if (cacheControl && cacheControl.includes('no-transform')) {
    return false;
  }
  
  return true;
};

/**
 * Brotli compression middleware
 * Uses higher quality compression for better results
 */
const brotliMiddleware = (req, res, next) => {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  
  // Only use brotli if client supports it
  if (!acceptEncoding.includes('br')) {
    return next();
  }
  
  // Store original methods
  const originalWrite = res.write;
  const originalEnd = res.end;
  const originalSetHeader = res.setHeader;
  
  let compressed = false;
  let buffer = Buffer.alloc(0);
  
  // Override setHeader to intercept content-type
  res.setHeader = function (name, value) {
    originalSetHeader.call(this, name, value);
    
    // Check if we should compress based on content type
    if (name.toLowerCase() === 'content-type') {
      compressed = shouldCompress(value);
    }
  };
  
  // Override write to buffer data
  res.write = function (chunk, encoding) {
    if (compressed && chunk) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      buffer = Buffer.concat([buffer, data]);
      return true;
    }
    return originalWrite.call(this, chunk, encoding);
  };
  
  // Override end to compress and send
  res.end = function (chunk, encoding) {
    if (compressed) {
      if (chunk) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        buffer = Buffer.concat([buffer, data]);
      }
      
      // Only compress if above threshold
      if (buffer.length >= COMPRESSION_CONFIG.THRESHOLD) {
        try {
          const compressed = zlib.brotliCompressSync(buffer, {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: COMPRESSION_CONFIG.BROTLI_QUALITY,
              [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
            },
          });
          
          res.setHeader('Content-Encoding', 'br');
          res.setHeader('Content-Length', compressed.length);
          res.removeHeader('Content-Length'); // Let Express calculate
          
          logger.debug('Brotli compressed response', {
            original: buffer.length,
            compressed: compressed.length,
            ratio: ((1 - compressed.length / buffer.length) * 100).toFixed(1) + '%',
          });
          
          return originalEnd.call(res, compressed);
        } catch (error) {
          logger.error('Brotli compression failed', { error: error.message });
          return originalEnd.call(res, buffer);
        }
      }
      
      return originalEnd.call(res, buffer);
    }
    
    return originalEnd.call(res, chunk, encoding);
  };
  
  next();
};

/**
 * Create compression middleware with optimal configuration
 * @returns {Function} Express middleware
 */
const createCompressionMiddleware = () => {
  return compression({
    filter: compressionFilter,
    threshold: COMPRESSION_CONFIG.THRESHOLD,
    level: COMPRESSION_CONFIG.GZIP_LEVEL,
    memLevel: COMPRESSION_CONFIG.GZIP_MEMORY_LEVEL,
    windowBits: COMPRESSION_CONFIG.GZIP_WINDOW_BITS,
    strategy: zlib.constants.Z_DEFAULT_STRATEGY,
    chunkSize: 16 * 1024, // 16KB chunks
  });
};

/**
 * Log compression configuration
 */
const logCompressionConfiguration = () => {
  logger.info('Response Compression Configuration', {
    threshold: `${COMPRESSION_CONFIG.THRESHOLD} bytes`,
    gzipLevel: COMPRESSION_CONFIG.GZIP_LEVEL,
    brotliQuality: COMPRESSION_CONFIG.BROTLI_QUALITY,
    compressibleTypes: COMPRESSIBLE_TYPES.length,
  });
};

/**
 * Get compression statistics from response
 * @param {Object} res - Express response
 * @returns {Object} Compression stats
 */
const getCompressionStats = (res) => {
  const encoding = res.getHeader('Content-Encoding');
  const length = res.getHeader('Content-Length');
  
  return {
    enabled: !!encoding,
    encoding: encoding || 'none',
    size: length || 0,
  };
};

module.exports = {
  createCompressionMiddleware,
  brotliMiddleware,
  compressionFilter,
  shouldCompress,
  logCompressionConfiguration,
  getCompressionStats,
  COMPRESSION_CONFIG,
  COMPRESSIBLE_TYPES,
};
