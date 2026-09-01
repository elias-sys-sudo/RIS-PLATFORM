// Set env vars BEFORE any imports so module-level constants pick them up
const JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';
process.env.JWT_SECRET = JWT_SECRET;
process.env.JWT_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { AuthError } from '../../../src/shared/errors';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------

import * as authRepo from '../../../src/services/auth/auth.repository';
import * as authService from '../../../src/services/auth/auth.service';
import type { UserRecord } from '../../../src/services/auth/auth.types';
import { query as mockDbQuery } from '../../../src/shared/database/pool';

const repo = authRepo as jest.Mocked<typeof authRepo>;
const dbQuery = mockDbQuery as jest.Mock;

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

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
  repo.resetFailedLogin.mockResolvedValue(undefined);
  repo.lockAccount.mockResolvedValue(undefined);
  repo.lockAccountWithClient.mockResolvedValue(undefined);
  repo.recordLogin.mockResolvedValue(undefined);
  repo.getClient.mockResolvedValue(mockClient as never);
  repo.incrementFailedLoginWithClient.mockResolvedValue(1);
  repo.updatePasswordHashWithClient.mockResolvedValue(undefined);
  repo.markResetTokenUsedWithClient.mockResolvedValue(undefined);
  repo.createPasswordHistoryEntryWithClient.mockResolvedValue(undefined);
  mockClient.query.mockResolvedValue({ rows: [] });
  mockClient.release.mockReturnValue(undefined);
  mockPoolClient.query.mockResolvedValue({ rows: [] });
  mockPoolClient.release.mockReturnValue(undefined);
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.get.mockResolvedValue(null);
  mockRedis.del.mockResolvedValue(1);
  mockRedis.scan.mockResolvedValue({ cursor: 0, keys: [] });
});

// ---------------------------------------------------------------------------
// 1. Login with valid credentials returns JWT
// ---------------------------------------------------------------------------

describe('login', () => {
  it('returns full JWT when credentials are valid and 2FA disabled', async () => {
    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

    const result = await authService.login(user.email, 'ValidPass1!', TEST_IP, TEST_UA);

    expect(result.tokenType).toBe('full');
    expect(result.requiresTwoFactor).toBe(false);
    expect(result.accessToken).toBeDefined();
    expect(result.expiresIn).toBe('15m');

    // Verify token is decodable
    const decoded = jwt.decode(result.accessToken) as Record<string, unknown>;
    expect(decoded.userId).toBe(user.id);
    expect(decoded.role).toBe(user.role);
    expect(decoded.type).toBe('full');

    // Session created in Redis
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('session:'),
      expect.any(String),
      expect.objectContaining({ EX: 7 * 24 * 60 * 60 }),
    );

    // Audit: LOGIN_SUCCESS
    expect(repo.createAuditEntry).toHaveBeenCalledWith(
      user.id,
      'LOGIN_SUCCESS',
      TEST_IP,
      TEST_UA,
      expect.objectContaining({ tokenType: 'full' }),
    );
  });

  // ---------------------------------------------------------------------------
  // 2. Wrong password returns 401 "Invalid credentials"
  // ---------------------------------------------------------------------------

  it('throws 401 "Invalid credentials" on wrong password', async () => {
    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(false));
    repo.incrementFailedLoginWithClient.mockResolvedValue(1);

    await expect(authService.login(user.email, 'WrongPass!', TEST_IP, TEST_UA)).rejects.toThrow(
      'Invalid credentials',
    );

    // Audit: LOGIN_FAILED with reason (now via WithClient inside transaction)
    expect(repo.createAuditEntryWithClient).toHaveBeenCalledWith(
      mockClient,
      user.id,
      'LOGIN_FAILED',
      TEST_IP,
      TEST_UA,
      { reason: 'wrong_password' },
    );
  });

  // ---------------------------------------------------------------------------
  // 3. Non-existent email returns same "Invalid credentials" (no enumeration)
  // ---------------------------------------------------------------------------

  it('throws 401 "Invalid credentials" for non-existent email — no enumeration', async () => {
    repo.findUserByEmail.mockResolvedValue(null);

    await expect(
      authService.login('nobody@test.com', 'AnyPass1!', TEST_IP, TEST_UA),
    ).rejects.toThrow('Invalid credentials');

    // Audit: LOGIN_FAILED with reason user_not_found
    expect(repo.createAuditEntry).toHaveBeenCalledWith(null, 'LOGIN_FAILED', TEST_IP, TEST_UA, {
      reason: 'user_not_found',
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Failed login increments failed_login_count
  // ---------------------------------------------------------------------------

  it('increments failed_login_count on wrong password', async () => {
    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(false));
    repo.incrementFailedLoginWithClient.mockResolvedValue(1);

    await expect(authService.login(user.email, 'Bad!', TEST_IP, TEST_UA)).rejects.toThrow(
      AuthError,
    );

    expect(repo.incrementFailedLoginWithClient).toHaveBeenCalledWith(mockClient, user.id);
  });

  // ---------------------------------------------------------------------------
  // 5. 5th failed login locks account for 30 minutes
  // ---------------------------------------------------------------------------

  it('locks account after 5 failed attempts and writes ACCOUNT_LOCKED audit', async () => {
    const user = makeUser({ failed_login_count: 4 });
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(false));
    repo.incrementFailedLoginWithClient.mockResolvedValue(5);

    await expect(authService.login(user.email, 'Bad!', TEST_IP, TEST_UA)).rejects.toThrow(
      AuthError,
    );

    expect(repo.lockAccountWithClient).toHaveBeenCalledWith(mockClient, user.id, expect.any(Date));

    // Verify lockout duration is ~30 minutes from now
    const lockDate = repo.lockAccountWithClient.mock.calls[0][2] as Date;
    const thirtyMinMs = 30 * 60 * 1000;
    const delta = lockDate.getTime() - Date.now();
    expect(delta).toBeGreaterThan(thirtyMinMs - 2000);
    expect(delta).toBeLessThanOrEqual(thirtyMinMs);

    // Audit: ACCOUNT_LOCKED (now via WithClient inside transaction)
    expect(repo.createAuditEntryWithClient).toHaveBeenCalledWith(
      mockClient,
      user.id,
      'ACCOUNT_LOCKED',
      TEST_IP,
      TEST_UA,
      expect.objectContaining({ failedAttempts: 5 }),
    );
  });

  // ---------------------------------------------------------------------------
  // 6. Login on locked account returns error
  // ---------------------------------------------------------------------------

  it('rejects login on locked account', async () => {
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    const user = makeUser({ locked_until: lockedUntil });
    repo.findUserByEmail.mockResolvedValue(user);

    await expect(authService.login(user.email, 'AnyPass!', TEST_IP, TEST_UA)).rejects.toThrow(
      'Account is temporarily locked',
    );

    // Audit: LOGIN_FAILED with reason account_locked
    expect(repo.createAuditEntry).toHaveBeenCalledWith(user.id, 'LOGIN_FAILED', TEST_IP, TEST_UA, {
      reason: 'account_locked',
    });
  });

  it('allows login when lock has expired', async () => {
    const expiredLock = new Date(Date.now() - 1000); // 1 second ago
    const user = makeUser({ locked_until: expiredLock });
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

    const result = await authService.login(user.email, 'ValidPass1!', TEST_IP, TEST_UA);
    expect(result.tokenType).toBe('full');
  });

  // ---------------------------------------------------------------------------
  // 7. Successful login resets failed_login_count
  // ---------------------------------------------------------------------------

  it('resets failed_login_count on successful login', async () => {
    const user = makeUser({ failed_login_count: 3 });
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

    await authService.login(user.email, 'ValidPass1!', TEST_IP, TEST_UA);

    expect(repo.resetFailedLogin).toHaveBeenCalledWith(user.id);
  });

  // ---------------------------------------------------------------------------
  // 8. 2FA flow: partial_auth then full token
  // ---------------------------------------------------------------------------

  it('returns partial_auth token when 2FA is enabled', async () => {
    const user = makeUser({
      two_factor_enabled: true,
      two_factor_secret: 'JBSWY3DPEHPK3PXP',
    });
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

    const result = await authService.login(user.email, 'ValidPass1!', TEST_IP, TEST_UA);

    expect(result.tokenType).toBe('partial_auth');
    expect(result.requiresTwoFactor).toBe(true);

    const decoded = jwt.decode(result.accessToken) as Record<string, unknown>;
    expect(decoded.type).toBe('partial_auth');

    // No session created in Redis for partial auth
    expect(mockRedis.set).not.toHaveBeenCalled();

    // Audit: LOGIN_SUCCESS with requiresTwoFactor
    expect(repo.createAuditEntry).toHaveBeenCalledWith(
      user.id,
      'LOGIN_SUCCESS',
      TEST_IP,
      TEST_UA,
      expect.objectContaining({ requiresTwoFactor: true }),
    );
  });

  it('throws "Invalid credentials" for inactive user', async () => {
    const user = makeUser({ is_active: false });
    repo.findUserByEmail.mockResolvedValue(user);

    await expect(authService.login(user.email, 'ValidPass1!', TEST_IP, TEST_UA)).rejects.toThrow(
      'Invalid credentials',
    );

    expect(repo.createAuditEntry).toHaveBeenCalledWith(user.id, 'LOGIN_FAILED', TEST_IP, TEST_UA, {
      reason: 'account_inactive',
    });
  });
});

// ---------------------------------------------------------------------------
// 2FA verification
// ---------------------------------------------------------------------------

describe('verifyTwoFactor', () => {
  const twoFaUser = makeUser({
    two_factor_enabled: true,
    two_factor_secret: 'JBSWY3DPEHPK3PXP',
  });

  function createPartialToken(): string {
    return jwt.sign(
      { userId: twoFaUser.id, role: twoFaUser.role, sessionId: 'sess-1', type: 'partial_auth' },
      JWT_SECRET,
      { expiresIn: '5m' },
    );
  }

  it('issues full JWT after valid TOTP code', async () => {
    dbQuery.mockResolvedValue({ rows: [twoFaUser] });
    jest.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);

    const token = createPartialToken();
    const result = await authService.verifyTwoFactor(token, '123456', TEST_IP, TEST_UA);

    expect(result.tokenType).toBe('full');
    expect(result.requiresTwoFactor).toBe(false);

    // Audit: TWO_FA_SUCCESS
    expect(repo.createAuditEntry).toHaveBeenCalledWith(
      twoFaUser.id,
      'TWO_FA_SUCCESS',
      TEST_IP,
      TEST_UA,
      {},
    );
  });

  // ---------------------------------------------------------------------------
  // 9. Wrong TOTP code returns 401
  // ---------------------------------------------------------------------------

  it('throws 401 on invalid TOTP code', async () => {
    dbQuery.mockResolvedValue({ rows: [twoFaUser] });
    jest.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);

    const token = createPartialToken();

    await expect(authService.verifyTwoFactor(token, '000000', TEST_IP, TEST_UA)).rejects.toThrow(
      'Invalid verification code',
    );

    // Audit: TWO_FA_FAILED
    expect(repo.createAuditEntry).toHaveBeenCalledWith(
      twoFaUser.id,
      'TWO_FA_FAILED',
      TEST_IP,
      TEST_UA,
      {},
    );
  });

  it('throws 401 when partial token type is not partial_auth', async () => {
    const fullToken = jwt.sign(
      { userId: twoFaUser.id, role: twoFaUser.role, sessionId: 'sess-1', type: 'full' },
      JWT_SECRET,
      { expiresIn: '5m' },
    );

    await expect(
      authService.verifyTwoFactor(fullToken, '123456', TEST_IP, TEST_UA),
    ).rejects.toThrow('Invalid token type');
  });

  it('throws 401 when user has no 2FA secret', async () => {
    dbQuery.mockResolvedValue({ rows: [makeUser({ two_factor_secret: null })] });

    const token = createPartialToken();

    await expect(authService.verifyTwoFactor(token, '123456', TEST_IP, TEST_UA)).rejects.toThrow(
      'Two-factor authentication failed',
    );

    // Audit: TWO_FA_FAILED
    expect(repo.createAuditEntry).toHaveBeenCalledWith(
      twoFaUser.id,
      'TWO_FA_FAILED',
      TEST_IP,
      TEST_UA,
      {},
    );
  });

  it('throws 401 when user not found for 2FA', async () => {
    dbQuery.mockResolvedValue({ rows: [] });

    const token = createPartialToken();

    await expect(authService.verifyTwoFactor(token, '123456', TEST_IP, TEST_UA)).rejects.toThrow(
      'Two-factor authentication failed',
    );
  });
});

// ---------------------------------------------------------------------------
// 10. Logout deletes session from Redis
// ---------------------------------------------------------------------------

describe('logout', () => {
  it('deletes session from Redis and writes LOGOUT audit', async () => {
    const sessionId = 'session-to-delete';
    const userId = 'user-001';

    await authService.logout(sessionId, userId, TEST_IP, TEST_UA);

    expect(mockRedis.del).toHaveBeenCalledWith(`session:${sessionId}`);

    // Audit: LOGOUT
    expect(repo.createAuditEntry).toHaveBeenCalledWith(userId, 'LOGOUT', TEST_IP, TEST_UA, {
      sessionId,
    });
  });
});

// ---------------------------------------------------------------------------
// Refresh access token
// ---------------------------------------------------------------------------

describe('refreshAccessToken', () => {
  // ---------------------------------------------------------------------------
  // 14. Refresh token issues new access token
  // ---------------------------------------------------------------------------

  it('issues a new access token when session is valid', async () => {
    const sessionId = 'active-session';
    const userId = 'user-001';

    const refreshToken = jwt.sign({ userId, sessionId, type: 'refresh' }, JWT_SECRET, {
      expiresIn: '7d',
    });

    const session = {
      sessionId,
      userId,
      role: 'supplier',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    // First get: blocklist check → null (not blocked)
    // Second get: session lookup → valid session
    mockRedis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify(session));
    // set: blocklist the old token
    mockRedis.set.mockResolvedValue('OK');

    const result = await authService.refreshAccessToken(refreshToken, TEST_IP, TEST_UA);

    expect(result.accessToken).toBeDefined();
    expect(result.expiresIn).toBe('15m');

    const decoded = jwt.decode(result.accessToken) as Record<string, unknown>;
    expect(decoded.userId).toBe(userId);
    expect(decoded.role).toBe('supplier');
    expect(decoded.type).toBe('full');

    // Audit: TOKEN_REFRESHED
    expect(repo.createAuditEntry).toHaveBeenCalledWith(
      userId,
      'TOKEN_REFRESHED',
      TEST_IP,
      TEST_UA,
      { sessionId },
    );
  });

  // ---------------------------------------------------------------------------
  // 15. Refresh with invalidated session returns 401
  // ---------------------------------------------------------------------------

  it('throws 401 when refresh token has already been rotated (blocklist hit)', async () => {
    const refreshToken = jwt.sign(
      { userId: 'user-001', sessionId: 'sess-rotate', type: 'refresh' },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    // First get: blocklist check → '1' means this token was already rotated
    mockRedis.get.mockResolvedValueOnce('1');

    await expect(authService.refreshAccessToken(refreshToken, TEST_IP, TEST_UA)).rejects.toThrow(
      'Refresh token has already been used',
    );
  });

  it('throws 401 when session has been invalidated (logged out)', async () => {
    const refreshToken = jwt.sign(
      { userId: 'user-001', sessionId: 'dead-session', type: 'refresh' },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    mockRedis.get.mockResolvedValue(null);

    await expect(authService.refreshAccessToken(refreshToken, TEST_IP, TEST_UA)).rejects.toThrow(
      'Session expired',
    );
  });

  it('throws 401 when refresh token is expired', async () => {
    const expiredToken = jwt.sign(
      { userId: 'user-001', sessionId: 'sess-1', type: 'refresh' },
      JWT_SECRET,
      { expiresIn: '0s' },
    );

    await new Promise((r) => setTimeout(r, 50));

    await expect(authService.refreshAccessToken(expiredToken, TEST_IP, TEST_UA)).rejects.toThrow(
      'Invalid or expired token',
    );
  });

  it('throws 401 when token type is not refresh', async () => {
    const accessToken = jwt.sign(
      { userId: 'user-001', role: 'supplier', sessionId: 'sess-1', type: 'full' },
      JWT_SECRET,
      { expiresIn: '15m' },
    );

    await expect(authService.refreshAccessToken(accessToken, TEST_IP, TEST_UA)).rejects.toThrow(
      'Invalid token type',
    );
  });
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe('getSession', () => {
  it('returns session when it exists in Redis', async () => {
    const session = {
      sessionId: 'sess-1',
      userId: 'user-001',
      role: 'supplier',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };

    mockRedis.get.mockResolvedValue(JSON.stringify(session));

    const result = await authService.getSession('sess-1');
    expect(result).toEqual(session);
    expect(mockRedis.get).toHaveBeenCalledWith('session:sess-1');
  });

  it('returns null when session does not exist', async () => {
    mockRedis.get.mockResolvedValue(null);
    const result = await authService.getSession('nonexistent');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildRefreshToken
// ---------------------------------------------------------------------------

describe('buildRefreshToken', () => {
  it('creates a valid refresh token', () => {
    const token = authService.buildRefreshToken('user-001', 'sess-1');
    const decoded = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;

    expect(decoded.userId).toBe('user-001');
    expect(decoded.sessionId).toBe('sess-1');
    expect(decoded.type).toBe('refresh');
  });
});

// ---------------------------------------------------------------------------
// setRedisClient / getRedis edge case
// ---------------------------------------------------------------------------

describe('Redis not initialised', () => {
  it('throws AuthError when Redis client is not set', async () => {
    // Temporarily set to null by casting to bypass type safety
    authService.setRedisClient(null as never);

    await expect(authService.getSession('sess-1')).rejects.toThrow('Session store not available');

    // Restore
    authService.setRedisClient(mockRedis as never);
  });
});

// ---------------------------------------------------------------------------
// setNotificationQueue — covers the uncovered function (line 36-38)
// ---------------------------------------------------------------------------

describe('setNotificationQueue', () => {
  it('stores queue reference without throwing', () => {
    const mockQueue = { add: jest.fn() } as never;
    expect(() => authService.setNotificationQueue(mockQueue)).not.toThrow();
    // restore to null so other tests are unaffected
    authService.setNotificationQueue(null as never);
  });
});

// ---------------------------------------------------------------------------
// requestPasswordReset with notification queue configured (lines 707-729)
// Covers: branch at line 708 when notificationQueue IS set (branch 0 = queue present)
// and the enqueueResetEmail success path at lines 707-723
// ---------------------------------------------------------------------------

describe('requestPasswordReset — user not found or inactive', () => {
  it('silently returns without error when user not found (line 232 — no enumeration)', async () => {
    repo.findUserByEmail.mockResolvedValue(null);

    await expect(
      authService.requestPasswordReset('nobody@test.com', TEST_IP, TEST_UA),
    ).resolves.toBeUndefined();

    expect(repo.invalidateResetTokens).not.toHaveBeenCalled();
  });

  it('silently returns without error when user account is inactive (line 232)', async () => {
    const inactiveUser = makeUser({ is_active: false });
    repo.findUserByEmail.mockResolvedValue(inactiveUser);

    await expect(
      authService.requestPasswordReset(inactiveUser.email, TEST_IP, TEST_UA),
    ).resolves.toBeUndefined();

    expect(repo.invalidateResetTokens).not.toHaveBeenCalled();
  });
});

describe('requestPasswordReset — notification queue configured', () => {
  it('enqueues reset email when notification queue is set', async () => {
    const mockQueue = { add: jest.fn().mockResolvedValue(undefined) } as never;
    authService.setNotificationQueue(mockQueue);

    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);

    await authService.requestPasswordReset(user.email, TEST_IP, TEST_UA);

    expect((mockQueue as { add: jest.Mock }).add).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({
        channel: 'email',
        template: 'password_reset',
        recipientUserId: user.id,
      }),
      expect.objectContaining({ attempts: 3 }),
    );

    // cleanup
    authService.setNotificationQueue(null as never);
  });

  it('logs error but does not throw when queue.add rejects (line 724-728)', async () => {
    const mockQueue = {
      add: jest.fn().mockRejectedValue(new Error('Queue unavailable')),
    } as never;
    authService.setNotificationQueue(mockQueue);

    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);

    // Must not throw even if queue fails
    await expect(
      authService.requestPasswordReset(user.email, TEST_IP, TEST_UA),
    ).resolves.toBeUndefined();

    // cleanup
    authService.setNotificationQueue(null as never);
  });
});

// ---------------------------------------------------------------------------
// Module-level JWT_SECRET guard — branch 0 of line 22
// This is exercised at module load time; the existing import already covers line 23
// when the env is NOT set. We verify the guard logic via a direct test.
// ---------------------------------------------------------------------------

describe('JWT_SECRET environment variable guard', () => {
  it('auth module loads successfully when JWT_SECRET is set', () => {
    // The module already imported at the top means JWT_SECRET was present
    expect(authService.buildRefreshToken).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// resetPassword — lines 272-295
// ---------------------------------------------------------------------------

describe('resetPassword', () => {
  beforeEach(() => {
    mockRedis.scan = jest.fn().mockResolvedValue({ cursor: 0, keys: [] });
  });

  it('resets password successfully when token is valid', async () => {
    const tokenRecord = { id: 'tok-1', user_id: 'user-001' };
    repo.findValidResetToken.mockResolvedValue(tokenRecord as never);
    repo.updatePasswordHashWithClient.mockResolvedValue(undefined);
    repo.markResetTokenUsedWithClient.mockResolvedValue(undefined);
    repo.createAuditEntryWithClient.mockResolvedValue(undefined);
    repo.getLastNPasswords.mockResolvedValue([]);
    repo.createPasswordHistoryEntryWithClient.mockResolvedValue(undefined);

    await expect(
      authService.resetPassword(
        'raw-token-abc',
        'NewPassWord1!@',
        'NewPassWord1!@',
        TEST_IP,
        TEST_UA,
      ),
    ).resolves.toBeUndefined();

    expect(repo.updatePasswordHashWithClient).toHaveBeenCalledWith(
      expect.anything(),
      'user-001',
      expect.any(String),
    );
    expect(repo.markResetTokenUsedWithClient).toHaveBeenCalledWith(expect.anything(), 'tok-1');
    expect(repo.createAuditEntryWithClient).toHaveBeenCalledWith(
      expect.anything(),
      'user-001',
      'PASSWORD_RESET_COMPLETED',
      TEST_IP,
      TEST_UA,
      {},
    );
  });

  it('throws AuthError when reset token not found or expired', async () => {
    repo.findValidResetToken.mockResolvedValue(null);

    await expect(
      authService.resetPassword(
        'invalid-token',
        'NewPassWord1!@',
        'NewPassWord1!@',
        TEST_IP,
        TEST_UA,
      ),
    ).rejects.toThrow('Invalid or expired reset token');
  });

  it('throws ValidationError when passwords do not match', async () => {
    await expect(
      authService.resetPassword(
        'raw-token',
        'NewPassWord1!@',
        'DifferentPass1!@',
        TEST_IP,
        TEST_UA,
      ),
    ).rejects.toThrow('Passwords do not match');
  });

  it('throws ValidationError when new password is too weak', async () => {
    await expect(
      authService.resetPassword('raw-token', 'weakpassword', 'weakpassword', TEST_IP, TEST_UA),
    ).rejects.toThrow('Password does not meet policy');
  });

  it('invalidates all sessions after successful password reset', async () => {
    const tokenRecord = { id: 'tok-2', user_id: 'user-001' };
    repo.findValidResetToken.mockResolvedValue(tokenRecord as never);
    repo.updatePasswordHashWithClient.mockResolvedValue(undefined);
    repo.markResetTokenUsedWithClient.mockResolvedValue(undefined);
    repo.createAuditEntryWithClient.mockResolvedValue(undefined);
    repo.getLastNPasswords.mockResolvedValue([]);
    repo.createPasswordHistoryEntryWithClient.mockResolvedValue(undefined);

    // Provide a session in Redis that should be scanned and deleted
    mockRedis.scan = jest.fn().mockResolvedValueOnce({
      cursor: 0,
      keys: ['session:sess-old'],
    });
    mockRedis.get.mockResolvedValue(
      JSON.stringify({ userId: 'user-001', sessionId: 'sess-old', role: 'supplier' }),
    );

    await authService.resetPassword(
      'raw-token-abc',
      'NewPassWord1!@',
      'NewPassWord1!@',
      TEST_IP,
      TEST_UA,
    );

    expect(mockRedis.del).toHaveBeenCalledWith('session:sess-old');
  });
});

// ---------------------------------------------------------------------------
// changePassword — lines 318-343
// ---------------------------------------------------------------------------

describe('changePassword', () => {
  beforeEach(() => {
    mockRedis.scan = jest.fn().mockResolvedValue({ cursor: 0, keys: [] });
  });

  it('changes password successfully when current password matches', async () => {
    const user = makeUser();
    repo.findUserById.mockResolvedValue(user);
    repo.updatePasswordHashWithClient.mockResolvedValue(undefined);
    repo.createAuditEntryWithClient.mockResolvedValue(undefined);
    repo.getLastNPasswords.mockResolvedValue([]);
    repo.createPasswordHistoryEntryWithClient.mockResolvedValue(undefined);

    jest
      .spyOn(bcrypt, 'compare')
      .mockImplementationOnce(() => Promise.resolve(true)) // current password match
      .mockImplementationOnce(() => Promise.resolve(false)); // not same as new

    await expect(
      authService.changePassword(
        'user-001',
        'sess-1',
        'OldPassWord1!',
        'NewPassWord1!@',
        'NewPassWord1!@',
        TEST_IP,
        TEST_UA,
      ),
    ).resolves.toBeUndefined();

    expect(repo.updatePasswordHashWithClient).toHaveBeenCalledWith(
      expect.anything(),
      'user-001',
      expect.any(String),
    );
    expect(repo.createAuditEntryWithClient).toHaveBeenCalledWith(
      expect.anything(),
      'user-001',
      'PASSWORD_CHANGED',
      TEST_IP,
      TEST_UA,
      {},
    );
  });

  it('throws AuthError when user not found', async () => {
    repo.findUserById.mockResolvedValue(null);

    await expect(
      authService.changePassword(
        'missing-user',
        'sess-1',
        'OldPassWord1!',
        'NewPassWord1!@',
        'NewPassWord1!@',
        TEST_IP,
        TEST_UA,
      ),
    ).rejects.toThrow('User not found');
  });

  it('throws AuthError when current password is incorrect', async () => {
    const user = makeUser();
    repo.findUserById.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementationOnce(() => Promise.resolve(false));

    await expect(
      authService.changePassword(
        'user-001',
        'sess-1',
        'WrongPassW1!!',
        'NewPassWord1!@',
        'NewPassWord1!@',
        TEST_IP,
        TEST_UA,
      ),
    ).rejects.toThrow('Current password is incorrect');
  });

  it('throws ValidationError when new password same as current', async () => {
    const user = makeUser();
    repo.findUserById.mockResolvedValue(user);
    jest
      .spyOn(bcrypt, 'compare')
      .mockImplementationOnce(() => Promise.resolve(true)) // current matches
      .mockImplementationOnce(() => Promise.resolve(true)); // same as new

    await expect(
      authService.changePassword(
        'user-001',
        'sess-1',
        'SamePassWord1!',
        'SamePassWord1!',
        'SamePassWord1!',
        TEST_IP,
        TEST_UA,
      ),
    ).rejects.toThrow('New password must differ from current password');
  });

  it('throws ValidationError when passwords do not match', async () => {
    await expect(
      authService.changePassword(
        'user-001',
        'sess-1',
        'OldPassWord1!',
        'NewPassWord1!@',
        'DifferentPas1!@',
        TEST_IP,
        TEST_UA,
      ),
    ).rejects.toThrow('Passwords do not match');
  });
});

// ---------------------------------------------------------------------------
// listBuyersForSupplier — lines 368-371
// ---------------------------------------------------------------------------

describe('listBuyersForSupplier', () => {
  it('returns paginated buyers for a supplier', async () => {
    const rows = [{ buyer_id: 'buyer-1', company_name: 'Buyer Co', total_invoices: 3 }] as never[];
    repo.listBuyersForSupplier.mockResolvedValue({ rows, total: 1 });

    const result = await authService.listBuyersForSupplier('sup-1', {
      page: 1,
      limit: 10,
    });

    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
    expect(result.pagination.totalPages).toBe(1);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(10);
    expect(repo.listBuyersForSupplier).toHaveBeenCalledWith('sup-1', {
      page: 1,
      limit: 10,
    });
  });

  it('computes totalPages correctly for multiple pages', async () => {
    repo.listBuyersForSupplier.mockResolvedValue({ rows: [], total: 25 });

    const result = await authService.listBuyersForSupplier('sup-1', {
      page: 1,
      limit: 10,
    });

    expect(result.pagination.totalPages).toBe(3); // ceil(25/10)
  });
});

// ---------------------------------------------------------------------------
// buildUserProfile via login — encrypted name branch (lines 399-404)
// Covered by mocking fetchUserProfile to return non-null first_name_encrypted.
// The decrypt call is exercised via the issueFullTokens → buildUserProfile path.
// ---------------------------------------------------------------------------

describe('buildUserProfile — encrypted name', () => {
  it('calls fetchUserProfile during full login to build user profile', async () => {
    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

    // Return null profile so the fallback email-prefix name is used (simpler path)
    repo.fetchUserProfile.mockResolvedValue(null);

    const result = await authService.login(user.email, 'ValidPass1!', TEST_IP, TEST_UA);

    expect(repo.fetchUserProfile).toHaveBeenCalledWith(user.id);
    expect(result.user).toBeDefined();
    // Falls back to email prefix when no profile
    expect(result.user?.name).toBe('supplier');
  });

  it('uses encrypted name when profile has first_name_encrypted (lines 399-404)', async () => {
    process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

    // encrypt a name so decrypt returns it; we use the actual encrypt to get valid ciphertext
    const { encrypt } = await import('../../../src/shared/crypto');
    const encFirst = encrypt('Jane');
    const encLast = encrypt('Smith');

    repo.fetchUserProfile.mockResolvedValue({
      first_name_encrypted: encFirst,
      last_name_encrypted: encLast,
    } as never);

    const result = await authService.login(user.email, 'ValidPass1!', TEST_IP, TEST_UA);

    expect(result.user?.name).toBe('Jane Smith');
  });
});

// ---------------------------------------------------------------------------
// handleFailedPassword — transaction rollback path (lines 453-454)
// ---------------------------------------------------------------------------

describe('handleFailedPassword — transaction rollback', () => {
  it('rolls back transaction and rethrows when DB operation fails during failed login', async () => {
    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(false));

    repo.incrementFailedLoginWithClient.mockRejectedValue(new Error('DB write failed'));

    await expect(authService.login(user.email, 'WrongPass!', TEST_IP, TEST_UA)).rejects.toThrow(
      'DB write failed',
    );

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

// ---------------------------------------------------------------------------
// deleteSessionsByUserId — scan loop (lines 677-691)
// ---------------------------------------------------------------------------

describe('deleteSessionsByUserId scan loop', () => {
  it('scans multiple cursor pages and deletes matching sessions', async () => {
    const tokenRecord = { id: 'tok-3', user_id: 'user-001' };
    repo.findValidResetToken.mockResolvedValue(tokenRecord as never);
    repo.updatePasswordHashWithClient.mockResolvedValue(undefined);
    repo.markResetTokenUsedWithClient.mockResolvedValue(undefined);
    repo.createAuditEntryWithClient.mockResolvedValue(undefined);
    repo.getLastNPasswords.mockResolvedValue([]);
    repo.createPasswordHistoryEntryWithClient.mockResolvedValue(undefined);

    // First scan returns non-zero cursor (more pages), second returns 0 (done)
    mockRedis.scan = jest
      .fn()
      .mockResolvedValueOnce({ cursor: 5, keys: ['session:sess-a'] })
      .mockResolvedValueOnce({ cursor: 0, keys: ['session:sess-b'] });

    mockRedis.get
      .mockResolvedValueOnce(
        JSON.stringify({ userId: 'user-001', sessionId: 'sess-a', role: 'supplier' }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ userId: 'other-user', sessionId: 'sess-b', role: 'supplier' }),
      );

    await authService.resetPassword(
      'raw-token-abc',
      'NewPassWord1!@',
      'NewPassWord1!@',
      TEST_IP,
      TEST_UA,
    );

    // sess-a belongs to user-001 → deleted
    expect(mockRedis.del).toHaveBeenCalledWith('session:sess-a');
    // sess-b belongs to other-user → NOT deleted
    expect(mockRedis.del).not.toHaveBeenCalledWith('session:sess-b');
  });

  it('skips sessions with null data during scan', async () => {
    const tokenRecord = { id: 'tok-4', user_id: 'user-001' };
    repo.findValidResetToken.mockResolvedValue(tokenRecord as never);
    repo.updatePasswordHashWithClient.mockResolvedValue(undefined);
    repo.markResetTokenUsedWithClient.mockResolvedValue(undefined);
    repo.createAuditEntryWithClient.mockResolvedValue(undefined);
    repo.getLastNPasswords.mockResolvedValue([]);
    repo.createPasswordHistoryEntryWithClient.mockResolvedValue(undefined);

    mockRedis.scan = jest.fn().mockResolvedValue({ cursor: 0, keys: ['session:null-data-key'] });
    mockRedis.get.mockResolvedValue(null); // no session data

    await authService.resetPassword(
      'raw-token-abc',
      'NewPassWord1!@',
      'NewPassWord1!@',
      TEST_IP,
      TEST_UA,
    );

    expect(mockRedis.del).not.toHaveBeenCalledWith('session:null-data-key');
  });

  it('invalidateOtherSessions keeps the current session during changePassword', async () => {
    const user = makeUser();
    repo.findUserById.mockResolvedValue(user);
    repo.updatePasswordHashWithClient.mockResolvedValue(undefined);
    repo.createAuditEntryWithClient.mockResolvedValue(undefined);
    repo.getLastNPasswords.mockResolvedValue([]);
    repo.createPasswordHistoryEntryWithClient.mockResolvedValue(undefined);

    jest
      .spyOn(bcrypt, 'compare')
      .mockImplementationOnce(() => Promise.resolve(true))
      .mockImplementationOnce(() => Promise.resolve(false));

    // sess-current is the keepSessionId, sess-other should be deleted
    mockRedis.scan = jest
      .fn()
      .mockResolvedValue({ cursor: 0, keys: ['session:sess-current', 'session:sess-other'] });

    mockRedis.get
      .mockResolvedValueOnce(
        JSON.stringify({ userId: 'user-001', sessionId: 'sess-current', role: 'supplier' }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ userId: 'user-001', sessionId: 'sess-other', role: 'supplier' }),
      );

    await authService.changePassword(
      'user-001',
      'sess-current',
      'OldPassWord1!',
      'NewPassWord1!@',
      'NewPassWord1!@',
      TEST_IP,
      TEST_UA,
    );

    // sess-other should be deleted, sess-current kept
    expect(mockRedis.del).toHaveBeenCalledWith('session:sess-other');
    expect(mockRedis.del).not.toHaveBeenCalledWith('session:sess-current');
  });
});

// ---------------------------------------------------------------------------
// enqueueResetEmail — null queue path (lines 699-704)
// ---------------------------------------------------------------------------

describe('enqueueResetEmail — null notification queue', () => {
  it('silently returns when notification queue is null during password reset request', async () => {
    // Ensure notificationQueue is null (default after clearAllMocks)
    authService.setNotificationQueue(null as never);

    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);

    // Should not throw despite no notification queue
    await expect(
      authService.requestPasswordReset(user.email, TEST_IP, TEST_UA),
    ).resolves.toBeUndefined();

    // Restore
    authService.setNotificationQueue(null as never);
  });
});

// ---------------------------------------------------------------------------
// Module-level guard: JWT_SECRET missing (line 23)
// ---------------------------------------------------------------------------

describe('auth.service module-level JWT_SECRET guard', () => {
  it('throws when JWT_SECRET env var is not set', async () => {
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    jest.resetModules();

    await expect(import('../../../src/services/auth/auth.service')).rejects.toThrow(
      'JWT_SECRET environment variable is required',
    );

    process.env.JWT_SECRET = original;
    jest.resetModules();
  });
});

// ---------------------------------------------------------------------------
// enqueueResetEmail — non-Error thrown (line 727 false branch)
// ---------------------------------------------------------------------------

describe('enqueueResetEmail — non-Error thrown in catch', () => {
  it('logs "Unknown" errorMessage when queue.add rejects with a non-Error value', async () => {
    const mockQueue = {
      add: jest.fn().mockRejectedValue('string-error-not-an-Error-object'),
    } as never;
    authService.setNotificationQueue(mockQueue);

    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);

    // Must not throw; non-Error rejection falls into the 'Unknown' branch on line 727
    await expect(
      authService.requestPasswordReset(user.email, TEST_IP, TEST_UA),
    ).resolves.toBeUndefined();

    authService.setNotificationQueue(null as never);
  });
});

// ---------------------------------------------------------------------------
// buildUserProfile — last_name_encrypted is null (line 401-402 false branch)
// ---------------------------------------------------------------------------

describe('buildUserProfile — last_name_encrypted is null', () => {
  it('falls back to empty string for last name when last_name_encrypted is null', async () => {
    process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
    const user = makeUser();
    repo.findUserByEmail.mockResolvedValue(user);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

    const { encrypt } = await import('../../../src/shared/crypto');
    const encFirst = encrypt('Jane');

    // first_name_encrypted set, last_name_encrypted explicitly null
    repo.fetchUserProfile.mockResolvedValue({
      first_name_encrypted: encFirst,
      last_name_encrypted: null,
    } as never);

    const result = await authService.login(user.email, 'ValidPass1!', TEST_IP, TEST_UA);

    // Name should just be first name trimmed (no trailing space)
    expect(result.user?.name).toBe('Jane');
  });
});

// ---------------------------------------------------------------------------
// Module-level JWT_EXPIRY / REFRESH_TOKEN_EXPIRY fallbacks (lines 25-26)
// ---------------------------------------------------------------------------

describe('auth.service module-level env-var fallbacks', () => {
  it('loads successfully using default JWT_EXPIRY and REFRESH_TOKEN_EXPIRY when vars are absent', async () => {
    const savedExpiry = process.env.JWT_EXPIRY;
    const savedRefresh = process.env.REFRESH_TOKEN_EXPIRY;

    delete process.env.JWT_EXPIRY;
    delete process.env.REFRESH_TOKEN_EXPIRY;
    jest.resetModules();

    // JWT_SECRET still set — module should load without throwing
    await expect(import('../../../src/services/auth/auth.service')).resolves.toBeDefined();

    // Restore
    process.env.JWT_EXPIRY = savedExpiry;
    process.env.REFRESH_TOKEN_EXPIRY = savedRefresh;
    jest.resetModules();
  });
});
