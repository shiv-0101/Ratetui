/**
 * Secrets Management and Environment Variable Validation
 * 
 * Centralized module for handling sensitive configuration with validation.
 * Based on TRD section 9 Data Security requirements.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Required environment variables by environment
 */
const REQUIRED_SECRETS = {
  all: [
    'NODE_ENV',
    'PORT',
    'REDIS_HOST',
    'REDIS_PORT',
  ],
  production: [
    'JWT_SECRET',
    'REDIS_PASSWORD',
    'REDIS_TLS',
    'CORS_ORIGINS',
  ],
  development: [
    'JWT_SECRET', // Still required but can be less strict
  ],
};

/**
 * Validation rules for secrets
 */
const SECRET_VALIDATION_RULES = {
  JWT_SECRET: {
    minLength: 64, // 512 bits minimum
    description: 'JWT signing secret must be at least 64 characters (512 bits)',
    severity: 'critical',
    checkEntropy: true,
  },
  REDIS_PASSWORD: {
    minLength: 16,
    description: 'Redis password must be at least 16 characters',
    severity: 'critical',
    production: true,
  },
  API_KEY: {
    minLength: 32,
    description: 'API keys must be at least 32 characters',
    severity: 'high',
  },
};

/**
 * Calculate entropy of a string (basic check for randomness)
 * @param {string} str - String to check
 * @returns {number} Entropy in bits
 */
const calculateEntropy = (str) => {
  if (!str || str.length === 0) return 0;
  
  const freq = {};
  for (const char of str) {
    freq[char] = (freq[char] || 0) + 1;
  }
  
  let entropy = 0;
  const len = str.length;
  
  for (const char in freq) {
    const p = freq[char] / len;
    entropy -= p * Math.log2(p);
  }
  
  return entropy * str.length;
};

/**
 * Validate secret strength
 * @param {string} name - Secret name
 * @param {string} value - Secret value
 * @returns {Object} Validation result
 */
const validateSecret = (name, value) => {
  const result = {
    valid: true,
    errors: [],
    warnings: [],
    info: [],
  };
  
  const rule = SECRET_VALIDATION_RULES[name];
  if (!rule) {
    return result; // No specific rules for this secret
  }
  
  // Check if required in production
  if (rule.production && process.env.NODE_ENV === 'production' && !value) {
    result.valid = false;
    result.errors.push(`${name} is required in production`);
    return result;
  }
  
  if (!value) {
    return result; // No value to validate
  }
  
  // Check minimum length
  if (rule.minLength && value.length < rule.minLength) {
    result.valid = false;
    result.errors.push(`${name} is too short. ${rule.description}`);
  }
  
  // Check for common weak values
  const weakPatterns = [
    /^(test|demo|example|default|change|secret|password|admin|root|user)/i,
    /^(1234|abcd|qwerty)/i,
  ];
  
  if (weakPatterns.some(pattern => pattern.test(value))) {
    result.valid = false;
    result.errors.push(`${name} appears to be a weak or default value. Use a strong randomly generated secret.`);
  }
  
  // Check entropy for critical secrets
  if (rule.checkEntropy && value.length >= rule.minLength) {
    const entropy = calculateEntropy(value);
    const expectedMinEntropy = rule.minLength * 4; // ~4 bits per char for good randomness
    
    if (entropy < expectedMinEntropy) {
      result.warnings.push(
        `${name} has low entropy (${entropy.toFixed(1)} bits). Consider using a cryptographically random value. ` +
        `Expected: ~${expectedMinEntropy} bits for ${rule.minLength} characters.`
      );
    } else {
      result.info.push(`${name} entropy: ${entropy.toFixed(1)} bits (good)`);
    }
  }
  
  return result;
};

/**
 * Validate all required environment variables
 * @returns {Object} Validation results
 */
const validateEnvironment = () => {
  const env = process.env.NODE_ENV || 'development';
  const results = {
    valid: true,
    errors: [],
    warnings: [],
    info: [],
    missing: [],
  };
  
  // Check required variables
  const requiredVars = [
    ...REQUIRED_SECRETS.all,
    ...(REQUIRED_SECRETS[env] || []),
  ];
  
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      results.valid = false;
      results.missing.push(varName);
      results.errors.push(`Missing required environment variable: ${varName}`);
    }
  }
  
  // Validate secret strength
  for (const [name, rule] of Object.entries(SECRET_VALIDATION_RULES)) {
    const value = process.env[name];
    const validation = validateSecret(name, value);
    
    if (!validation.valid) {
      results.valid = false;
      results.errors.push(...validation.errors);
    }
    
    results.warnings.push(...validation.warnings);
    results.info.push(...validation.info);
  }
  
  // Environment-specific checks
  if (env === 'production') {
    // Ensure production secrets are not default values
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.includes('dev-secret')) {
      results.valid = false;
      results.errors.push('JWT_SECRET contains "dev-secret" - this is not safe for production');
    }
    
    // Ensure TLS is enabled
    if (process.env.REDIS_TLS !== 'true') {
      results.warnings.push('REDIS_TLS is not enabled in production - this is insecure');
    }
    
    // Check CORS origins are not wildcards
    if (process.env.CORS_ORIGINS && process.env.CORS_ORIGINS.includes('*')) {
      results.errors.push('CORS_ORIGINS should not use wildcards in production');
      results.valid = false;
    }
  }
  
  return results;
};

/**
 * Safely get a secret with validation
 * @param {string} name - Secret name
 * @param {string} defaultValue - Default value (optional)
 * @returns {string} Secret value
 */
const getSecret = (name, defaultValue = undefined) => {
  const value = process.env[name] || defaultValue;
  
  if (!value) {
    logger.error(`Attempted to access undefined secret: ${name}`);
    throw new Error(`Secret ${name} is not configured`);
  }
  
  return value;
};

/**
 * Safely get an optional secret
 * @param {string} name - Secret name
 * @param {string} defaultValue - Default value
 * @returns {string} Secret value or default
 */
const getOptionalSecret = (name, defaultValue = '') => {
  return process.env[name] || defaultValue;
};

/**
 * Generate a secure random secret
 * @param {number} bytes - Number of bytes (default: 32)
 * @returns {string} Hex-encoded secret
 */
const generateSecret = (bytes = 32) => {
  return crypto.randomBytes(bytes).toString('hex');
};

/**
 * Log secrets configuration status (without exposing values)
 */
const logSecretsConfiguration = () => {
  const validation = validateEnvironment();
  
  logger.info('Secrets Management: Configuration validation started');
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Log configured secrets (names only)
  const configuredSecrets = Object.keys(SECRET_VALIDATION_RULES).filter(
    name => process.env[name]
  );
  
  if (configuredSecrets.length > 0) {
    logger.info(`Configured secrets: ${configuredSecrets.join(', ')}`);
  }
  
  // Log validation results
  if (validation.valid) {
    logger.info('✓ All required secrets are configured and valid');
  } else {
    logger.error('✗ Secrets configuration validation failed');
    validation.errors.forEach(error => logger.error(`  - ${error}`));
  }
  
  // Log warnings
  if (validation.warnings.length > 0) {
    validation.warnings.forEach(warning => logger.warn(`  ⚠ ${warning}`));
  }
  
  // Log info in debug mode
  if (process.env.LOG_LEVEL === 'debug' && validation.info.length > 0) {
    validation.info.forEach(info => logger.debug(`  ℹ ${info}`));
  }
  
  // Log missing variables
  if (validation.missing.length > 0) {
    logger.error(`Missing required environment variables: ${validation.missing.join(', ')}`);
  }
  
  return validation;
};

/**
 * Validate secrets on module load (fail fast in production)
 */
const initializeSecrets = () => {
  const validation = logSecretsConfiguration();
  
  if (!validation.valid) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('FATAL: Cannot start application with invalid secrets configuration in production');
      process.exit(1);
    } else {
      logger.warn('WARNING: Secrets configuration is invalid. This is acceptable in development but must be fixed for production.');
    }
  }
  
  return validation.valid;
};

module.exports = {
  validateEnvironment,
  validateSecret,
  getSecret,
  getOptionalSecret,
  generateSecret,
  logSecretsConfiguration,
  initializeSecrets,
  calculateEntropy,
  REQUIRED_SECRETS,
  SECRET_VALIDATION_RULES,
};
