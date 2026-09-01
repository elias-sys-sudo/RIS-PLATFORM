// Set env vars BEFORE imports so the auth module loads cleanly.
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';

import { AuthError, BusinessRuleError } from '../../../src/shared/errors';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
};
jest.mock('redis', () => ({ createClient: jest.fn(() => mockRedis) }));

const mockPoolClient = {
  query: jest.fn().mockResolvedValue({ rows: [] }),
  release: jest.fn(),
};
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn().mockResolvedValue(mockPoolClient) },
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

import * as authRepo from '../../../src/services/auth/auth.repository';
import * as authService from '../../../src/services/auth/auth.service';
import type { UserRecord } from '../../../src/services/auth/auth.types';
import { query as poolQuery } from '../../../src/shared/database/pool';

const repo = authRepo as jest.Mocked<typeof authRepo>;
const dbQuery = poolQuery as jest.Mock;
const TEST_IP = '127.0.0.1';
const TEST_UA = 'jest-test-agent';

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-001',
    email: 'supplier@test.com',
    password_hash: '$2b$12$hashedpassword',
    role: 'supplier',
    is_active: true,
    email_verified: true,
    two_factor_enabled: true,
    two_factor_secret: 'JBSWY3DPEHPK3PXP',
    failed_login_count: 0,
    locked_until: null,
    ...overrides,
  };
}

describe('TOTP backup codes (REQ-AUTH-008)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authService.setRedisClient(mockRedis as never);
    repo.createAuditEntry.mockResolvedValue(undefined);
    repo.createAuditEntryWithClient.mockResolvedValue(undefined);
    repo.invalidateBackupCodesWithClient.mockResolvedValue(undefined);
    repo.createBackupCodeWithClient.mockResolvedValue(undefined);
    repo.markBackupCodeUsedWithClient.mockResolvedValue(undefined);
  });

  describe('generateBackupCodes', () => {
    it('returns 8 unique 8-character uppercase codes', async () => {
      repo.findUserById.mockResolvedValueOnce(makeUser());

      const codes = await authService.generateBackupCodes('user-001', TEST_IP, TEST_UA);

      expect(codes).toHaveLength(8);
      expect(new Set(codes).size).toBe(8);
      for (const c of codes) {
        expect(c).toHaveLength(8);
        expect(c).toMatch(/^[A-Z0-9_-]{8}$/);
      }
    });

    it('invalidates prior unused codes then writes 8 new hashes in one transaction', async () => {
      repo.findUserById.mockResolvedValueOnce(makeUser());

      await authService.generateBackupCodes('user-001', TEST_IP, TEST_UA);

      expect(repo.invalidateBackupCodesWithClient).toHaveBeenCalledTimes(1);
      expect(repo.createBackupCodeWithClient).toHaveBeenCalledTimes(8);
    });

    it('audits with BACKUP_CODES_GENERATED', async () => {
      repo.findUserById.mockResolvedValueOnce(makeUser());

      await authService.generateBackupCodes('user-001', TEST_IP, TEST_UA);

      expect(repo.createAuditEntry).toHaveBeenCalledWith(
        'user-001',
        'BACKUP_CODES_GENERATED',
        TEST_IP,
        TEST_UA,
        expect.objectContaining({ count: 8 }),
      );
    });

    it('rejects when 2FA is not enabled', async () => {
      repo.findUserById.mockResolvedValueOnce(makeUser({ two_factor_enabled: false }));

      await expect(
        authService.generateBackupCodes('user-001', TEST_IP, TEST_UA),
      ).rejects.toBeInstanceOf(BusinessRuleError);
      expect(repo.invalidateBackupCodesWithClient).not.toHaveBeenCalled();
    });
  });

  describe('verifyTwoFactor with backup code fallback', () => {
    function makePartialToken(): string {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
      return jwt.sign(
        { userId: 'user-001', role: 'supplier', sessionId: 'sess-1', type: 'partial_auth' },
        process.env.JWT_SECRET as string,
        { expiresIn: '5m' },
      );
    }

    function stubFindUserForTwoFactor(user: UserRecord | null): void {
      // findUserForTwoFactor (private in service) hits pool.query directly.
      dbQuery.mockResolvedValueOnce({ rows: user ? [user] : [], rowCount: user ? 1 : 0 });
    }

    it('consumes a valid 8-char backup code on first use', async () => {
      const user = makeUser();
      repo.findUserById.mockResolvedValue(user);
      stubFindUserForTwoFactor(user);

      const fakeRecord = {
        id: 'code-1',
        user_id: 'user-001',
        code_hash: 'unused',
        used_at: null,
        created_at: new Date(),
      };
      repo.findUnusedBackupCode.mockResolvedValueOnce(fakeRecord);
      repo.hasRecentLoginWithSameUserAgent.mockResolvedValueOnce(true);
      repo.recordLogin.mockResolvedValue(undefined);
      repo.createLoginHistoryEntry.mockResolvedValue(undefined);
      repo.fetchUserProfile.mockResolvedValue(null as never);

      mockRedis.set.mockResolvedValueOnce('OK');

      const partial = makePartialToken();
      await authService.verifyTwoFactor(partial, 'ABCD1234', TEST_IP, TEST_UA);

      expect(repo.findUnusedBackupCode).toHaveBeenCalledWith('user-001', expect.any(String));
      expect(repo.markBackupCodeUsedWithClient).toHaveBeenCalledWith(expect.anything(), 'code-1');
    });

    it('rejects when 8-char code is not found (single-use semantics)', async () => {
      const user = makeUser();
      repo.findUserById.mockResolvedValue(user);
      stubFindUserForTwoFactor(user);
      repo.findUnusedBackupCode.mockResolvedValueOnce(null);

      const partial = makePartialToken();
      await expect(
        authService.verifyTwoFactor(partial, 'WRONG123', TEST_IP, TEST_UA),
      ).rejects.toBeInstanceOf(AuthError);

      expect(repo.createAuditEntry).toHaveBeenCalledWith(
        'user-001',
        'BACKUP_CODE_INVALID',
        TEST_IP,
        TEST_UA,
        {},
      );
    });

    it('falls through to TOTP path when code is 6 digits', async () => {
      const user = makeUser();
      repo.findUserById.mockResolvedValue(user);
      stubFindUserForTwoFactor(user);

      const partial = makePartialToken();
      await expect(
        authService.verifyTwoFactor(partial, '123456', TEST_IP, TEST_UA),
      ).rejects.toBeInstanceOf(AuthError); // bogus 123456 TOTP

      // Backup code path was NOT taken
      expect(repo.findUnusedBackupCode).not.toHaveBeenCalled();
    });
  });
});
