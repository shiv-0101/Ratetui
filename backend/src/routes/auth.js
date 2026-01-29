/**
 * Authentication Routes
 * 
 * Handles user authentication: login, logout, token refresh
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const { generateAccessToken, generateRefreshToken, verifyAccessToken, getTokenExpiry, decodeToken } = require('../services/jwt');
const { authenticate, blacklistToken, storeRefreshToken, verifyRefreshToken, deleteRefreshToken } = require('../middleware/auth');
const { rateLimiters } = require('../middleware/rateLimiter');
const { createError } = require('../middleware/errorHandler');
const { getRedisClient, isRedisConnected } = require('../config/redis');
const logger = require('../utils/logger');

const router = express.Router();

// Mock user database (will be replaced with Redis/DB in Task 2.2)
// For now, using hardcoded admin user
const MOCK_USERS = {
  'admin@example.com': {
    id: 'admin-001',
    email: 'admin@example.com',
    // Password: admin123 (bcrypt hashed)
    passwordHash: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYPGEgJVb4y',
    role: 'admin',
  },
};

/**
 * POST /admin/auth/login
 * Login with email and password
 * Rate limit: 5 attempts per 15 minutes
 */
router.post(
  '/login',
  rateLimiters.login,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  async (req, res, next) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        logger.warn('Login validation failed', { errors: errors.array(), ip: req.ip });
        throw createError('VALIDATION_ERROR', 'Invalid email or password format', { errors: errors.array() });
      }

      const { email, password } = req.body;

      // Find user (mock for now)
      const user = MOCK_USERS[email];
      if (!user) {
        logger.warn('Login attempt with non-existent email', { email, ip: req.ip });
        throw createError('UNAUTHORIZED', 'Invalid email or password');
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        logger.warn('Login attempt with incorrect password', { email, ip: req.ip });
        throw createError('UNAUTHORIZED', 'Invalid email or password');
      }

      // Generate tokens
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken();

      // Calculate expiry times
      const accessTokenExpiry = process.env.JWT_ACCESS_TOKEN_EXPIRY || '1h';
      const refreshTokenExpiry = process.env.JWT_REFRESH_TOKEN_EXPIRY || '7d';
      
      // Convert expiry to seconds
      const parseExpiry = (expiry) => {
        const match = expiry.match(/^(\d+)([smhd])$/);
        if (!match) return 3600; // default 1 hour
        const value = parseInt(match[1]);
        const unit = match[2];
        const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
        return value * (multipliers[unit] || 3600);
      };

      const refreshExpirySeconds = parseExpiry(refreshTokenExpiry);

      // Store refresh token in Redis
      await storeRefreshToken(user.id, refreshToken, refreshExpirySeconds);

      logger.info('User logged in successfully', { userId: user.id, email: user.email, ip: req.ip });

      res.json({
        success: true,
        data: {
          accessToken,
          refreshToken,
          expiresIn: accessTokenExpiry,
          tokenType: 'Bearer',
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/auth/logout
 * Logout and invalidate tokens
 * Requires authentication
 */
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { jti } = req.user;

    // Get token expiry from the original token
    const authHeader = req.headers.authorization;
    const token = authHeader.split(' ')[1];
    const decoded = decodeToken(token);
    const expirySeconds = getTokenExpiry(decoded);

    // Add access token to blacklist
    await blacklistToken(jti, expirySeconds);

    // Delete refresh token if provided
    const { refreshToken } = req.body;
    if (refreshToken) {
      await deleteRefreshToken(req.user.id, refreshToken);
    }

    logger.info('User logged out', { userId: req.user.id, ip: req.ip });

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/auth/refresh
 * Refresh access token using refresh token
 * Rate limit: 30 requests per minute
 */
router.post(
  '/refresh',
  rateLimiters.search, // Using search rate limit (30/min)
  [body('refreshToken').notEmpty().withMessage('Refresh token is required')],
  async (req, res, next) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw createError('VALIDATION_ERROR', 'Refresh token is required', { errors: errors.array() });
      }

      const { refreshToken } = req.body;

      // Verify refresh token exists in Redis
      // We need to find which user this token belongs to
      // In a real implementation, you'd store userId with the token or use a different structure
      
      // For now, we'll check all mock users (simplified)
      let validUser = null;
      for (const email in MOCK_USERS) {
        const user = MOCK_USERS[email];
        const isValid = await verifyRefreshToken(user.id, refreshToken);
        if (isValid) {
          validUser = user;
          break;
        }
      }

      if (!validUser) {
        logger.warn('Invalid refresh token used', { ip: req.ip });
        throw createError('UNAUTHORIZED', 'Invalid or expired refresh token');
      }

      // Generate new tokens (token rotation)
      const newAccessToken = generateAccessToken(validUser);
      const newRefreshToken = generateRefreshToken();

      // Calculate expiry
      const refreshTokenExpiry = process.env.JWT_REFRESH_TOKEN_EXPIRY || '7d';
      const parseExpiry = (expiry) => {
        const match = expiry.match(/^(\d+)([smhd])$/);
        if (!match) return 3600;
        const value = parseInt(match[1]);
        const unit = match[2];
        const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
        return value * (multipliers[unit] || 3600);
      };
      const refreshExpirySeconds = parseExpiry(refreshTokenExpiry);

      // Delete old refresh token and store new one (token rotation)
      await deleteRefreshToken(validUser.id, refreshToken);
      await storeRefreshToken(validUser.id, newRefreshToken, refreshExpirySeconds);

      logger.info('Tokens refreshed', { userId: validUser.id, ip: req.ip });

      res.json({
        success: true,
        data: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresIn: process.env.JWT_ACCESS_TOKEN_EXPIRY || '1h',
          tokenType: 'Bearer',
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/auth/me
 * Get current user info
 * Requires authentication
 */
router.get('/me', authenticate, (req, res) => {
  res.json({
    success: true,
    data: {
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
      },
    },
  });
});

module.exports = router;
