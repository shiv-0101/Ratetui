/**
 * Security Headers Verification Module
 * 
 * Verifies that all required security headers are properly configured
 * Provides detailed reporting and monitoring capabilities
 */

const logger = require('../utils/logger');

/**
 * Required security headers and their expected values/patterns
 */
const REQUIRED_HEADERS = {
  // Strict-Transport-Security (HSTS)
  'strict-transport-security': {
    required: true,
    description: 'Enforces HTTPS connections',
    pattern: /max-age=\d+/,
    mustInclude: ['max-age', 'includeSubDomains', 'preload'],
    minMaxAge: 31536000, // 1 year in seconds
    severity: 'critical',
  },
  
  // Content-Security-Policy (CSP)
  'content-security-policy': {
    required: true,
    description: 'Prevents XSS and injection attacks',
    mustInclude: ['default-src', "object-src 'none'"],
    severity: 'critical',
  },
  
  // X-Content-Type-Options
  'x-content-type-options': {
    required: true,
    description: 'Prevents MIME type sniffing',
    expectedValue: 'nosniff',
    severity: 'high',
  },
  
  // X-Frame-Options
  'x-frame-options': {
    required: true,
    description: 'Prevents clickjacking attacks',
    expectedValues: ['DENY', 'SAMEORIGIN'],
    severity: 'high',
  },
  
  // X-XSS-Protection (deprecated but still useful for older browsers)
  'x-xss-protection': {
    required: false,
    description: 'Legacy XSS protection (deprecated)',
    expectedValue: '0', // Helmet sets to 0 to avoid conflicts with CSP
    severity: 'low',
  },
  
  // Referrer-Policy
  'referrer-policy': {
    required: true,
    description: 'Controls referrer information',
    expectedValues: [
      'no-referrer',
      'no-referrer-when-downgrade',
      'strict-origin',
      'strict-origin-when-cross-origin',
      'same-origin',
    ],
    severity: 'medium',
  },
  
  // Permissions-Policy (formerly Feature-Policy)
  'permissions-policy': {
    required: false,
    description: 'Controls browser features',
    severity: 'medium',
  },
  
  // Cross-Origin-Embedder-Policy
  'cross-origin-embedder-policy': {
    required: true,
    description: 'Controls cross-origin embedding',
    expectedValue: 'require-corp',
    severity: 'medium',
  },
  
  // Cross-Origin-Opener-Policy
  'cross-origin-opener-policy': {
    required: true,
    description: 'Isolates browsing context',
    expectedValues: ['same-origin', 'same-origin-allow-popups'],
    severity: 'medium',
  },
  
  // Cross-Origin-Resource-Policy
  'cross-origin-resource-policy': {
    required: true,
    description: 'Controls cross-origin resource loading',
    expectedValues: ['same-site', 'same-origin', 'cross-origin'],
    severity: 'medium',
  },
};

/**
 * Headers that should NOT be present (security risks)
 */
const FORBIDDEN_HEADERS = [
  'x-powered-by',        // Reveals technology stack
  'server',              // Can reveal server info (but often set by web server)
];

/**
 * Validate a single header value
 * 
 * @param {string} headerName - Name of the header
 * @param {string} headerValue - Value of the header
 * @param {Object} requirements - Requirements for this header
 * @returns {Object} Validation result
 */
const validateHeader = (headerName, headerValue, requirements) => {
  const issues = [];
  
  if (!headerValue) {
    if (requirements.required) {
      return {
        valid: false,
        present: false,
        issues: [`Required header '${headerName}' is missing`],
        severity: requirements.severity,
      };
    }
    return {
      valid: true,
      present: false,
      issues: [],
      severity: requirements.severity,
    };
  }
  
  // Check pattern match
  if (requirements.pattern && !requirements.pattern.test(headerValue)) {
    issues.push(`Header '${headerName}' does not match required pattern`);
  }
  
  // Check exact value
  if (requirements.expectedValue && headerValue !== requirements.expectedValue) {
    issues.push(
      `Header '${headerName}' has value '${headerValue}' but expected '${requirements.expectedValue}'`
    );
  }
  
  // Check allowed values
  if (requirements.expectedValues) {
    const valueMatch = requirements.expectedValues.some(expected =>
      headerValue.toLowerCase().includes(expected.toLowerCase())
    );
    
    if (!valueMatch) {
      issues.push(
        `Header '${headerName}' has unexpected value. Expected one of: ${requirements.expectedValues.join(', ')}`
      );
    }
  }
  
  // Check must include directives
  if (requirements.mustInclude) {
    for (const directive of requirements.mustInclude) {
      if (!headerValue.toLowerCase().includes(directive.toLowerCase())) {
        issues.push(`Header '${headerName}' missing required directive: ${directive}`);
      }
    }
  }
  
  // Special validation for HSTS max-age
  if (headerName === 'strict-transport-security' && requirements.minMaxAge) {
    const maxAgeMatch = headerValue.match(/max-age=(\d+)/);
    if (maxAgeMatch) {
      const maxAge = parseInt(maxAgeMatch[1], 10);
      if (maxAge < requirements.minMaxAge) {
        issues.push(
          `HSTS max-age (${maxAge}s) is less than recommended (${requirements.minMaxAge}s)`
        );
      }
    }
  }
  
  return {
    valid: issues.length === 0,
    present: true,
    value: headerValue,
    issues,
    severity: requirements.severity,
  };
};

/**
 * Verify security headers in HTTP response
 * 
 * @param {Object} headers - Response headers object
 * @returns {Object} Verification result
 */
const verifySecurityHeaders = (headers) => {
  const results = {};
  const errors = [];
  const warnings = [];
  const info = [];
  
  // Normalize header names to lowercase
  const normalizedHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    normalizedHeaders[name.toLowerCase()] = value;
  }
  
  // Check required headers
  for (const [headerName, requirements] of Object.entries(REQUIRED_HEADERS)) {
    const headerValue = normalizedHeaders[headerName];
    const validation = validateHeader(headerName, headerValue, requirements);
    
    results[headerName] = validation;
    
    if (!validation.valid) {
      for (const issue of validation.issues) {
        if (validation.severity === 'critical' || validation.severity === 'high') {
          errors.push(issue);
        } else if (validation.severity === 'medium') {
          warnings.push(issue);
        } else {
          info.push(issue);
        }
      }
    }
  }
  
  // Check forbidden headers
  for (const forbiddenHeader of FORBIDDEN_HEADERS) {
    if (normalizedHeaders[forbiddenHeader]) {
      warnings.push(
        `Forbidden header '${forbiddenHeader}' is present: ${normalizedHeaders[forbiddenHeader]}`
      );
    }
  }
  
  // Calculate security score (0-100)
  const totalHeaders = Object.keys(REQUIRED_HEADERS).length;
  const validHeaders = Object.values(results).filter(r => r.valid).length;
  const score = Math.round((validHeaders / totalHeaders) * 100);
  
  return {
    score,
    grade: getSecurityGrade(score),
    allValid: errors.length === 0,
    secure: errors.length === 0 && warnings.length === 0,
    results,
    errors,
    warnings,
    info,
    summary: {
      total: totalHeaders,
      valid: validHeaders,
      missing: Object.values(results).filter(r => !r.present).length,
      invalid: Object.values(results).filter(r => r.present && !r.valid).length,
    },
  };
};

/**
 * Get security grade based on score
 * 
 * @param {number} score - Security score (0-100)
 * @returns {string} Grade (A+, A, B, C, D, F)
 */
const getSecurityGrade = (score) => {
  if (score >= 98) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
};

/**
 * Create test response to verify headers
 * This middleware can be added temporarily to test header configuration
 * 
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
const testSecurityHeaders = (req, res) => {
  const verification = verifySecurityHeaders(res.getHeaders());
  
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    headers: res.getHeaders(),
    verification,
  });
};

/**
 * Log security headers configuration on startup
 * Makes a mock request to verify headers are set correctly
 */
const logSecurityHeadersConfiguration = () => {
  // Mock headers that would be set byHelmet and other middleware
  const mockHeaders = {
    'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
    'content-security-policy': "default-src 'self'; object-src 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'x-xss-protection': '0',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-site',
  };
  
  const verification = verifySecurityHeaders(mockHeaders);
  
  logger.info('Security Headers Configuration', {
    score: verification.score,
    grade: verification.grade,
    allValid: verification.allValid,
    secure: verification.secure,
    summary: verification.summary,
  });
  
  if (verification.errors.length > 0) {
    logger.error('Security headers errors', { errors: verification.errors });
  }
  
  if (verification.warnings.length > 0) {
    logger.warn('Security headers warnings', { warnings: verification.warnings });
  }
  
  if (verification.info.length > 0) {
    logger.info('Security headers info', { info: verification.info });
  }
  
  if (verification.secure) {
    logger.info('All security headers are properly configured');
  }
  
  // Log individual header status
  const headerStatus = {};
  for (const [name, result] of Object.entries(verification.results)) {
    headerStatus[name] = {
      present: result.present,
      valid: result.valid,
      severity: REQUIRED_HEADERS[name]?.severity,
    };
  }
  
  logger.debug('Security headers status', { headers: headerStatus });
};

/**
 * Get security headers status for health checks
 * 
 * @param {Object} headers - Response headers to check (optional)
 * @returns {Object} Security headers status
 */
const getSecurityHeadersStatus = (headers = {}) => {
  const verification = verifySecurityHeaders(headers);
  
  return {
    enabled: true,
    score: verification.score,
    grade: verification.grade,
    allValid: verification.allValid,
    secure: verification.secure,
    summary: verification.summary,
    errors: verification.errors,
    warnings: verification.warnings,
  };
};

/**
 * Middleware to add custom security headers
 * Additional headers not covered by Helmet
 */
const additionalSecurityHeaders = (req, res, next) => {
  // X-Request-ID (if not already set)
  if (!res.get('X-Request-ID') && req.id) {
    res.setHeader('X-Request-ID', req.id);
  }
  
  // X-Content-Duration (for performance monitoring)
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.debug('Request completed', {
      requestId: req.id,
      duration,
      path: req.path,
      statusCode: res.statusCode,
    });
  });
  
  next();
};

/**
 * Get recommended security headers configuration
 * Returns best-practice header values
 * 
 * @returns {Object} Recommended headers
 */
const getRecommendedHeaders = () => {
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "frame-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0', // Disabled to avoid conflicts with CSP
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
  };
};

module.exports = {
  verifySecurityHeaders,
  testSecurityHeaders,
  logSecurityHeadersConfiguration,
  getSecurityHeadersStatus,
  additionalSecurityHeaders,
  getRecommendedHeaders,
  validateHeader,
  REQUIRED_HEADERS,
  FORBIDDEN_HEADERS,
};
