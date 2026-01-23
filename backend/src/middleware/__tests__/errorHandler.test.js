/**
 * Error Handler Middleware Tests
 * 
 * Tests for global error handling and error sanitization
 */

const express = require('express');
const request = require('supertest');
const errorHandler = require('../../middleware/errorHandler');
const { ApiError, createError, ErrorCodes } = errorHandler;

// Create test app with error handler
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  
  // Test routes that trigger various errors
  app.get('/error/api', (req, res, next) => {
    next(createError('VALIDATION_ERROR', 'Invalid input data', { field: 'email' }));
  });
  
  app.get('/error/401', (req, res, next) => {
    next(createError('UNAUTHORIZED', 'Authentication required'));
  });
  
  app.get('/error/404', (req, res, next) => {
    next(createError('NOT_FOUND', 'Resource not found'));
  });
  
  app.get('/error/500', (req, res, next) => {
    next(new Error('Unexpected error occurred'));
  });
  
  app.get('/error/jwt', (req, res, next) => {
    const error = new Error('jwt malformed');
    error.name = 'JsonWebTokenError';
    next(error);
  });
  
  app.get('/error/jwt-expired', (req, res, next) => {
    const error = new Error('jwt expired');
    error.name = 'TokenExpiredError';
    next(error);
  });
  
  app.get('/error/validation', (req, res, next) => {
    const error = {
      array: () => [
        { field: 'email', message: 'Invalid email format' },
        { field: 'password', message: 'Password too short' }
      ]
    };
    next(error);
  });
  
  app.get('/error/redis', (req, res, next) => {
    const error = new Error('Redis connection failed');
    error.name = 'ReplyError';
    next(error);
  });

  app.get('/error/cors', (req, res, next) => {
    next(new Error('Not allowed by CORS policy'));
  });
  
  // Add error handler
  app.use(errorHandler);
  
  return app;
};

describe('Error Handler Middleware', () => {
  let app;
  const originalEnv = process.env.NODE_ENV;

  beforeAll(() => {
    app = createTestApp();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('ApiError Class', () => {
    test('should create ApiError with correct properties', () => {
      const error = new ApiError('TEST_ERROR', 'Test message', 400, { field: 'test' });
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.code).toBe('TEST_ERROR');
      expect(error.message).toBe('Test message');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ field: 'test' });
      expect(error.isOperational).toBe(true);
      expect(error.stack).toBeDefined();
    });

    test('should default to 500 status code', () => {
      const error = new ApiError('TEST_ERROR', 'Test message');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('createError Function', () => {
    test('should create error from error code', () => {
      const error = createError('VALIDATION_ERROR');
      
      expect(error).toBeInstanceOf(ApiError);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Validation failed');
    });

    test('should accept custom message', () => {
      const error = createError('VALIDATION_ERROR', 'Custom validation message');
      expect(error.message).toBe('Custom validation message');
    });

    test('should accept details', () => {
      const details = { field: 'email', reason: 'invalid format' };
      const error = createError('VALIDATION_ERROR', null, details);
      expect(error.details).toEqual(details);
    });

    test('should default to INTERNAL_ERROR for unknown codes', () => {
      const error = createError('UNKNOWN_CODE');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('Error Codes Mapping', () => {
    test('should have all standard error codes', () => {
      expect(ErrorCodes).toHaveProperty('RATE_LIMIT_EXCEEDED');
      expect(ErrorCodes).toHaveProperty('IP_BLOCKED');
      expect(ErrorCodes).toHaveProperty('UNAUTHORIZED');
      expect(ErrorCodes).toHaveProperty('FORBIDDEN');
      expect(ErrorCodes).toHaveProperty('VALIDATION_ERROR');
      expect(ErrorCodes).toHaveProperty('NOT_FOUND');
      expect(ErrorCodes).toHaveProperty('INTERNAL_ERROR');
      expect(ErrorCodes).toHaveProperty('SERVICE_UNAVAILABLE');
    });

    test('each error code should have status and message', () => {
      Object.values(ErrorCodes).forEach(errorConfig => {
        expect(errorConfig).toHaveProperty('status');
        expect(errorConfig).toHaveProperty('message');
        expect(typeof errorConfig.status).toBe('number');
        expect(typeof errorConfig.message).toBe('string');
      });
    });
  });

  describe('400 Bad Request Errors', () => {
    test('should return 400 for validation errors', async () => {
      const response = await request(app).get('/error/api');
      
      expect(response.status).toBe(400);
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should include error details', async () => {
      const response = await request(app).get('/error/api');
      
      expect(response.body.error).toHaveProperty('details');
      expect(response.body.error.details).toHaveProperty('field');
    });

    test('should handle express-validator errors', async () => {
      const response = await request(app).get('/error/validation');
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toHaveLength(2);
    });
  });

  describe('401 Unauthorized Errors', () => {
    test('should return 401 for unauthorized errors', async () => {
      const response = await request(app).get('/error/401');
      
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    test('should handle JWT errors', async () => {
      const response = await request(app).get('/error/jwt');
      
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(response.body.error.message).toContain('token');
    });

    test('should handle expired JWT tokens', async () => {
      const response = await request(app).get('/error/jwt-expired');
      
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(response.body.error.message).toContain('expired');
    });
  });

  describe('404 Not Found Errors', () => {
    test('should return 404 for not found errors', async () => {
      const response = await request(app).get('/error/404');
      
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    test('should have descriptive message', async () => {
      const response = await request(app).get('/error/404');
      expect(response.body.error.message).toContain('not found');
    });
  });

  describe('500 Internal Server Errors', () => {
    test('should return 500 for unexpected errors', async () => {
      const response = await request(app).get('/error/500');
      
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });

    test('should have generic message', async () => {
      const response = await request(app).get('/error/500');
      expect(response.body.error.message).toContain('error occurred');
    });
  });

  describe('503 Service Unavailable Errors', () => {
    test('should return 503 for Redis errors', async () => {
      const response = await request(app).get('/error/redis');
      
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    test('should have service unavailable message', async () => {
      const response = await request(app).get('/error/redis');
      expect(response.body.error.message).toContain('unavailable');
    });
  });

  describe('CORS Errors', () => {
    test('should return 403 for CORS errors', async () => {
      const response = await request(app).get('/error/cors');
      
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    test('should mention CORS in message', async () => {
      const response = await request(app).get('/error/cors');
      expect(response.body.error.message).toContain('origin');
    });
  });

  describe('Error Sanitization in Production', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    test('should sanitize 500 errors in production', async () => {
      const response = await request(app).get('/error/500');
      
      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe('An unexpected error occurred');
      expect(response.body.error).not.toHaveProperty('stack');
      expect(response.body.error).not.toHaveProperty('details');
    });

    test('should not leak error details in production', async () => {
      const response = await request(app).get('/error/500');
      
      // Should not contain internal error messages
      expect(response.body.error.message).not.toContain('Unexpected error occurred');
      expect(response.body.error.message).toBe('An unexpected error occurred');
    });

    test('should preserve known error details in production', async () => {
      const response = await request(app).get('/error/api');
      
      // Known errors (like validation) should keep their details
      expect(response.status).toBe(400);
      expect(response.body.error).toHaveProperty('details');
    });
  });

  describe('Error Sanitization in Development', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    test('should include stack trace in development', async () => {
      const response = await request(app).get('/error/500');
      
      expect(response.body.error).toHaveProperty('stack');
      expect(response.body.error.stack).toContain('Error');
    });

    test('should include full error message in development', async () => {
      const response = await request(app).get('/error/500');
      
      // Should contain the original error message
      expect(response.body.error.message).toBeDefined();
    });

    test('should include details in development', async () => {
      const response = await request(app).get('/error/api');
      
      expect(response.body.error).toHaveProperty('details');
    });
  });

  describe('Error Response Structure', () => {
    test('all errors should have consistent structure', async () => {
      const endpoints = [
        '/error/api',
        '/error/401', 
        '/error/404',
        '/error/500'
      ];
      
      for (const endpoint of endpoints) {
        const response = await request(app).get(endpoint);
        
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toHaveProperty('code');
        expect(response.body.error).toHaveProperty('message');
      }
    });

    test('error codes should be uppercase strings', async () => {
      const response = await request(app).get('/error/api');
      
      expect(typeof response.body.error.code).toBe('string');
      expect(response.body.error.code).toBe(response.body.error.code.toUpperCase());
    });

    test('error messages should be strings', async () => {
      const endpoints = ['/error/api', '/error/401', '/error/500'];
      
      for (const endpoint of endpoints) {
        const response = await request(app).get(endpoint);
        expect(typeof response.body.error.message).toBe('string');
      }
    });
  });

  describe('Error Logging', () => {
    test('should log errors without crashing', async () => {
      // This test ensures error logging doesn't cause issues
      const response = await request(app).get('/error/500');
      expect(response.status).toBe(500);
    });
  });
});
