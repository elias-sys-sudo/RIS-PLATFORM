const JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';
process.env.JWT_SECRET = JWT_SECRET;
process.env.JWT_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
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

import * as authRepo from '../../../src/services/auth/auth.repository';
import * as authService from '../../../src/services/auth/auth.service';
import type { LoginHistoryRecord } from '../../../src/services/auth/auth.types';

const repo = authRepo as jest.Mocked<typeof authRepo>;

describe('login history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authService.setRedisClient(mockRedis as never);
  });

  describe('getLoginActivity', () => {
    it('returns recent login history from repository', async () => {
      const mockHistory: LoginHistoryRecord[] = [
        {
          id: 'lh-1',
          user_id: 'user-001',
          ip_address: '192.168.1.1',
          user_agent: 'Chrome/120',
          country: null,
          success: true,
          created_at: '2024-01-01T10:00:00Z',
        },
        {
          id: 'lh-2',
          user_id: 'user-001',
          ip_address: '10.0.0.1',
          user_agent: 'Firefox/120',
          country: null,
          success: false,
          created_at: '2024-01-01T09:00:00Z',
        },
      ];

      repo.getLoginHistory.mockResolvedValue(mockHistory);

      const result = await authService.getLoginActivity('user-001');

      expect(result).toEqual(mockHistory);
      expect(repo.getLoginHistory).toHaveBeenCalledWith('user-001', 20);
    });

    it('returns empty array when no history exists', async () => {
      repo.getLoginHistory.mockResolvedValue([]);

      const result = await authService.getLoginActivity('user-001');

      expect(result).toEqual([]);
    });
  });

  describe('login flow records login history', () => {
    it('records failed login in login_history', async () => {
      repo.findUserByEmail.mockResolvedValue(null);
      repo.createLoginHistoryEntry.mockResolvedValue();
      repo.createAuditEntry.mockResolvedValue();

      await expect(
        authService.login('bad@test.com', 'password', '127.0.0.1', 'jest'),
      ).rejects.toThrow();

      expect(repo.createLoginHistoryEntry).toHaveBeenCalledWith(
        null,
        '127.0.0.1',
        'jest',
        null,
        false,
      );
    });
  });
});
