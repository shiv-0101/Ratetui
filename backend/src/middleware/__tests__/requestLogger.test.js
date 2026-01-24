/**
 * Request Logger Tests
 * 
 * Unit tests for request logging middleware
 */

const {
  addRequestId,
  maskIP,
  logError,
} = require('../../middleware/requestLogger');

describe('Request Logger Middleware', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('addRequestId', () => {
    test('should add request ID to request object', () => {
      const req = {};
      const res = {
        setHeader: jest.fn(),
      };
      const next = jest.fn();

      addRequestId(req, res, next);

      expect(req.id).toBeDefined();
      expect(typeof req.id).toBe('string');
      expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    test('should set X-Request-ID header', () => {
      const req = {};
      const res = {
        setHeader: jest.fn(),
      };
      const next = jest.fn();

      addRequestId(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.id);
    });

    test('should call next middleware', () => {
      const req = {};
      const res = {
        setHeader: jest.fn(),
      };
      const next = jest.fn();

      addRequestId(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('should generate unique IDs for each request', () => {
      const req1 = {};
      const req2 = {};
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      addRequestId(req1, res, next);
      addRequestId(req2, res, next);

      expect(req1.id).not.toBe(req2.id);
    });
  });

  describe('maskIP - Development Mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    test('should not mask IPv4 in development', () => {
      const result = maskIP('192.168.1.100');
      expect(result).toBe('192.168.1.100');
    });

    test('should not mask IPv6 in development', () => {
      const result = maskIP('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
      expect(result).toBe('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    });

    test('should handle localhost', () => {
      const result = maskIP('127.0.0.1');
      expect(result).toBe('127.0.0.1');
    });
  });

  describe('maskIP - Production Mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    test('should mask IPv4 in production', () => {
      const result = maskIP('192.168.1.100');
      expect(result).toBe('192.168.x.x');
    });

    test('should mask only last two octets', () => {
      const result = maskIP('10.20.30.40');
      expect(result).toBe('10.20.x.x');
    });

    test('should mask IPv6 in production', () => {
      const result = maskIP('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
      expect(result).toBe('2001:0db8:x:x:x:x:x:x');
    });

    test('should mask only first two groups of IPv6', () => {
      const result = maskIP('fe80:1234:5678:abcd:ef01:2345:6789:abcd');
      expect(result).toBe('fe80:1234:x:x:x:x:x:x');
    });

    test('should handle localhost IPv4', () => {
      const result = maskIP('127.0.0.1');
      expect(result).toBe('127.0.x.x');
    });

    test('should handle localhost IPv6', () => {
      const result = maskIP('::1');
      expect(result).toMatch(/x/);
    });

    test('should handle unknown IP format', () => {
      const result = maskIP('unknown');
      expect(result).toBe('x.x.x.x');
    });

    test('should handle empty string', () => {
      const result = maskIP('');
      expect(result).toBe('x.x.x.x');
    });
  });

  describe('logError', () => {
    let mockLogger;

    beforeEach(() => {
      mockLogger = require('../../utils/logger');
      mockLogger.error = jest.fn();
    });

    test('should log error with request details', () => {
      const err = new Error('Test error');
      err.code = 'TEST_ERROR';
      
      const req = {
        id: 'test-id-123',
        method: 'GET',
        url: '/api/test',
        ip: '192.168.1.1',
      };
      
      const res = {};

      logError(err, req, res);

      expect(mockLogger.error).toHaveBeenCalled();
      const logCall = mockLogger.error.mock.calls[0];
      expect(logCall[0]).toBe('Request Error');
      expect(logCall[1]).toHaveProperty('requestId', 'test-id-123');
      expect(logCall[1]).toHaveProperty('method', 'GET');
      expect(logCall[1]).toHaveProperty('url', '/api/test');
    });

    test('should mask IP in error logs', () => {
      process.env.NODE_ENV = 'production';
      
      const err = new Error('Test error');
      const req = {
        id: 'test-id',
        method: 'POST',
        url: '/api/data',
        ip: '192.168.1.100',
      };
      const res = {};

      logError(err, req, res);

      const logCall = mockLogger.error.mock.calls[0];
      expect(logCall[1].ip).toBe('192.168.x.x');
    });

    test('should include error code when available', () => {
      const err = new Error('Test error');
      err.code = 'VALIDATION_ERROR';
      
      const req = {
        id: 'test-id',
        method: 'GET',
        url: '/test',
        ip: '127.0.0.1',
      };
      const res = {};

      logError(err, req, res);

      const logCall = mockLogger.error.mock.calls[0];
      expect(logCall[1].error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    test('should include stack trace in development', () => {
      process.env.NODE_ENV = 'development';
      
      const err = new Error('Test error');
      const req = {
        id: 'test-id',
        method: 'GET',
        url: '/test',
        ip: '127.0.0.1',
      };
      const res = {};

      logError(err, req, res);

      const logCall = mockLogger.error.mock.calls[0];
      expect(logCall[1].error.stack).toBeDefined();
    });

    test('should not include stack trace in production', () => {
      process.env.NODE_ENV = 'production';
      
      const err = new Error('Test error');
      const req = {
        id: 'test-id',
        method: 'GET',
        url: '/test',
        ip: '127.0.0.1',
      };
      const res = {};

      logError(err, req, res);

      const logCall = mockLogger.error.mock.calls[0];
      expect(logCall[1].error.stack).toBeUndefined();
    });

    test('should handle missing request IP', () => {
      const err = new Error('Test error');
      const req = {
        id: 'test-id',
        method: 'GET',
        url: '/test',
      };
      const res = {};

      logError(err, req, res);

      const logCall = mockLogger.error.mock.calls[0];
      expect(logCall[1].ip).toBeDefined();
    });
  });

  describe('Integration - Request Flow', () => {
    test('should handle full request logging flow', () => {
      const req = {};
      const res = {
        setHeader: jest.fn(),
        on: jest.fn(),
        statusCode: 200,
      };
      const next = jest.fn();

      // Add request ID
      addRequestId(req, res, next);

      expect(req.id).toBeDefined();
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.id);
      expect(next).toHaveBeenCalled();
    });

    test('should preserve request ID through error logging', () => {
      const req = { id: 'preserved-id' };
      const res = { setHeader: jest.fn() };
      
      addRequestId(req, res, jest.fn());
      
      const err = new Error('Test');
      req.method = 'GET';
      req.url = '/test';
      req.ip = '127.0.0.1';
      
      const mockLogger = require('../../utils/logger');
      mockLogger.error = jest.fn();
      
      logError(err, req, res);

      const logCall = mockLogger.error.mock.calls[0];
      expect(logCall[1].requestId).toBeDefined();
    });
  });
});
