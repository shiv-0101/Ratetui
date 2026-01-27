/**
 * JWT Service
 * 
 * Handles JWT token generation and verification using RS256 algorithm
 * Uses RSA key pair for signing and verifying tokens
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Load RSA keys
let privateKey;
let publicKey;

/**
 * Load RSA keys from files or environment variables
 */
const loadKeys = () => {
  try {
    // Try loading from file paths first (recommended)
    if (process.env.JWT_PRIVATE_KEY_PATH) {
      const privatePath = path.resolve(process.cwd(), process.env.JWT_PRIVATE_KEY_PATH);
      privateKey = fs.readFileSync(privatePath, 'utf8');
    } else if (process.env.JWT_PRIVATE_KEY) {
      // Load from environment variable (embedded key)
      privateKey = process.env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
    } else {
      throw new Error('JWT_PRIVATE_KEY_PATH or JWT_PRIVATE_KEY must be set');
    }

    if (process.env.JWT_PUBLIC_KEY_PATH) {
      const publicPath = path.resolve(process.cwd(), process.env.JWT_PUBLIC_KEY_PATH);
      publicKey = fs.readFileSync(publicPath, 'utf8');
    } else if (process.env.JWT_PUBLIC_KEY) {
      // Load from environment variable (embedded key)
      publicKey = process.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
    } else {
      throw new Error('JWT_PUBLIC_KEY_PATH or JWT_PUBLIC_KEY must be set');
    }

    logger.info('JWT keys loaded successfully');
  } catch (error) {
    logger.error('Failed to load JWT keys', { error: error.message });
    throw error;
  }
};

// Load keys on module initialization
loadKeys();

/**
 * Generate access token (JWT)
 * 
 * @param {Object} user - User object
 * @param {string} user.id - User ID
 * @param {string} user.email - User email
 * @param {string} user.role - User role
 * @returns {string} Signed JWT token
 */
const generateAccessToken = (user) => {
  if (!user || !user.id) {
    throw new Error('User ID is required to generate access token');
  }

  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role || 'viewer',
    type: 'access',
    jti: crypto.randomUUID(), // JWT ID for blacklisting
  };

  const options = {
    algorithm: 'RS256',
    expiresIn: process.env.JWT_ACCESS_TOKEN_EXPIRY || '1h',
    issuer: process.env.JWT_ISSUER || 'ratetui',
    audience: process.env.JWT_AUDIENCE || 'ratetui-api',
  };

  try {
    const token = jwt.sign(payload, privateKey, options);
    logger.info('Access token generated', { userId: user.id, jti: payload.jti });
    return token;
  } catch (error) {
    logger.error('Failed to generate access token', { error: error.message });
    throw error;
  }
};

/**
 * Generate refresh token (random string stored in Redis)
 * 
 * @returns {string} Random 64-byte hex string
 */
const generateRefreshToken = () => {
  return crypto.randomBytes(64).toString('hex');
};

/**
 * Verify access token
 * 
 * @param {string} token - JWT token to verify
 * @returns {Object} Decoded token payload
 * @throws {Error} If token is invalid or expired
 */
const verifyAccessToken = (token) => {
  if (!token) {
    throw new Error('Token is required');
  }

  const options = {
    algorithms: ['RS256'],
    issuer: process.env.JWT_ISSUER || 'ratetui',
    audience: process.env.JWT_AUDIENCE || 'ratetui-api',
  };

  try {
    const decoded = jwt.verify(token, publicKey, options);
    
    // Verify token type
    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.warn('Token expired', { token: token.substring(0, 20) + '...' });
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid token', { error: error.message });
      throw new Error('Invalid token');
    } else {
      logger.error('Token verification failed', { error: error.message });
      throw error;
    }
  }
};

/**
 * Decode token without verification (useful for debugging)
 * 
 * @param {string} token - JWT token to decode
 * @returns {Object|null} Decoded token payload or null if invalid
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
};

/**
 * Extract token from Authorization header
 * 
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Token or null if not found
 */
const extractTokenFromHeader = (authHeader) => {
  if (!authHeader) {
    return null;
  }

  // Check for Bearer token
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer') {
    return parts[1];
  }

  return null;
};

/**
 * Get token expiration time in seconds
 * 
 * @param {Object} decoded - Decoded token
 * @returns {number} Seconds until expiration
 */
const getTokenExpiry = (decoded) => {
  if (!decoded || !decoded.exp) {
    return 0;
  }

  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, decoded.exp - now);
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  decodeToken,
  extractTokenFromHeader,
  getTokenExpiry,
};
