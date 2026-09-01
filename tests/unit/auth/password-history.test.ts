const JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';
process.env.JWT_SECRET = JWT_SECRET;
process.env.JWT_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';

import bcrypt from 'bcryptjs';
import { ValidationError } from '../../../src/shared/errors';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedis),
}));

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
jest.mock('../../../src/shared/crypto', () => ({
  decrypt: jest.fn((v: string) => v),
  encrypt: jest.fn((v: string) => `encrypted:${v}`),
}));

import * as authRepo from '../../../src/services/auth/auth.repository';
import * as authService from '../../../src/services/auth/auth.service';
import type { UserRecord } from '../../../src/services/auth/auth.types';

const repo = authRepo as jest.Mocked<typeof authRepo>;

const TEST_IP = '127.0.0.1';
const TEST_UA = 'jest-test-agent';

const makeUser = (overrides: Partial<UserRecord> = {}): UserRecord => ({
  id: 'user-001',
  email: 'supplier@test.com',
  password_hash: '$2b$12$hashedpassword',
  role: 'supplier',
  is_active: true,
  email_verified: true,
  two_factor_enabled: false,
  two_factor_secret: null,
  failed_login_count: 0,
  locked_until: null,
  ...overrides,
});

describe('password history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authService.setRedisClient(mockRedis as never);
    repo.createAuditEntryWithClient.mockResolvedValue(undefined);
    repo.updatePasswordHashWithClient.mockResolvedValue(undefined);
    repo.createPasswordHistoryEntryWithClient.mockResolvedValue(undefined);
    mockPoolClient.query.mockResolvedValue({ rows: [] });
    mockPoolClient.release.mockReturnValue(undefined);
  });

  describe('changePassword — reuse prevention', () => {
    it('throws BusinessRuleError when new password matches a recent password', async () => {
      const user = makeUser();
      const currentHash = bcrypt.hashSync('CurrentPass1!xx', 4);
      user.password_hash = currentHash;

      repo.findUserById.mockResolvedValue(user);

      // Old password that the new password matches
      const oldHash = bcrypt.hashSync('NewSecure12!@', 4);
      repo.getLastNPasswords.mockResolvedValue([
        {
          id: 'ph-1',
          user_id: user.id,
          password_hash: oldHash,
          created_at: new Date().toISOString(),
        },
      ]);

      await expect(
        authService.changePassword(
          user.id,
          'session-1',
          'CurrentPass1!xx',
          'NewSecure12!@',
          'NewSecure12!@',
          TEST_IP,
          TEST_UA,
        ),
      ).rejects.toMatchObject({ errorCode: 'PASSWORD_RECENTLY_USED' });
    });

    it('succeeds when new password is not in history', async () => {
      const user = makeUser();
      const currentHash = bcrypt.hashSync('CurrentPass1!xx', 4);
      user.password_hash = currentHash;

      repo.findUserById.mockResolvedValue(user);
      repo.getLastNPasswords.mockResolvedValue([]);
      repo.updatePasswordHashWithClient.mockResolvedValue();
      repo.createPasswordHistoryEntryWithClient.mockResolvedValue();
      repo.createAuditEntryWithClient.mockResolvedValue();

      await expect(
        authService.changePassword(
          user.id,
          'session-1',
          'CurrentPass1!xx',
          'BrandNewPass12!@',
          'BrandNewPass12!@',
          TEST_IP,
          TEST_UA,
        ),
      ).resolves.toBeUndefined();

      expect(repo.createPasswordHistoryEntryWithClient).toHaveBeenCalledWith(
        expect.anything(),
        user.id,
        expect.any(String), // the new bcrypt hash
      );
    });

    it('checks last 5 passwords (calls getLastNPasswords with 5)', async () => {
      const user = makeUser();
      const currentHash = bcrypt.hashSync('CurrentPass1!xx', 4);
      user.password_hash = currentHash;

      repo.findUserById.mockResolvedValue(user);
      repo.getLastNPasswords.mockResolvedValue([]);
      repo.updatePasswordHashWithClient.mockResolvedValue();
      repo.createPasswordHistoryEntryWithClient.mockResolvedValue();
      repo.createAuditEntryWithClient.mockResolvedValue();

      await authService.changePassword(
        user.id,
        'session-1',
        'CurrentPass1!xx',
        'BrandNewPass12!@',
        'BrandNewPass12!@',
        TEST_IP,
        TEST_UA,
      );

      expect(repo.getLastNPasswords).toHaveBeenCalledWith(user.id, 5);
    });
  });

  describe('resetPassword — reuse prevention', () => {
    it('throws BusinessRuleError when password matches history', async () => {
      const tokenHash = 'a'.repeat(64);
      repo.findValidResetToken.mockResolvedValue({
        id: 'token-1',
        user_id: 'user-001',
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 3600000),
        used_at: null,
        created_at: new Date(),
      });

      const oldHash = bcrypt.hashSync('ReusedPass12!@', 4);
      repo.getLastNPasswords.mockResolvedValue([
        {
          id: 'ph-1',
          user_id: 'user-001',
          password_hash: oldHash,
          created_at: new Date().toISOString(),
        },
      ]);

      await expect(
        authService.resetPassword(tokenHash, 'ReusedPass12!@', 'ReusedPass12!@', TEST_IP, TEST_UA),
      ).rejects.toMatchObject({ errorCode: 'PASSWORD_RECENTLY_USED' });
    });
  });

  describe('password policy — minimum 12 characters', () => {
    it('rejects 8-character passwords', async () => {
      const user = makeUser();
      const currentHash = bcrypt.hashSync('CurrentPass1!xx', 4);
      user.password_hash = currentHash;
      repo.findUserById.mockResolvedValue(user);

      await expect(
        authService.changePassword(
          user.id,
          'session-1',
          'CurrentPass1!xx',
          'Short1!a', // only 8 chars
          'Short1!a',
          TEST_IP,
          TEST_UA,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('accepts 12-character passwords meeting all criteria', async () => {
      const user = makeUser();
      const currentHash = bcrypt.hashSync('CurrentPass1!xx', 4);
      user.password_hash = currentHash;

      repo.findUserById.mockResolvedValue(user);
      repo.getLastNPasswords.mockResolvedValue([]);
      repo.updatePasswordHashWithClient.mockResolvedValue();
      repo.createPasswordHistoryEntryWithClient.mockResolvedValue();
      repo.createAuditEntryWithClient.mockResolvedValue();

      await expect(
        authService.changePassword(
          user.id,
          'session-1',
          'CurrentPass1!xx',
          'ValidPass12!@',
          'ValidPass12!@',
          TEST_IP,
          TEST_UA,
        ),
      ).resolves.toBeUndefined();
    });
  });
});
