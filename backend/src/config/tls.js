/**
 * TLS Configuration Module
 * 
 * Provides TLS 1.3 enforcement and configuration utilities
 * Ensures secure transport layer for Redis and HTTP connections
 */

const crypto = require('crypto');
const tls = require('tls');
const logger = require('../utils/logger');

/**
 * Recommended TLS 1.3 cipher suites (AEAD only)
 * These provide Perfect Forward Secrecy (PFS) and authenticated encryption
 */
const TLS_13_CIPHER_SUITES = [
  'TLS_AES_256_GCM_SHA384',           // AES-256 with GCM mode
  'TLS_CHACHA20_POLY1305_SHA256',     // ChaCha20-Poly1305 (mobile-optimized)
  'TLS_AES_128_GCM_SHA256',           // AES-128 with GCM mode
];

/**
 * TLS 1.2 cipher suites (fallback for development)
 * Only strong ciphers with PFS
 */
const TLS_12_CIPHER_SUITES = [
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-RSA-CHACHA20-POLY1305',
];

/**
 * Get recommended TLS configuration for Node.js servers
 * Enforces TLS 1.3 in production, allows TLS 1.2+ in development
 * 
 * @param {Object} options - Configuration options
 * @param {boolean} options.production - Whether running in production
 * @param {boolean} options.requireClientCert - Require client certificate (mutual TLS)
 * @returns {Object} TLS options for https.createServer or tls.createServer
 */
const getSecureTlsConfig = ({ production = false, requireClientCert = false } = {}) => {
  const config = {
    // Enforce minimum TLS version
    minVersion: production ? 'TLSv1.3' : 'TLSv1.2',
    
    // Set maximum TLS version (always 1.3)
    maxVersion: 'TLSv1.3',
    
    // Use only strong cipher suites
    ciphers: production
      ? TLS_13_CIPHER_SUITES.join(':')
      : [...TLS_13_CIPHER_SUITES, ...TLS_12_CIPHER_SUITES].join(':'),
    
    // Prefer server cipher order (prevent client downgrade)
    honorCipherOrder: true,
    
    // Enable session resumption for performance
    sessionTimeout: 300, // 5 minutes
    
    // Disable SSL compression (CRIME attack prevention)
    // Note: Node.js disables this by default since v0.10
    
    // Disable TLS renegotiation (DoS prevention)
    // Note: Automatically disabled in TLS 1.3
    
    // Enable OCSP stapling for certificate validation
    // (requires certificate with OCSP responder)
    requestOCSP: production,
  };

  // Add client certificate requirements (mutual TLS)
  if (requireClientCert) {
    config.requestCert = true;
    config.rejectUnauthorized = true;
  }

  return config;
};

/**
 * Get TLS configuration for Redis client (ioredis)
 * 
 * @param {Object} options - Configuration options
 * @returns {Object} TLS options for ioredis
 */
const getRedisTlsConfig = (options = {}) => {
  const production = process.env.NODE_ENV === 'production';
  
  const config = {
    // Enforce minimum TLS version
    minVersion: production ? 'TLSv1.3' : 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    
    // Reject unauthorized certificates in production
    rejectUnauthorized: production,
    
    // Use strong cipher suites
    ciphers: production
      ? TLS_13_CIPHER_SUITES.join(':')
      : [...TLS_13_CIPHER_SUITES, ...TLS_12_CIPHER_SUITES].join(':'),
    
    // Prefer server cipher order
    honorCipherOrder: true,
    
    // Session resumption
    sessionTimeout: 300,
    
    // Request OCSP in production
    requestOCSP: production,
    
    // Override with provided options
    ...options,
  };

  return config;
};

/**
 * Verify TLS connection security
 * Checks if connection meets security requirements
 * 
 * @param {tls.TLSSocket} socket - TLS socket to verify
 * @returns {Object} Verification result
 */
const verifyTlsConnection = (socket) => {
  if (!socket || typeof socket.getProtocol !== 'function') {
    return {
      secure: false,
      errors: ['Not a TLS socket'],
      warnings: [],
    };
  }

  const errors = [];
  const warnings = [];
  const info = {};

  try {
    // Get TLS protocol version
    const protocol = socket.getProtocol();
    info.protocol = protocol;

    // Check protocol version
    if (!protocol) {
      errors.push('Unable to determine TLS protocol version');
    } else if (protocol === 'TLSv1.3') {
      info.protocolSecure = true;
    } else if (protocol === 'TLSv1.2') {
      warnings.push('Using TLS 1.2 (TLS 1.3 recommended)');
      info.protocolSecure = true; // Still acceptable
    } else {
      errors.push(`Insecure TLS protocol: ${protocol}`);
      info.protocolSecure = false;
    }

    // Get cipher suite
    const cipher = socket.getCipher();
    if (cipher) {
      info.cipher = cipher.name;
      info.cipherVersion = cipher.version;

      // Check if cipher is in recommended list
      const isRecommended = TLS_13_CIPHER_SUITES.includes(cipher.name) ||
                           TLS_12_CIPHER_SUITES.includes(cipher.name);
      
      if (!isRecommended) {
        warnings.push(`Cipher suite not in recommended list: ${cipher.name}`);
      }

      // Check cipher strength
      if (cipher.standardName && cipher.standardName.includes('128')) {
        info.keyLength = 128;
      } else if (cipher.standardName && cipher.standardName.includes('256')) {
        info.keyLength = 256;
      }
    } else {
      warnings.push('Unable to determine cipher suite');
    }

    // Get peer certificate
    const cert = socket.getPeerCertificate();
    if (cert && Object.keys(cert).length > 0) {
      info.peerCertificate = {
        subject: cert.subject,
        issuer: cert.issuer,
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        fingerprint: cert.fingerprint,
      };

      // Check certificate validity
      const now = new Date();
      const validFrom = new Date(cert.valid_from);
      const validTo = new Date(cert.valid_to);

      if (now < validFrom) {
        errors.push('Certificate not yet valid');
      }
      
      if (now > validTo) {
        errors.push('Certificate has expired');
      }

      // Warn if certificate expires soon (30 days)
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (validTo < thirtyDaysFromNow) {
        warnings.push(`Certificate expires soon: ${cert.valid_to}`);
      }
    } else {
      warnings.push('No peer certificate provided');
    }

    // Check if connection is authorized
    const authorized = socket.authorized;
    info.authorized = authorized;
    
    if (!authorized && socket.authorizationError) {
      errors.push(`Certificate not authorized: ${socket.authorizationError}`);
    }

  } catch (error) {
    errors.push(`Error verifying TLS connection: ${error.message}`);
  }

  return {
    secure: errors.length === 0,
    errors,
    warnings,
    info,
  };
};

/**
 * Get information about supported TLS versions
 * 
 * @returns {Object} Supported TLS configuration
 */
const getTlsInfo = () => {
  return {
    nodeVersion: process.version,
    opensslVersion: process.versions.openssl,
    recommendedProtocol: 'TLSv1.3',
    minAcceptableProtocol: 'TLSv1.2',
    recommendedCiphers: {
      'TLS 1.3': TLS_13_CIPHER_SUITES,
      'TLS 1.2': TLS_12_CIPHER_SUITES,
    },
    secureRenegotiation: true, // Always true in modern Node.js
    tlsExtensions: {
      sni: true,              // Server Name Indication
      alpn: true,             // Application-Layer Protocol Negotiation
      ocspStapling: true,     // Online Certificate Status Protocol
    },
  };
};

/**
 * Generate self-signed certificate for development
 * WARNING: Only use in development/testing!
 * 
 * @returns {Object} Certificate and key pair
 */
const generateSelfSignedCert = () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Self-signed certificates must not be used in production!');
  }

  const { generateKeyPairSync } = require('crypto');
  const { X509Certificate } = require('crypto');

  logger.warn('Generating self-signed certificate (DEVELOPMENT ONLY)');

  // Generate RSA key pair
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  // Note: For a full implementation, you would need a library like 'node-forge'
  // to create a proper X.509 certificate. This is just a placeholder.
  
  logger.info('Self-signed certificate generated', {
    algorithm: 'RSA',
    keyLength: 2048,
    warning: 'USE ONLY IN DEVELOPMENT',
  });

  return {
    key: privateKey,
    cert: publicKey, // This would normally be a full X.509 certificate
  };
};

/**
 * Validate TLS configuration completeness
 * Checks if all required TLS settings are present
 * 
 * @returns {Object} Validation result
 */
const validateTlsSetup = () => {
  const errors = [];
  const warnings = [];
  const production = process.env.NODE_ENV === 'production';

  // Check Redis TLS
  if (production && process.env.REDIS_TLS !== 'true') {
    errors.push('Redis TLS is not enabled in production (REDIS_TLS=true required)');
  }

  // Check Redis password
  if (production && !process.env.REDIS_PASSWORD) {
    errors.push('Redis password is not set in production (REDIS_PASSWORD required)');
  }

  // Check if TLS certificate paths are provided (if using file-based certs)
  if (process.env.REDIS_TLS === 'true') {
    if (process.env.REDIS_TLS_CLIENT_CERT && !process.env.REDIS_TLS_CLIENT_KEY) {
      errors.push('REDIS_TLS_CLIENT_CERT provided but REDIS_TLS_CLIENT_KEY missing');
    }
    
    if (process.env.REDIS_TLS_CLIENT_KEY && !process.env.REDIS_TLS_CLIENT_CERT) {
      errors.push('REDIS_TLS_CLIENT_KEY provided but REDIS_TLS_CLIENT_CERT missing');
    }

    if (!process.env.REDIS_TLS_CA_CERT && production) {
      warnings.push('No CA certificate provided (REDIS_TLS_CA_CERT). Using system CA bundle.');
    }
  }

  // Check OpenSSL version supports TLS 1.3
  const opensslVersion = process.versions.openssl;
  if (opensslVersion) {
    const [major, minor] = opensslVersion.split('.').map(Number);
    if (major < 1 || (major === 1 && minor < 1)) {
      warnings.push(`OpenSSL ${opensslVersion} may not support TLS 1.3 (requires 1.1.1+)`);
    }
  }

  return {
    valid: errors.length === 0,
    secure: errors.length === 0 && warnings.length === 0,
    errors,
    warnings,
  };
};

/**
 * Log TLS configuration on startup
 */
const logTlsConfiguration = () => {
  const info = getTlsInfo();
  const validation = validateTlsSetup();
  
  logger.info('TLS Configuration', {
    nodeVersion: info.nodeVersion,
    opensslVersion: info.opensslVersion,
    recommendedProtocol: info.recommendedProtocol,
    production: process.env.NODE_ENV === 'production',
  });

  if (validation.errors.length > 0) {
    logger.error('TLS configuration errors', { errors: validation.errors });
  }

  if (validation.warnings.length > 0) {
    logger.warn('TLS configuration warnings', { warnings: validation.warnings });
  }

  if (validation.secure) {
    logger.info('TLS configuration is secure');
  }
};

module.exports = {
  getSecureTlsConfig,
  getRedisTlsConfig,
  verifyTlsConnection,
  getTlsInfo,
  validateTlsSetup,
  logTlsConfiguration,
  generateSelfSignedCert,
  TLS_13_CIPHER_SUITES,
  TLS_12_CIPHER_SUITES,
};
