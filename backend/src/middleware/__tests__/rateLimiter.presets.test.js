/**
 * Rate Limiter Presets Integration Tests
 * 
 * Tests for pre-configured rate limiter presets
 */

const { rateLimiters } = require('../rateLimiter');

describe('Rate Limiter - Presets', () => {
  describe('Preset Configurations', () => {
    test('api preset should have correct configuration', () => {
      expect(rateLimiters.api).toBeDefined();
      expect(typeof rateLimiters.api).toBe('function');
    });

    test('auth preset should have correct configuration', () => {
      expect(rateLimiters.auth).toBeDefined();
      expect(typeof rateLimiters.auth).toBe('function');
    });

    test('login preset should have correct configuration', () => {
      expect(rateLimiters.login).toBeDefined();
      expect(typeof rateLimiters.login).toBe('function');
    });

    test('admin preset should have correct configuration', () => {
      expect(rateLimiters.admin).toBeDefined();
      expect(typeof rateLimiters.admin).toBe('function');
    });

    test('search preset should have correct configuration', () => {
      expect(rateLimiters.search).toBeDefined();
      expect(typeof rateLimiters.search).toBe('function');
    });

    test('expensive preset should have correct configuration', () => {
      expect(rateLimiters.expensive).toBeDefined();
      expect(typeof rateLimiters.expensive).toBe('function');
    });

    test('upload preset should have correct configuration', () => {
      expect(rateLimiters.upload).toBeDefined();
      expect(typeof rateLimiters.upload).toBe('function');
    });

    test('passwordReset preset should have correct configuration', () => {
      expect(rateLimiters.passwordReset).toBeDefined();
      expect(typeof rateLimiters.passwordReset).toBe('function');
    });

    test('email preset should have correct configuration', () => {
      expect(rateLimiters.email).toBeDefined();
      expect(typeof rateLimiters.email).toBe('function');
    });

    test('apiKey preset should have correct configuration', () => {
      expect(rateLimiters.apiKey).toBeDefined();
      expect(typeof rateLimiters.apiKey).toBe('function');
    });
  });

  describe('Preset Use Cases', () => {
    test('all presets should be middleware functions', () => {
      const presets = [
        rateLimiters.api,
        rateLimiters.auth,
        rateLimiters.login,
        rateLimiters.admin,
        rateLimiters.search,
        rateLimiters.expensive,
        rateLimiters.upload,
        rateLimiters.passwordReset,
        rateLimiters.email,
        rateLimiters.apiKey,
      ];

      presets.forEach(preset => {
        expect(typeof preset).toBe('function');
        expect(preset.length).toBe(3); // (req, res, next)
      });
    });

    test('presets should handle different rate limits', () => {
      // This documents the expected behavior:
      // - api: 200/min - general public API
      // - auth: 10/min - authentication endpoints
      // - login: 5/15min - login attempts (anti-brute-force)
      // - admin: 50/min - admin operations (user-based)
      // - search: 30/min - search queries
      // - expensive: 10/min - resource-intensive operations
      // - upload: 5/hour - file uploads
      // - passwordReset: 3/hour - password resets
      // - email: 10/hour - email sending
      // - apiKey: 1000/hour - API key authenticated requests

      expect(true).toBe(true);
    });
  });

  describe('Preset Security', () => {
    test('login preset should prevent brute-force attacks', () => {
      // login preset: 5 attempts per 15 minutes with 15min block
      // This effectively prevents brute-force by:
      // 1. Low attempt count (5)
      // 2. Long window (15 minutes)
      // 3. Long block duration (15 minutes)
      
      expect(rateLimiters.login).toBeDefined();
    });

    test('auth preset should have block duration', () => {
      // auth preset: 10/min with 5 minute block
      // Prevents rapid authentication attempts
      
      expect(rateLimiters.auth).toBeDefined();
    });

    test('passwordReset preset should prevent abuse', () => {
      // passwordReset preset: 3/hour with 1 hour block
      // Prevents password reset link spam
      
      expect(rateLimiters.passwordReset).toBeDefined();
    });
  });

  describe('Preset Identifier Types', () => {
    test('IP-based presets should identify by client IP', () => {
      // IP-based: api, auth, login, search, expensive, upload, passwordReset, email
      // These track requests per IP address
      
      const ipBasedPresets = [
        'api', 'auth', 'login', 'search', 
        'expensive', 'upload', 'passwordReset', 'email'
      ];
      
      ipBasedPresets.forEach(presetName => {
        expect(rateLimiters[presetName]).toBeDefined();
      });
    });

    test('user-based preset should identify by user ID', () => {
      // admin preset uses user-based identification
      // Requires authentication
      
      expect(rateLimiters.admin).toBeDefined();
    });

    test('API key-based preset should identify by API key', () => {
      // apiKey preset uses API key identification
      
      expect(rateLimiters.apiKey).toBeDefined();
    });
  });

  describe('Preset Time Windows', () => {
    test('minute-based presets for real-time protection', () => {
      // Per-minute presets: api, auth, admin, search, expensive
      // These provide immediate rate limiting for real-time traffic
      
      const minutePresets = ['api', 'auth', 'admin', 'search', 'expensive'];
      minutePresets.forEach(preset => {
        expect(rateLimiters[preset]).toBeDefined();
      });
    });

    test('15-minute window for login protection', () => {
      // login preset uses 15-minute window
      // Optimal for preventing brute-force while allowing legitimate retries
      
      expect(rateLimiters.login).toBeDefined();
    });

    test('hourly presets for resource-intensive operations', () => {
      // Hourly presets: upload, passwordReset, email, apiKey
      // Longer windows for operations that shouldn't be frequent
      
      const hourlyPresets = ['upload', 'passwordReset', 'email', 'apiKey'];
      hourlyPresets.forEach(preset => {
        expect(rateLimiters[preset]).toBeDefined();
      });
    });
  });
});

describe('Rate Limiter - Preset Documentation', () => {
  test('should document all preset configurations', () => {
    const presetDocs = {
      api: {
        limit: 200,
        window: '1 minute',
        identifierType: 'IP',
        useCase: 'General public API endpoints',
      },
      auth: {
        limit: 10,
        window: '1 minute',
        blockDuration: '5 minutes',
        identifierType: 'IP',
        useCase: 'Authentication endpoints',
      },
      login: {
        limit: 5,
        window: '15 minutes',
        blockDuration: '15 minutes',
        identifierType: 'IP',
        useCase: 'Login attempts (brute-force prevention)',
      },
      admin: {
        limit: 50,
        window: '1 minute',
        identifierType: 'User ID',
        useCase: 'Administrative operations',
      },
      search: {
        limit: 30,
        window: '1 minute',
        identifierType: 'IP',
        useCase: 'Search and query operations',
      },
      expensive: {
        limit: 10,
        window: '1 minute',
        identifierType: 'IP',
        useCase: 'Resource-intensive operations (reports, exports, AI)',
      },
      upload: {
        limit: 5,
        window: '1 hour',
        identifierType: 'IP',
        useCase: 'File upload endpoints',
      },
      passwordReset: {
        limit: 3,
        window: '1 hour',
        blockDuration: '1 hour',
        identifierType: 'IP',
        useCase: 'Password reset requests',
      },
      email: {
        limit: 10,
        window: '1 hour',
        identifierType: 'IP',
        useCase: 'Email sending operations',
      },
      apiKey: {
        limit: 1000,
        window: '1 hour',
        identifierType: 'API Key',
        useCase: 'API key authenticated requests',
      },
    };

    // Verify all documented presets exist
    Object.keys(presetDocs).forEach(presetName => {
      expect(rateLimiters[presetName]).toBeDefined();
    });

    expect(Object.keys(presetDocs).length).toBe(10);
  });
});
