const JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';
process.env.JWT_SECRET = JWT_SECRET;
process.env.JWT_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedis),
}));

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
  },
}));

jest.mock('../../../src/services/auth/auth.repository');
jest.mock('../../../src/shared/crypto', () => ({
  decrypt: jest.fn((v: string) => v),
  encrypt: jest.fn((v: string) => `encrypted:${v}`),
}));

import * as authService from '../../../src/services/auth/auth.service';

describe('concurrent sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authService.setRedisClient(mockRedis as never);
  });

  describe('getActiveSessions', () => {
    it('returns sessions belonging to the specified user', async () => {
      const session1 = JSON.stringify({
        sessionId: 'sess-1',
        userId: 'user-001',
        role: 'supplier',
        createdAt: '2024-01-01T10:00:00Z',
        expiresAt: '2024-01-08T10:00:00Z',
      });
      const session2 = JSON.stringify({
        sessionId: 'sess-2',
        userId: 'user-001',
        role: 'supplier',
        createdAt: '2024-01-02T10:00:00Z',
        expiresAt: '2024-01-09T10:00:00Z',
      });
      const otherSession = JSON.stringify({
        sessionId: 'sess-3',
        userId: 'user-999',
        role: 'supplier',
        createdAt: '2024-01-01T10:00:00Z',
        expiresAt: '2024-01-08T10:00:00Z',
      });

      mockRedis.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: ['session:sess-1', 'session:sess-2', 'session:sess-3'],
      });
      mockRedis.get
        .mockResolvedValueOnce(session1)
        .mockResolvedValueOnce(session2)
        .mockResolvedValueOnce(otherSession);

      const result = await authService.getActiveSessions('user-001');

      expect(result).toHaveLength(2);
      expect(result[0].sessionId).toBe('sess-1');
      expect(result[1].sessionId).toBe('sess-2');
    });

    it('returns empty array when no sessions exist', async () => {
      mockRedis.scan.mockResolvedValueOnce({ cursor: 0, keys: [] });

      const result = await authService.getActiveSessions('user-001');

      expect(result).toEqual([]);
    });
  });

  describe('revokeSession', () => {
    it('deletes session from Redis when it belongs to the user', async () => {
      const sessionData = JSON.stringify({
        sessionId: 'sess-1',
        userId: 'user-001',
        role: 'supplier',
        createdAt: '2024-01-01T10:00:00Z',
        expiresAt: '2024-01-08T10:00:00Z',
      });

      mockRedis.get.mockResolvedValueOnce(sessionData);
      mockRedis.del.mockResolvedValueOnce(1);

      await authService.revokeSession('sess-1', 'user-001');

      expect(mockRedis.del).toHaveBeenCalledWith('session:sess-1');
    });

    it('does not delete session belonging to another user', async () => {
      const sessionData = JSON.stringify({
        sessionId: 'sess-1',
        userId: 'user-999',
        role: 'supplier',
        createdAt: '2024-01-01T10:00:00Z',
        expiresAt: '2024-01-08T10:00:00Z',
      });

      mockRedis.get.mockResolvedValueOnce(sessionData);

      await authService.revokeSession('sess-1', 'user-001');

      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('handles non-existent session gracefully', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      await expect(authService.revokeSession('nonexistent', 'user-001')).resolves.toBeUndefined();

      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });
});
