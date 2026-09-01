// REQ-AUTH-007 — new-device login email notification

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';

import bcrypt from 'bcryptjs';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
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

const repo = authRepo as jest.Mocked<typeof authRepo>;
const TEST_IP = '102.0.0.1';
const TEST_UA = 'NewBrowserAgent/1.0';
const KNOWN_UA = 'KnownBrowserAgent/2.0';

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-001',
    email: 'supplier@test.com',
    password_hash: '',
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

describe('new-device login email (REQ-AUTH-007)', () => {
  let queueAdd: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();

    const hash = await bcrypt.hash('CorrectHorseBattery42!', 10);
    repo.findUserByEmail.mockResolvedValue(makeUser({ password_hash: hash }));
    repo.findUserById.mockResolvedValue(makeUser({ password_hash: hash }));
    repo.createAuditEntry.mockResolvedValue(undefined);
    repo.resetFailedLogin.mockResolvedValue(undefined);
    repo.recordLogin.mockResolvedValue(undefined);
    repo.createLoginHistoryEntry.mockResolvedValue(undefined);
    repo.fetchUserProfile.mockResolvedValue(null as never);

    queueAdd = jest.fn().mockResolvedValue(undefined);
    authService.setNotificationQueue({ add: queueAdd } as never);
    authService.setRedisClient(mockRedis as never);
  });

  it('fires NEW_DEVICE_LOGIN_NOTIFIED + enqueues email when user_agent is new', async () => {
    repo.hasRecentLoginWithSameUserAgent.mockResolvedValueOnce(false);

    await authService.login('supplier@test.com', 'CorrectHorseBattery42!', TEST_IP, TEST_UA);

    expect(repo.hasRecentLoginWithSameUserAgent).toHaveBeenCalledWith('user-001', TEST_UA, 30);
    expect(repo.createAuditEntry).toHaveBeenCalledWith(
      'user-001',
      'NEW_DEVICE_LOGIN_NOTIFIED',
      TEST_IP,
      TEST_UA,
      expect.objectContaining({ newDevice: true }),
    );
    const newDeviceCalls = queueAdd.mock.calls.filter(([name]) => name === 'send-email');
    const hasNewDevice = newDeviceCalls.some(([, payload]) => {
      const typed = payload as { template?: string };
      return typed.template === 'new_device_login';
    });
    expect(hasNewDevice).toBe(true);
  });

  it('does NOT notify when same user_agent was seen in last 30 days', async () => {
    repo.hasRecentLoginWithSameUserAgent.mockResolvedValueOnce(true);

    await authService.login('supplier@test.com', 'CorrectHorseBattery42!', TEST_IP, KNOWN_UA);

    expect(repo.createAuditEntry).not.toHaveBeenCalledWith(
      'user-001',
      'NEW_DEVICE_LOGIN_NOTIFIED',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    const newDeviceCalls = queueAdd.mock.calls.filter(([, payload]) => {
      const typed = payload as { template?: string } | undefined;
      return typed?.template === 'new_device_login';
    });
    expect(newDeviceCalls).toHaveLength(0);
  });

  it('does not block login when notification queue is missing', async () => {
    repo.hasRecentLoginWithSameUserAgent.mockResolvedValueOnce(false);
    authService.setNotificationQueue(undefined as never);

    const result = await authService.login(
      'supplier@test.com',
      'CorrectHorseBattery42!',
      TEST_IP,
      TEST_UA,
    );
    expect(result.tokenType).toBe('full');
  });
});
