/**
 * HSTS (HTTP Strict Transport Security) Configuration
 * 
 * Enforces HTTPS connections and prepares for HSTS preload list inclusion
 * https://hstspreload.org/
 */

const logger = require('../utils/logger');

/**
 * HSTS Configuration Constants
 */
const HSTS_CONFIG = {
  // Maximum age in seconds (1 year for preload eligibility)
  maxAge: 31536000, // 365 days
  
  // Include all subdomains
  includeSubDomains: true,
  
  // Ready for HSTS preload list
  preload: true,
};

/**
 * Minimum max-age for HSTS preload (required by hstspreload.org)
 */
const MIN_PRELOAD_MAX_AGE = 31536000; // 1 year

/**
 * HSTS middleware
 * Sets Strict-Transport-Security header on all responses
 */
const hstsMiddleware = (req, res, next) => {
  // Only set HSTS header for HTTPS connections
  // (or if behind a trusted proxy that terminates TLS)
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  
  if (process.env.NODE_ENV === 'production') {
    if (!isSecure) {
      logger.warn('HSTS: Non-HTTPS request in production', {
        path: req.path,
        ip: req.ip,
        protocol: req.protocol,
        forwardedProto: req.headers['x-forwarded-proto'],
      });
    }
    
    // Always set HSTS in production (header should be set on HTTPS)
    setHstsHeader(res);
  } else if (isSecure) {
    // In development, only set HSTS if connection is secure
    setHstsHeader(res);
  }
  
  next();
};

/**
 * Set HSTS header on response
 * @param {Response} res - Express response object
 */
const setHstsHeader = (res) => {
  const directives = [`max-age=${HSTS_CONFIG.maxAge}`];
  
  if (HSTS_CONFIG.includeSubDomains) {
    directives.push('includeSubDomains');
  }
  
  if (HSTS_CONFIG.preload) {
    directives.push('preload');
  }
  
  res.setHeader('Strict-Transport-Security', directives.join('; '));
};

/**
 * Redirect HTTP to HTTPS in production
 * Should be applied before other middleware
 */
const enforceHttpsRedirect = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }
  
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  
  if (!isSecure) {
    logger.info('Redirecting HTTP to HTTPS', {
      path: req.path,
      ip: req.ip,
      method: req.method,
    });
    
    // Construct HTTPS URL
    const host = req.headers.host || process.env.HOST || 'localhost';
    const httpsUrl = `https://${host}${req.url}`;
    
    // Use 301 (Permanent Redirect) for GET requests
    // Use 307 (Temporary Redirect) for POST/PUT/DELETE to preserve method
    const statusCode = req.method === 'GET' ? 301 : 307;
    
    return res.redirect(statusCode, httpsUrl);
  }
  
  next();
};

/**
 * Validate HSTS configuration
 * Checks if configuration meets preload requirements
 * 
 * @returns {Object} Validation result
 */
const validateHstsConfig = () => {
  const errors = [];
  const warnings = [];
  
  // Check max-age
  if (HSTS_CONFIG.maxAge < MIN_PRELOAD_MAX_AGE) {
    errors.push(
      `HSTS max-age (${HSTS_CONFIG.maxAge}s) is less than required for preload (${MIN_PRELOAD_MAX_AGE}s)`
    );
  }
  
  // Check includeSubDomains
  if (!HSTS_CONFIG.includeSubDomains) {
    errors.push('HSTS preload requires includeSubDomains directive');
  }
  
  // Check preload
  if (!HSTS_CONFIG.preload) {
    warnings.push('HSTS preload directive is not set');
  }
  
  // Check if running on HTTPS in production
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.HTTPS && !process.env.TLS_CERT) {
      warnings.push('No HTTPS/TLS configuration detected in production environment');
    }
  }
  
  return {
    valid: errors.length === 0,
    eligible: errors.length === 0 && warnings.length === 0,
    errors,
    warnings,
    config: HSTS_CONFIG,
  };
};

/**
 * Log HSTS configuration on startup
 */
const logHstsConfiguration = () => {
  const validation = validateHstsConfig();
  
  logger.info('HSTS Configuration', {
    maxAge: `${HSTS_CONFIG.maxAge}s (${Math.floor(HSTS_CONFIG.maxAge / 86400)} days)`,
    includeSubDomains: HSTS_CONFIG.includeSubDomains,
    preload: HSTS_CONFIG.preload,
    eligible: validation.eligible,
    environment: process.env.NODE_ENV,
  });
  
  if (validation.errors.length > 0) {
    logger.error('HSTS configuration errors', { errors: validation.errors });
  }
  
  if (validation.warnings.length > 0) {
    logger.warn('HSTS configuration warnings', { warnings: validation.warnings });
  }
  
  if (validation.eligible) {
    logger.info('HSTS configuration meets preload requirements');
    logger.info('To submit for preload: https://hstspreload.org/');
  }
};

/**
 * Check if domain is eligible for HSTS preload
 * 
 * Requirements:
 * 1. Serve a valid certificate
 * 2. Redirect from HTTP to HTTPS (at least on same host)
 * 3. Serve all subdomains over HTTPS
 * 4. Serve HSTS header on base domain:
 *    - max-age >= 31536000 (1 year)
 *    - includeSubDomains directive
 *    - preload directive
 * 
 * @returns {Object} Eligibility check result
 */
const checkPreloadEligibility = () => {
  const validation = validateHstsConfig();
  const requirements = {
    hstsHeader: validation.valid,
    httpsRedirect: process.env.NODE_ENV === 'production',
    validCertificate: process.env.NODE_ENV === 'production' && (process.env.TLS_CERT || process.env.HTTPS),
    maxAgeRequirement: HSTS_CONFIG.maxAge >= MIN_PRELOAD_MAX_AGE,
    includeSubDomainsDirective: HSTS_CONFIG.includeSubDomains,
    preloadDirective: HSTS_CONFIG.preload,
  };
  
  const eligible = Object.values(requirements).every(req => req === true);
  
  return {
    eligible,
    requirements,
    nextSteps: eligible
      ? [
          'Test your domain at https://hstspreload.org/',
          'Submit your domain to the HSTS preload list',
          'Wait for inclusion in browser preload lists (can take months)',
        ]
      : [
          'Fix configuration issues listed above',
          'Ensure HTTPS is working correctly',
          'Test HSTS headers are being sent',
          'Re-run eligibility check',
        ],
  };
};

/**
 * Get HSTS status for health checks
 * 
 * @returns {Object} HSTS status
 */
const getHstsStatus = () => {
  const validation = validateHstsConfig();
  const eligibility = checkPreloadEligibility();
  
  return {
    enabled: true,
    config: HSTS_CONFIG,
    valid: validation.valid,
    preloadEligible: eligibility.eligible,
    errors: validation.errors,
    warnings: validation.warnings,
  };
};

module.exports = {
  hstsMiddleware,
  enforceHttpsRedirect,
  validateHstsConfig,
  logHstsConfiguration,
  checkPreloadEligibility,
  getHstsStatus,
  HSTS_CONFIG,
};
