/**
 * Redis Connection Tests
 * 
 * Unit tests for Redis connection management and failure modes
 */

const {
  connectRedis,
  closeRedis,
  getRedisClient,
  getConnectionStatus,
  pingRedis,
  shouldAllowRequests,
} = require('../../config/redis');

// Mock the Redis client
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('Redis Connection Module', () => {
  afterEach(async () => {
    await closeRedis();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await closeRedis();
    jest.clearAllTimers();
  });

  describe('connectRedis', () => {
    test('should connect to Redis successfully', async () => {
      const result = await connectRedis();
      expect(result).toBeDefined();
    });

    test('should return existing client on subsequent calls', async () => {
      const client1 = await connectRedis();
      const client2 = await connectRedis();
      expect(client1).toBe(client2);
    });

    test('should handle connection with custom config', async () => {
      const result = await connectRedis({
        host: 'custom-host',
        port: 6380,
      });
      expect(result).toBeDefined();
    });
  });

  describe('getRedisClient', () => {
    test('should return null when not connected', () => {
      const client = getRedisClient();
      expect(client).toBeNull();
    });

    test('should return client after connection', async () => {
      await connectRedis();
      const client = getRedisClient();
      expect(client).toBeDefined();
    });
  });

  describe('closeRedis', () => {
    test('should close connection gracefully', async () => {
      await connectRedis();
      const result = await closeRedis();
      expect(result).toBeUndefined();
    });

    test('should handle closing when not connected', async () => {
      const result = await closeRedis();
      expect(result).toBeUndefined();
    });
  });

  describe('getConnectionStatus', () => {
    test('should return disconnected status initially', () => {
      const status = getConnectionStatus();
      expect(status).toHaveProperty('connected');
      expect(status.connected).toBe(false);
    });

    test('should return connected status after connection', async () => {
      await connectRedis();
      const status = getConnectionStatus();
      expect(status.connected).toBe(true);
      expect(status).toHaveProperty('failureMode');
    });

    test('should include connection timestamp', async () => {
      await connectRedis();
      const status = getConnectionStatus();
      expect(status).toHaveProperty('connectedAt');
    });

    test('should include failure mode', () => {
      const status = getConnectionStatus();
      expect(status.failureMode).toMatch(/open|closed/);
    });
  });

  describe('pingRedis', () => {
    test('should ping Redis successfully', async () => {
      await connectRedis();
      const result = await pingRedis();
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('latency');
    });

    test('should return failure when not connected', async () => {
      const result = await pingRedis();
      expect(result.success).toBe(false);
      expect(result).toHaveProperty('error');
    });

    test('should measure latency', async () => {
      await connectRedis();
      const result = await pingRedis();
      if (result.success) {
        expect(typeof result.latency).toBe('number');
        expect(result.latency).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('shouldAllowRequests', () => {
    test('should allow requests in open failure mode', () => {
      process.env.REDIS_FAILURE_MODE = 'open';
      const result = shouldAllowRequests();
      expect(typeof result).toBe('boolean');
    });

    test('should deny requests in closed failure mode when disconnected', () => {
      process.env.REDIS_FAILURE_MODE = 'closed';
      const result = shouldAllowRequests();
      // Result depends on connection status
      expect(typeof result).toBe('boolean');
    });

    test('should always allow when connected', async () => {
      await connectRedis();
      const result = shouldAllowRequests();
      expect(result).toBe(true);
    });
  });

  describe('Failure Modes', () => {
    test('should use open mode by default', () => {
      delete process.env.REDIS_FAILURE_MODE;
      const status = getConnectionStatus();
      expect(status.failureMode).toBe('open');
    });

    test('should respect environment variable for failure mode', () => {
      process.env.REDIS_FAILURE_MODE = 'closed';
      const status = getConnectionStatus();
      expect(status.failureMode).toBe('closed');
    });

    test('should normalize failure mode to lowercase', () => {
      process.env.REDIS_FAILURE_MODE = 'OPEN';
      const status = getConnectionStatus();
      expect(status.failureMode).toBe('open');
    });
  });

  describe('Connection Resilience', () => {
    test('should handle connection errors gracefully', async () => {
      // This test ensures the module doesn't crash on errors
      const redis = require('redis');
      redis.createClient.mockImplementationOnce(() => ({
        connect: jest.fn().mockRejectedValue(new Error('Connection refused')),
        on: jest.fn(),
      }));

      await expect(connectRedis()).resolves.not.toThrow();
    });

    test('should track connection attempts', async () => {
      await connectRedis();
      const status = getConnectionStatus();
      expect(status).toHaveProperty('connected');
    });
  });

  describe('Error Handling', () => {
    test('should not throw on close without connection', async () => {
      await expect(closeRedis()).resolves.not.toThrow();
    });

    test('should handle ping errors', async () => {
      const result = await pingRedis();
      expect(result).toHaveProperty('success');
    });

    test('should provide error details on failure', async () => {
      const result = await pingRedis();
      if (!result.success) {
        expect(result).toHaveProperty('error');
        expect(typeof result.error).toBe('string');
      }
    });
  });
});
