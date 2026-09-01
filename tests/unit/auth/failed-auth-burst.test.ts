// ---------------------------------------------------------------------------
// Env — must be set before imports
// ---------------------------------------------------------------------------
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

// ---------------------------------------------------------------------------
// Mocks — hoisted
// ---------------------------------------------------------------------------
const mockAdd = jest.fn().mockResolvedValue(undefined);
const mockGetRecentFailedLoginsByIp = jest.fn();
const mockFindUserByEmail = jest.fn();
const mockIncrementFailedLoginWithClient = jest.fn();
const mockCreateAuditEntryWithClient = jest.fn();
const mockLockAccountWithClient = jest.fn();
const mockCreateAuditEntry = jest.fn();
const mockResetFailedLogin = jest.fn();
const mockRecordLogin = jest.fn();
const mockFetchUserProfile = jest.fn();

const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockGetClient = jest.fn().mockResolvedValue({
  query: mockClientQuery,
  release: mockClientRelease,
});

jest.mock('../../../src/services/auth/auth.repository', () => ({
  findUserByEmail: mockFindUserByEmail,
  incrementFailedLoginWithClient: mockIncrementFailedLoginWithClient,
  createAuditEntryWithClient: mockCreateAuditEntryWithClient,
  lockAccountWithClient: mockLockAccountWithClient,
  createAuditEntry: mockCreateAuditEntry,
  resetFailedLogin: mockResetFailedLogin,
  recordLogin: mockRecordLogin,
  fetchUserProfile: mockFetchUserProfile,
  getClient: mockGetClient,
  getRecentFailedLoginsByIp: mockGetRecentFailedLoginsByIp,
}));

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  pool: { connect: jest.fn() },
  query: jest.fn(),
}));

jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    audit: jest.fn(),
  },
}));

jest.mock('../../../src/shared/crypto', () => ({
  decrypt: jest.fn((v: string) => v),
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn().mockResolvedValue(false),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock-token'),
  verify: jest.fn(),
}));

jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    scan: jest.fn(),
    ping: jest.fn(),
    on: jest.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------
import {
  login,
  setSecurityAlertsQueue,
  setRedisClient,
} from '../../../src/services/auth/auth.service';
import { createClient } from 'redis';
import type { Queue } from 'bullmq';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const MOCK_IP = '10.0.0.1';
const MOCK_UA = 'test-agent/1.0';

function buildUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-001',
    email: 'test@ris.ug',
    password_hash: '$2b$12$fakehash',
    role: 'supplier',
    is_active: true,
    email_verified: true,
    two_factor_enabled: false,
    two_factor_secret: null,
    failed_login_count: 0,
    locked_until: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClientQuery.mockResolvedValue(undefined);

  // Set up a fake Redis client
  const fakeRedis = createClient();
  setRedisClient(fakeRedis as ReturnType<typeof createClient>);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Failed auth burst detection', () => {
  it('queues a FAILED_AUTH_BURST alert when 5+ failures from same IP', async () => {
    mockFindUserByEmail.mockResolvedValue(buildUser());
    mockIncrementFailedLoginWithClient.mockResolvedValue(1);
    mockGetRecentFailedLoginsByIp.mockResolvedValue(7);

    const mockQueue = { add: mockAdd } as unknown as Queue;
    setSecurityAlertsQueue(mockQueue);

    await expect(login('test@ris.ug', 'wrong', MOCK_IP, MOCK_UA)).rejects.toThrow(
      'Invalid credentials',
    );

    expect(mockGetRecentFailedLoginsByIp).toHaveBeenCalledWith(MOCK_IP, 15);
    const alertCall = mockAdd.mock.calls[0] as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(alertCall[0]).toBe('security-alert');
    expect(alertCall[1]).toMatchObject({
      type: 'FAILED_AUTH_BURST',
      entityId: MOCK_IP,
      entityType: 'ip_address',
    });
    const alertMeta = alertCall[1].metadata as Record<string, unknown>;
    expect(alertMeta.failureCount).toBe(7);
    expect(alertMeta.windowMinutes).toBe(15);
  });

  it('does NOT queue alert when fewer than 5 failures', async () => {
    mockFindUserByEmail.mockResolvedValue(buildUser());
    mockIncrementFailedLoginWithClient.mockResolvedValue(1);
    mockGetRecentFailedLoginsByIp.mockResolvedValue(3);

    const mockQueue = { add: mockAdd } as unknown as Queue;
    setSecurityAlertsQueue(mockQueue);

    await expect(login('test@ris.ug', 'wrong', MOCK_IP, MOCK_UA)).rejects.toThrow(
      'Invalid credentials',
    );

    expect(mockGetRecentFailedLoginsByIp).toHaveBeenCalledWith(MOCK_IP, 15);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('does NOT queue alert when exactly at threshold (5)', async () => {
    mockFindUserByEmail.mockResolvedValue(buildUser());
    mockIncrementFailedLoginWithClient.mockResolvedValue(1);
    mockGetRecentFailedLoginsByIp.mockResolvedValue(5);

    const mockQueue = { add: mockAdd } as unknown as Queue;
    setSecurityAlertsQueue(mockQueue);

    await expect(login('test@ris.ug', 'wrong', MOCK_IP, MOCK_UA)).rejects.toThrow(
      'Invalid credentials',
    );

    expect(mockAdd).toHaveBeenCalledWith(
      'security-alert',
      expect.objectContaining({ type: 'FAILED_AUTH_BURST' }),
      expect.any(Object),
    );
  });

  it('silently skips when security alerts queue is not configured', async () => {
    mockFindUserByEmail.mockResolvedValue(buildUser());
    mockIncrementFailedLoginWithClient.mockResolvedValue(1);
    mockGetRecentFailedLoginsByIp.mockResolvedValue(10);

    setSecurityAlertsQueue(null as unknown as Queue);

    // Should not throw — non-blocking
    await expect(login('test@ris.ug', 'wrong', MOCK_IP, MOCK_UA)).rejects.toThrow(
      'Invalid credentials',
    );

    expect(mockGetRecentFailedLoginsByIp).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('includes timestamp in the alert payload', async () => {
    mockFindUserByEmail.mockResolvedValue(buildUser());
    mockIncrementFailedLoginWithClient.mockResolvedValue(1);
    mockGetRecentFailedLoginsByIp.mockResolvedValue(6);

    const mockQueue = { add: mockAdd } as unknown as Queue;
    setSecurityAlertsQueue(mockQueue);

    await expect(login('test@ris.ug', 'wrong', MOCK_IP, MOCK_UA)).rejects.toThrow();

    const callArgs = mockAdd.mock.calls[0] as [string, Record<string, unknown>];
    const alertPayload = callArgs[1];
    expect(alertPayload.timestamp).toBeDefined();
    expect(typeof alertPayload.timestamp).toBe('string');
  });
});
