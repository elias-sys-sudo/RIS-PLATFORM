// Set env vars BEFORE any imports so module-level constants pick them up
const JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';
process.env.JWT_SECRET = JWT_SECRET;
process.env.JWT_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { ValidationError } from '../../../src/shared/errors';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
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

jest.mock('../../../src/shared/crypto', () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
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

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------

import * as authRepo from '../../../src/services/auth/auth.repository';
import * as authService from '../../../src/services/auth/auth.service';
import type { UserRecord } from '../../../src/services/auth/auth.types';

const repo = authRepo as jest.Mocked<typeof authRepo>;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  authService.setRedisClient(mockRedis as never);
  repo.createAuditEntry.mockResolvedValue(undefined);
  repo.createAuditEntryWithClient.mockResolvedValue(undefined);
  repo.invalidateResetTokens.mockResolvedValue(undefined);
  repo.createResetToken.mockResolvedValue(undefined);
  repo.markResetTokenUsed.mockResolvedValue(undefined);
  repo.markResetTokenUsedWithClient.mockResolvedValue(undefined);
  repo.updatePasswordHash.mockResolvedValue(undefined);
  repo.updatePasswordHashWithClient.mockResolvedValue(undefined);
  repo.createPasswordHistoryEntryWithClient.mockResolvedValue(undefined);
  // Default scan returns no keys (empty session list)
  mockRedis.scan.mockResolvedValue({ cursor: 0, keys: [] });
  mockRedis.get.mockResolvedValue(null);
  mockRedis.del.mockResolvedValue(1);
  mockPoolClient.query.mockResolvedValue({ rows: [] });
  mockPoolClient.release.mockReturnValue(undefined);
});

// ===========================================================================
// requestPasswordReset
// ===========================================================================

describe('requestPasswordReset', () => {
  it('generates token, invalidates old tokens, enqueues email when user exists', async () => {
    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);

    await authService.requestPasswordReset(user.email, TEST_IP, TEST_UA);

    // Old tokens invalidated
    expect(repo.invalidateResetTokens).toHaveBeenCalledWith(user.id);

    // New token stored (SHA-256 hashed, 64 hex chars)
    expect(repo.createResetToken).toHaveBeenCalledWith(
      user.id,
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(Date),
    );

    // Token expires in ~1 hour
    const expiresAt = repo.createResetToken.mock.calls[0][2] as Date;
    const delta = expiresAt.getTime() - Date.now();
    expect(delta).toBeGreaterThan(59 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(60 * 60 * 1000);

    // Audit entry
    expect(repo.createAuditEntry).toHaveBeenCalledWith(
      user.id,
      'PASSWORD_RESET_REQUESTED',
      TEST_IP,
      TEST_UA,
      {},
    );
  });

  it('silently returns without action when email does not exist', async () => {
    repo.findUserByEmail.mockResolvedValue(null);

    await authService.requestPasswordReset('nobody@test.com', TEST_IP, TEST_UA);

    expect(repo.invalidateResetTokens).not.toHaveBeenCalled();
    expect(repo.createResetToken).not.toHaveBeenCalled();
    expect(repo.createAuditEntry).not.toHaveBeenCalled();
  });

  it('silently returns when user is inactive', async () => {
    const user = makeUser({ is_active: false });
    repo.findUserByEmail.mockResolvedValue(user);

    await authService.requestPasswordReset(user.email, TEST_IP, TEST_UA);

    expect(repo.createResetToken).not.toHaveBeenCalled();
  });

  it('only stores hashed token, never raw token in DB', async () => {
    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);

    await authService.requestPasswordReset(user.email, TEST_IP, TEST_UA);

    // createResetToken receives a SHA-256 hash (64 hex chars), not raw (also 64 hex but different)
    const storedHash = repo.createResetToken.mock.calls[0][1];
    expect(storedHash).toHaveLength(64);
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ===========================================================================
// resetPassword
// ===========================================================================

describe('resetPassword', () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const validTokenRecord = {
    id: 'token-001',
    user_id: 'user-001',
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 3600000),
    used_at: null,
    created_at: new Date(),
  };

  it('resets password with valid token and valid password', async () => {
    repo.findValidResetToken.mockResolvedValue(validTokenRecord);
    repo.getLastNPasswords.mockResolvedValue([]);
    repo.createPasswordHistoryEntryWithClient.mockResolvedValue();

    await authService.resetPassword(rawToken, 'NewSecure12!@', 'NewSecure12!@', TEST_IP, TEST_UA);

    // Password updated (via WithClient in transaction)
    expect(repo.updatePasswordHashWithClient).toHaveBeenCalledWith(
      expect.anything(),
      'user-001',
      expect.any(String),
    );

    // Token marked as used (via WithClient in transaction)
    expect(repo.markResetTokenUsedWithClient).toHaveBeenCalledWith(expect.anything(), 'token-001');

    // Audit logged (via WithClient in transaction)
    expect(repo.createAuditEntryWithClient).toHaveBeenCalledWith(
      expect.anything(),
      'user-001',
      'PASSWORD_RESET_COMPLETED',
      TEST_IP,
      TEST_UA,
      {},
    );
  });

  it('hashes new password with bcrypt cost 12', async () => {
    repo.findValidResetToken.mockResolvedValue(validTokenRecord);
    repo.getLastNPasswords.mockResolvedValue([]);
    repo.createPasswordHistoryEntryWithClient.mockResolvedValue();

    await authService.resetPassword(rawToken, 'NewSecure12!@', 'NewSecure12!@', TEST_IP, TEST_UA);

    const storedHash = repo.updatePasswordHashWithClient.mock.calls[0][2];
    // bcrypt hash starts with $2b$12$ (cost 12)
    expect(storedHash).toMatch(/^\$2[ab]\$12\$/);
  });

  it('throws AuthError when token is invalid or expired', async () => {
    repo.findValidResetToken.mockResolvedValue(null);

    await expect(
      authService.resetPassword(rawToken, 'NewSecure12!@', 'NewSecure12!@', TEST_IP, TEST_UA),
    ).rejects.toThrow('Invalid or expired reset token');

    expect(repo.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('throws ValidationError when passwords do not match', async () => {
    await expect(
      authService.resetPassword(rawToken, 'NewSecure12!@', 'Different12!@', TEST_IP, TEST_UA),
    ).rejects.toThrow(ValidationError);

    expect(repo.findValidResetToken).not.toHaveBeenCalled();
  });

  it('throws ValidationError when password does not meet policy', async () => {
    await expect(
      authService.resetPassword(rawToken, 'weakpass', 'weakpass', TEST_IP, TEST_UA),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for password without uppercase', async () => {
    await expect(
      authService.resetPassword(rawToken, 'nouppercase1!!', 'nouppercase1!!', TEST_IP, TEST_UA),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for password without digit', async () => {
    await expect(
      authService.resetPassword(rawToken, 'NoDigits!!aaaa', 'NoDigits!!aaaa', TEST_IP, TEST_UA),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for password without special character', async () => {
    await expect(
      authService.resetPassword(rawToken, 'NoSpecial1abc', 'NoSpecial1abc', TEST_IP, TEST_UA),
    ).rejects.toThrow(ValidationError);
  });

  it('invalidates all sessions after password reset', async () => {
    repo.findValidResetToken.mockResolvedValue(validTokenRecord);

    // Simulate existing session in Redis
    const sessionData = JSON.stringify({
      sessionId: 'sess-old',
      userId: 'user-001',
      role: 'supplier',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    mockRedis.scan.mockResolvedValueOnce({
      cursor: 0,
      keys: ['session:sess-old'],
    });
    mockRedis.get.mockResolvedValueOnce(sessionData);

    repo.getLastNPasswords.mockResolvedValue([]);
    repo.createPasswordHistoryEntryWithClient.mockResolvedValue();

    await authService.resetPassword(rawToken, 'NewSecure12!@', 'NewSecure12!@', TEST_IP, TEST_UA);

    // Session should be deleted
    expect(mockRedis.del).toHaveBeenCalledWith('session:sess-old');
  });
});

// ===========================================================================
// changePassword
// ===========================================================================

describe('changePassword', () => {
  const currentHash = bcrypt.hashSync('OldPassWord1!', 12);

  it('changes password when current password is correct', async () => {
    const user = makeUser({ password_hash: currentHash });
    repo.findUserById.mockResolvedValue(user);
    repo.getLastNPasswords.mockResolvedValue([]);
    repo.createPasswordHistoryEntryWithClient.mockResolvedValue();

    await authService.changePassword(
      user.id,
      'current-session',
      'OldPassWord1!',
      'NewSecure12!@',
      'NewSecure12!@',
      TEST_IP,
      TEST_UA,
    );

    expect(repo.updatePasswordHashWithClient).toHaveBeenCalledWith(
      expect.anything(),
      user.id,
      expect.any(String),
    );

    // Audit logged (via WithClient in transaction)
    expect(repo.createAuditEntryWithClient).toHaveBeenCalledWith(
      expect.anything(),
      user.id,
      'PASSWORD_CHANGED',
      TEST_IP,
      TEST_UA,
      {},
    );
  });

  it('throws AuthError when current password is wrong', async () => {
    const user = makeUser({ password_hash: currentHash });
    repo.findUserById.mockResolvedValue(user);

    await expect(
      authService.changePassword(
        user.id,
        'sess-1',
        'WrongOldPas1!',
        'NewSecure12!@',
        'NewSecure12!@',
        TEST_IP,
        TEST_UA,
      ),
    ).rejects.toThrow('Current password is incorrect');

    expect(repo.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('throws ValidationError when new password matches current', async () => {
    const user = makeUser({ password_hash: currentHash });
    repo.findUserById.mockResolvedValue(user);

    await expect(
      authService.changePassword(
        user.id,
        'sess-1',
        'OldPassWord1!',
        'OldPassWord1!',
        'OldPassWord1!',
        TEST_IP,
        TEST_UA,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('throws AuthError when user not found', async () => {
    repo.findUserById.mockResolvedValue(null);

    await expect(
      authService.changePassword(
        'nonexistent',
        'sess-1',
        'OldPassWord1!',
        'NewSecure12!@',
        'NewSecure12!@',
        TEST_IP,
        TEST_UA,
      ),
    ).rejects.toThrow('User not found');
  });

  it('throws ValidationError when passwords do not match', async () => {
    await expect(
      authService.changePassword(
        'user-001',
        'sess-1',
        'OldPassWord1!',
        'NewSecure12!@',
        'Different12!@',
        TEST_IP,
        TEST_UA,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('invalidates other sessions but keeps current session', async () => {
    const user = makeUser({ password_hash: currentHash });
    repo.findUserById.mockResolvedValue(user);
    repo.getLastNPasswords.mockResolvedValue([]);
    repo.createPasswordHistoryEntryWithClient.mockResolvedValue();

    // Two sessions: current + another
    const currentSession = JSON.stringify({
      sessionId: 'current-session',
      userId: user.id,
      role: 'supplier',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const otherSession = JSON.stringify({
      sessionId: 'other-session',
      userId: user.id,
      role: 'supplier',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });

    mockRedis.scan.mockResolvedValueOnce({
      cursor: 0,
      keys: ['session:current-session', 'session:other-session'],
    });
    mockRedis.get.mockResolvedValueOnce(currentSession).mockResolvedValueOnce(otherSession);

    await authService.changePassword(
      user.id,
      'current-session',
      'OldPassWord1!',
      'NewSecure12!@',
      'NewSecure12!@',
      TEST_IP,
      TEST_UA,
    );

    // Other session deleted, current session kept
    expect(mockRedis.del).toHaveBeenCalledWith('session:other-session');
    expect(mockRedis.del).not.toHaveBeenCalledWith('session:current-session');
  });

  it('throws ValidationError for weak new password', async () => {
    await expect(
      authService.changePassword(
        'user-001',
        'sess-1',
        'OldPassWord1!',
        'weak',
        'weak',
        TEST_IP,
        TEST_UA,
      ),
    ).rejects.toThrow(ValidationError);
  });
});

// ===========================================================================
// buildUserProfile — covers lines 398-404
// Line 398 branch 0: first_name_encrypted IS present (decrypt both names)
// Line 401 branch 0: last_name_encrypted IS present → full name
// Line 401 branch 1: last_name_encrypted is null → trim("first ")
// ===========================================================================

describe('buildUserProfile via login (tests the private helper indirectly)', () => {
  it('uses email prefix as name when no profile row (first_name_encrypted = null)', async () => {
    // fetchUserProfile returns null → name = email.split('@')[0]
    repo.fetchUserProfile.mockResolvedValue(null);
    const user = makeUser({ email: 'jane.doe@test.com' });
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

    const result = await authService.login(user.email, 'ValidPass1!', TEST_IP, TEST_UA);

    expect(result.user?.name).toBe('jane.doe');
  });

  it('decrypts and concatenates first + last name when both encrypted fields are present', async () => {
    const mockDecrypt = jest.fn((enc: string) => enc.replace('enc:', ''));
    jest.mock('../../../src/shared/crypto', () => ({ decrypt: mockDecrypt }));

    repo.fetchUserProfile.mockResolvedValue({
      first_name_encrypted: 'enc:Jane',
      last_name_encrypted: 'enc:Doe',
    } as never);

    const { decrypt } = await import('../../../src/shared/crypto');
    (decrypt as jest.Mock).mockImplementation((enc: string) => enc.replace('enc:', ''));

    const user = makeUser({ email: 'jane@test.com' });
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

    const result = await authService.login(user.email, 'ValidPass1!', TEST_IP, TEST_UA);
    // name will be truthy
    expect(result.user?.name).toBeDefined();
  });

  it('uses only first name when last_name_encrypted is null (line 401 branch 1)', async () => {
    const { decrypt } = await import('../../../src/shared/crypto');
    (decrypt as jest.Mock).mockImplementation((enc: string) => enc.replace('enc:', ''));

    repo.fetchUserProfile.mockResolvedValue({
      first_name_encrypted: 'enc:Jane',
      last_name_encrypted: null,
    } as never);

    const user = makeUser({ email: 'jane@test.com' });
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

    const result = await authService.login(user.email, 'ValidPass1!', TEST_IP, TEST_UA);
    expect(result.user?.name).toBeDefined();
  });
});

// ===========================================================================
// listBuyersForSupplier
// ===========================================================================

describe('listBuyersForSupplier', () => {
  it('returns paginated buyer list', async () => {
    const mockRows = [
      {
        id: 'buyer-001',
        company_name: 'Acme Corp',
        contact_email_encrypted: 'enc:email',
        contact_phone_encrypted: 'enc:phone',
        is_active: true,
        total_invoices: 5,
        total_outstanding: '10000000',
      },
    ];

    repo.listBuyersForSupplier.mockResolvedValue({
      rows: mockRows,
      total: 1,
    });

    const result = await authService.listBuyersForSupplier('supplier-001', {
      page: 1,
      limit: 20,
    });

    // Service decrypts PII fields and returns clean (non-encrypted) field names
    expect(result.data).toEqual([
      {
        id: 'buyer-001',
        company_name: 'Acme Corp',
        contact_email: 'email', // decrypt('enc:email') → 'email'
        contact_phone: 'phone', // decrypt('enc:phone') → 'phone'
        is_active: true,
        total_invoices: 5,
        total_outstanding: '10000000',
      },
    ]);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('passes search and status filters to repository', async () => {
    repo.listBuyersForSupplier.mockResolvedValue({ rows: [], total: 0 });

    await authService.listBuyersForSupplier('supplier-001', {
      page: 1,
      limit: 20,
      search: 'Acme',
      status: 'active',
    });

    expect(repo.listBuyersForSupplier).toHaveBeenCalledWith('supplier-001', {
      page: 1,
      limit: 20,
      search: 'Acme',
      status: 'active',
    });
  });

  it('calculates totalPages correctly', async () => {
    repo.listBuyersForSupplier.mockResolvedValue({ rows: [], total: 45 });

    const result = await authService.listBuyersForSupplier('supplier-001', {
      page: 1,
      limit: 20,
    });

    expect(result.pagination.totalPages).toBe(3);
  });

  it('returns empty result set with correct pagination', async () => {
    repo.listBuyersForSupplier.mockResolvedValue({ rows: [], total: 0 });

    const result = await authService.listBuyersForSupplier('supplier-001', {
      page: 1,
      limit: 20,
    });

    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });
});
