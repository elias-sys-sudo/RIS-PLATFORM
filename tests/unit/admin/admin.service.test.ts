process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/admin/admin.service';
import * as repo from '../../../src/services/admin/admin.repository';
import { NotFoundError, ValidationError } from '../../../src/shared/errors';
import type { AdminUserRow, RiskConfigRow } from '../../../src/services/admin/admin.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/admin/admin.repository');
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn(),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock('../../../src/shared/crypto', () => ({
  encrypt: jest.fn((v: string) => `encrypted_${v}`),
  decrypt: jest.fn((v: string) => v.replace('encrypted_', '')),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
}));

jest.mock('../../../src/shared/risk-config', () => ({
  invalidateRiskConfigCache: jest.fn(),
}));

jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    audit: jest.fn(),
  },
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const TARGET_USER_ID = '00000000-0000-0000-0000-000000000002';
const TEST_IP = '10.0.0.1';
const TEST_UA = 'TestAgent/1.0';

function buildUserRow(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: TARGET_USER_ID,
    email: 'user@test.local',
    role: 'supplier',
    is_active: true,
    first_name_encrypted: 'encrypted_Test',
    last_name_encrypted: 'encrypted_User',
    last_login_at: null,
    created_at: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

function buildRiskConfigRow(overrides: Partial<RiskConfigRow> = {}): RiskConfigRow {
  return {
    key: 'weight_buyer_credit',
    value: '0.30',
    description: 'Buyer credit weight',
    updated_at: '2026-01-15T00:00:00Z',
    updated_by: ADMIN_ID,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AdminService', () => {
  beforeEach(() => jest.clearAllMocks());

  // =========================================================================
  // listUsers
  // =========================================================================
  describe('listUsers', () => {
    it('returns paginated list with decrypted names', async () => {
      const rows = [buildUserRow(), buildUserRow({ id: 'user-2' })];
      mockedRepo.listUsers.mockResolvedValue(rows);
      mockedRepo.countUsers.mockResolvedValue(2);

      const result = await service.listUsers({
        page: 1,
        page_size: 10,
      });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.page_size).toBe(10);
    });

    it('decrypts first and last name into display name', async () => {
      const row = buildUserRow({
        first_name_encrypted: 'encrypted_Alpha',
        last_name_encrypted: 'encrypted_Beta',
      });
      mockedRepo.listUsers.mockResolvedValue([row]);
      mockedRepo.countUsers.mockResolvedValue(1);

      const result = await service.listUsers({ page: 1, page_size: 10 });

      expect(result.data[0].name).toBe('Alpha Beta');
    });

    it('handles null encrypted names gracefully', async () => {
      const row = buildUserRow({
        first_name_encrypted: null,
        last_name_encrypted: null,
      });
      mockedRepo.listUsers.mockResolvedValue([row]);
      mockedRepo.countUsers.mockResolvedValue(1);

      const result = await service.listUsers({ page: 1, page_size: 10 });

      expect(result.data[0].name).toBe('Unnamed');
    });

    it('maps is_active to status field', async () => {
      const active = buildUserRow({ is_active: true });
      const inactive = buildUserRow({ is_active: false, id: 'user-3' });
      mockedRepo.listUsers.mockResolvedValue([active, inactive]);
      mockedRepo.countUsers.mockResolvedValue(2);

      const result = await service.listUsers({ page: 1, page_size: 10 });

      expect(result.data[0].status).toBe('active');
      expect(result.data[1].status).toBe('inactive');
    });

    it('passes search param through to repository', async () => {
      mockedRepo.listUsers.mockResolvedValue([]);
      mockedRepo.countUsers.mockResolvedValue(0);

      await service.listUsers({
        search: 'test@example.local',
        page: 2,
        page_size: 25,
      });

      expect(mockedRepo.listUsers).toHaveBeenCalledWith('test@example.local', 2, 25);
      expect(mockedRepo.countUsers).toHaveBeenCalledWith('test@example.local');
    });

    it('returns empty data when no users match', async () => {
      mockedRepo.listUsers.mockResolvedValue([]);
      mockedRepo.countUsers.mockResolvedValue(0);

      const result = await service.listUsers({ page: 1, page_size: 10 });

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // =========================================================================
  // createUser
  // =========================================================================
  describe('createUser', () => {
    beforeEach(() => {
      mockedRepo.emailExists.mockResolvedValue(false);
      mockedRepo.createUser.mockResolvedValue(buildUserRow());
      mockedRepo.insertAuditLog.mockResolvedValue(undefined);
    });

    it('creates a user and returns temp password', async () => {
      const result = await service.createUser(
        { name: 'Test User', email: 'new@test.local', role: 'supplier' },
        ADMIN_ID,
        TEST_IP,
        TEST_UA,
      );

      expect(result.user).toBeDefined();
      expect(result.temporaryPassword).toBeDefined();
      expect(result.temporaryPassword).toHaveLength(32); // 16 bytes hex
    });

    it('hashes password with bcrypt cost 12', async () => {
      const bcrypt = jest.requireMock('bcryptjs') as { hash: jest.Mock };

      await service.createUser(
        { name: 'Test User', email: 'new@test.local', role: 'supplier' },
        ADMIN_ID,
        TEST_IP,
        TEST_UA,
      );

      expect(bcrypt.hash).toHaveBeenCalledWith(expect.any(String), 12);
    });

    it('encrypts first and last name before repo call', async () => {
      await service.createUser(
        { name: 'Alpha Beta', email: 'new@test.local', role: 'supplier' },
        ADMIN_ID,
        TEST_IP,
        TEST_UA,
      );

      expect(mockedRepo.createUser).toHaveBeenCalledWith(
        'new@test.local',
        'hashed_password',
        'supplier',
        'encrypted_Alpha',
        'encrypted_Beta',
      );
    });

    it('encrypts empty string for last name when single-word name', async () => {
      await service.createUser(
        { name: 'Alpha', email: 'new@test.local', role: 'supplier' },
        ADMIN_ID,
        TEST_IP,
        TEST_UA,
      );

      expect(mockedRepo.createUser).toHaveBeenCalledWith(
        'new@test.local',
        'hashed_password',
        'supplier',
        'encrypted_Alpha',
        'encrypted_',
      );
    });

    it('writes audit log with correct action', async () => {
      await service.createUser(
        { name: 'Test User', email: 'new@test.local', role: 'supplier' },
        ADMIN_ID,
        TEST_IP,
        TEST_UA,
      );

      expect(mockedRepo.insertAuditLog).toHaveBeenCalledWith(
        ADMIN_ID,
        'ADMIN_USER_CREATED',
        'users',
        TARGET_USER_ID,
        null,
        expect.any(String),
        TEST_IP,
        TEST_UA,
      );
    });

    it('throws BusinessRuleError for duplicate email', async () => {
      mockedRepo.emailExists.mockResolvedValue(true);

      await expect(
        service.createUser(
          { name: 'Test User', email: 'dup@test.local', role: 'supplier' },
          ADMIN_ID,
          TEST_IP,
          TEST_UA,
        ),
      ).rejects.toMatchObject({ errorCode: 'DUPLICATE_EMAIL' });
    });

    it('throws ValidationError for invalid role', async () => {
      await expect(
        service.createUser(
          { name: 'Test User', email: 'new@test.local', role: 'invalid_role' },
          ADMIN_ID,
          TEST_IP,
          TEST_UA,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('does not call repo when email already exists', async () => {
      mockedRepo.emailExists.mockResolvedValue(true);

      await expect(
        service.createUser(
          { name: 'Test User', email: 'dup@test.local', role: 'supplier' },
          ADMIN_ID,
          TEST_IP,
          TEST_UA,
        ),
      ).rejects.toThrow();

      expect(mockedRepo.createUser).not.toHaveBeenCalled();
    });

    it('does not call repo when role is invalid', async () => {
      await expect(
        service.createUser(
          { name: 'Test User', email: 'new@test.local', role: 'bad' },
          ADMIN_ID,
          TEST_IP,
          TEST_UA,
        ),
      ).rejects.toThrow();

      expect(mockedRepo.createUser).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // updateUser
  // =========================================================================
  describe('updateUser', () => {
    beforeEach(() => {
      mockedRepo.findUserById.mockResolvedValue(buildUserRow());
      mockedRepo.insertAuditLog.mockResolvedValue(undefined);
    });

    it('updates role only when status is not provided', async () => {
      const updated = buildUserRow({ role: 'credit_officer' });
      mockedRepo.updateUserRole.mockResolvedValue(updated);

      const result = await service.updateUser(
        TARGET_USER_ID,
        { role: 'credit_officer' },
        ADMIN_ID,
        TEST_IP,
        TEST_UA,
      );

      expect(result.role).toBe('credit_officer');
      expect(mockedRepo.updateUserRole).toHaveBeenCalledWith(TARGET_USER_ID, 'credit_officer');
      expect(mockedRepo.updateUserStatus).not.toHaveBeenCalled();
      expect(mockedRepo.updateUserRoleAndStatus).not.toHaveBeenCalled();
    });

    it('updates status only when role is not provided', async () => {
      const updated = buildUserRow({ is_active: false });
      mockedRepo.updateUserStatus.mockResolvedValue(updated);

      const result = await service.updateUser(
        TARGET_USER_ID,
        { status: 'inactive' },
        ADMIN_ID,
        TEST_IP,
        TEST_UA,
      );

      expect(result.status).toBe('inactive');
      expect(mockedRepo.updateUserStatus).toHaveBeenCalledWith(TARGET_USER_ID, false);
      expect(mockedRepo.updateUserRole).not.toHaveBeenCalled();
    });

    it('updates both role and status together', async () => {
      const updated = buildUserRow({
        role: 'finance_manager',
        is_active: false,
      });
      mockedRepo.updateUserRoleAndStatus.mockResolvedValue(updated);

      const result = await service.updateUser(
        TARGET_USER_ID,
        { role: 'finance_manager', status: 'inactive' },
        ADMIN_ID,
        TEST_IP,
        TEST_UA,
      );

      expect(result.role).toBe('finance_manager');
      expect(result.status).toBe('inactive');
      expect(mockedRepo.updateUserRoleAndStatus).toHaveBeenCalledWith(
        TARGET_USER_ID,
        'finance_manager',
        false,
      );
    });

    it('returns existing row when no fields provided', async () => {
      const result = await service.updateUser(TARGET_USER_ID, {}, ADMIN_ID, TEST_IP, TEST_UA);

      expect(result.role).toBe('supplier');
      expect(mockedRepo.updateUserRole).not.toHaveBeenCalled();
      expect(mockedRepo.updateUserStatus).not.toHaveBeenCalled();
      expect(mockedRepo.updateUserRoleAndStatus).not.toHaveBeenCalled();
    });

    it('writes audit log with old and new values', async () => {
      const updated = buildUserRow({ role: 'auditor' });
      mockedRepo.updateUserRole.mockResolvedValue(updated);

      await service.updateUser(TARGET_USER_ID, { role: 'auditor' }, ADMIN_ID, TEST_IP, TEST_UA);

      expect(mockedRepo.insertAuditLog).toHaveBeenCalledWith(
        ADMIN_ID,
        'ADMIN_USER_UPDATED',
        'users',
        TARGET_USER_ID,
        expect.stringContaining('"role":"supplier"'),
        expect.stringContaining('"role":"auditor"'),
        TEST_IP,
        TEST_UA,
      );
    });

    it('throws NotFoundError when user does not exist', async () => {
      mockedRepo.findUserById.mockResolvedValue(null);

      await expect(
        service.updateUser('nonexistent-id', { role: 'auditor' }, ADMIN_ID, TEST_IP, TEST_UA),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws ValidationError for invalid role', async () => {
      await expect(
        service.updateUser(TARGET_USER_ID, { role: 'not_a_role' }, ADMIN_ID, TEST_IP, TEST_UA),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('does not update DB when user not found', async () => {
      mockedRepo.findUserById.mockResolvedValue(null);

      await expect(
        service.updateUser(TARGET_USER_ID, { role: 'auditor' }, ADMIN_ID, TEST_IP, TEST_UA),
      ).rejects.toThrow();

      expect(mockedRepo.updateUserRole).not.toHaveBeenCalled();
      expect(mockedRepo.insertAuditLog).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // listRiskConfig
  // =========================================================================
  describe('listRiskConfig', () => {
    it('returns mapped risk config entries', async () => {
      const rows: RiskConfigRow[] = [
        buildRiskConfigRow({ key: 'weight_buyer_credit' }),
        buildRiskConfigRow({ key: 'threshold_auto_approve' }),
      ];
      mockedRepo.listRiskConfig.mockResolvedValue(rows);

      const result = await service.listRiskConfig();

      expect(result).toHaveLength(2);
      expect(result[0].category).toBe('weight');
      expect(result[1].category).toBe('threshold');
    });

    it('derives category correctly for each key prefix', async () => {
      const rows: RiskConfigRow[] = [
        buildRiskConfigRow({ key: 'weight_tenor' }),
        buildRiskConfigRow({ key: 'threshold_refer_manager' }),
        buildRiskConfigRow({ key: 'advance_pct_high' }),
        buildRiskConfigRow({ key: 'base_discount_rate' }),
      ];
      mockedRepo.listRiskConfig.mockResolvedValue(rows);

      const result = await service.listRiskConfig();

      expect(result[0].category).toBe('weight');
      expect(result[1].category).toBe('threshold');
      expect(result[2].category).toBe('limit');
      expect(result[3].category).toBe('rate');
    });

    it('returns empty array when no config exists', async () => {
      mockedRepo.listRiskConfig.mockResolvedValue([]);

      const result = await service.listRiskConfig();

      expect(result).toHaveLength(0);
    });
  });

  // =========================================================================
  // updateRiskConfig
  // =========================================================================
  describe('updateRiskConfig', () => {
    beforeEach(() => {
      mockedRepo.findRiskConfigByKey.mockResolvedValue(buildRiskConfigRow());
      mockedRepo.updateRiskConfig.mockResolvedValue(buildRiskConfigRow({ value: '0.35' }));
      mockedRepo.insertAuditLog.mockResolvedValue(undefined);
    });

    it('updates config and returns new entry', async () => {
      const result = await service.updateRiskConfig(
        'weight_buyer_credit',
        0.35,
        ADMIN_ID,
        TEST_IP,
        TEST_UA,
      );

      expect(result.value).toBe('0.35');
      expect(result.category).toBe('weight');
    });

    it('passes stringified value to repository', async () => {
      await service.updateRiskConfig('weight_buyer_credit', 0.35, ADMIN_ID, TEST_IP, TEST_UA);

      expect(mockedRepo.updateRiskConfig).toHaveBeenCalledWith(
        'weight_buyer_credit',
        '0.35',
        ADMIN_ID,
      );
    });

    it('invalidates risk config cache after update', async () => {
      const { invalidateRiskConfigCache } = jest.requireMock('../../../src/shared/risk-config') as {
        invalidateRiskConfigCache: jest.Mock;
      };

      await service.updateRiskConfig('weight_buyer_credit', 0.35, ADMIN_ID, TEST_IP, TEST_UA);

      expect(invalidateRiskConfigCache).toHaveBeenCalled();
    });

    it('writes audit log with old and new values', async () => {
      await service.updateRiskConfig('weight_buyer_credit', 0.35, ADMIN_ID, TEST_IP, TEST_UA);

      expect(mockedRepo.insertAuditLog).toHaveBeenCalledWith(
        ADMIN_ID,
        'ADMIN_RISK_CONFIG_UPDATED',
        'risk_config',
        'weight_buyer_credit',
        expect.stringContaining('"value":"0.30"'),
        expect.stringContaining('"value":"0.35"'),
        TEST_IP,
        TEST_UA,
      );
    });

    it('throws NotFoundError when key does not exist', async () => {
      mockedRepo.findRiskConfigByKey.mockResolvedValue(null);

      await expect(
        service.updateRiskConfig('nonexistent_key', 1.0, ADMIN_ID, TEST_IP, TEST_UA),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('does not update DB when key not found', async () => {
      mockedRepo.findRiskConfigByKey.mockResolvedValue(null);

      await expect(
        service.updateRiskConfig('nonexistent_key', 1.0, ADMIN_ID, TEST_IP, TEST_UA),
      ).rejects.toThrow();

      expect(mockedRepo.updateRiskConfig).not.toHaveBeenCalled();
      expect(mockedRepo.insertAuditLog).not.toHaveBeenCalled();
    });

    it('does not invalidate cache when key not found', async () => {
      mockedRepo.findRiskConfigByKey.mockResolvedValue(null);
      const { invalidateRiskConfigCache } = jest.requireMock('../../../src/shared/risk-config') as {
        invalidateRiskConfigCache: jest.Mock;
      };

      await expect(
        service.updateRiskConfig('nonexistent_key', 1.0, ADMIN_ID, TEST_IP, TEST_UA),
      ).rejects.toThrow();

      expect(invalidateRiskConfigCache).not.toHaveBeenCalled();
    });
  });
});
