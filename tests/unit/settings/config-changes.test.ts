process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/settings/settings.service';
import * as settingsRepo from '../../../src/services/settings/settings.repository';
import { BusinessRuleError, NotFoundError } from '../../../src/shared/errors';
import type { PendingConfigChangeRow } from '../../../src/services/settings/settings.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
  },
}));

jest.mock('../../../src/services/settings/settings.repository');
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-change-uuid'),
}));

const mockedRepo = settingsRepo as jest.Mocked<typeof settingsRepo>;

function buildMockClient() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
}

function buildPendingChange(
  overrides: Partial<PendingConfigChangeRow> = {},
): PendingConfigChangeRow {
  return {
    id: 'change-1',
    config_key: 'payment_kill_switch',
    current_value: 'false',
    proposed_value: 'true',
    proposed_by: 'user-proposer',
    approved_by: null,
    status: 'pending',
    created_at: '2026-01-01T00:00:00Z',
    resolved_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Config changes (maker-checker)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('proposeConfigChange', () => {
    it('creates a pending config change', async () => {
      mockedRepo.getSystemSetting.mockResolvedValue('false');
      mockedRepo.createPendingConfigChange.mockResolvedValue();
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.proposeConfigChange(
        'payment_kill_switch',
        'true',
        'user-1',
        '127.0.0.1',
        'test-agent',
      );

      expect(result.changeId).toBe('mock-change-uuid');
      expect(mockedRepo.createPendingConfigChange).toHaveBeenCalledWith(
        'mock-change-uuid',
        'payment_kill_switch',
        'false',
        'true',
        'user-1',
      );
    });
  });

  describe('approveConfigChange', () => {
    it('approves a pending change when approver differs from proposer', async () => {
      const { pool } = jest.requireMock('../../../src/shared/database/pool') as {
        pool: { connect: jest.Mock };
      };
      const mockClient = buildMockClient();
      pool.connect.mockResolvedValue(mockClient);

      const change = buildPendingChange();
      mockedRepo.getPendingConfigChange.mockResolvedValue(change);
      mockedRepo.approvePendingConfigChangeWithClient.mockResolvedValue();
      mockedRepo.setSystemSettingWithClient.mockResolvedValue();
      mockedRepo.createSystemAuditEntryWithClient.mockResolvedValue();

      await service.approveConfigChange('change-1', 'user-approver', '127.0.0.1', 'test-agent');

      expect(mockedRepo.approvePendingConfigChangeWithClient).toHaveBeenCalledWith(
        mockClient,
        'change-1',
        'user-approver',
      );
      expect(mockedRepo.setSystemSettingWithClient).toHaveBeenCalledWith(
        mockClient,
        'payment_kill_switch',
        'true',
        'user-approver',
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('rejects approval when same user proposed and tries to approve', async () => {
      const change = buildPendingChange({ proposed_by: 'same-user' });
      mockedRepo.getPendingConfigChange.mockResolvedValue(change);

      await expect(
        service.approveConfigChange('change-1', 'same-user', '127.0.0.1', 'test-agent'),
      ).rejects.toThrow(BusinessRuleError);

      await expect(
        service.approveConfigChange('change-1', 'same-user', '127.0.0.1', 'test-agent'),
      ).rejects.toMatchObject({ errorCode: 'SAME_USER_CANNOT_APPROVE' });
    });

    it('throws NotFoundError when change does not exist', async () => {
      mockedRepo.getPendingConfigChange.mockResolvedValue(null);

      await expect(
        service.approveConfigChange('no-exist', 'user-1', '127.0.0.1', 'test-agent'),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects approval when change is not pending', async () => {
      const change = buildPendingChange({ status: 'approved' });
      mockedRepo.getPendingConfigChange.mockResolvedValue(change);

      await expect(
        service.approveConfigChange('change-1', 'user-approver', '127.0.0.1', 'test-agent'),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('rolls back on error', async () => {
      const { pool } = jest.requireMock('../../../src/shared/database/pool') as {
        pool: { connect: jest.Mock };
      };
      const mockClient = buildMockClient();
      pool.connect.mockResolvedValue(mockClient);

      const change = buildPendingChange();
      mockedRepo.getPendingConfigChange.mockResolvedValue(change);
      mockedRepo.approvePendingConfigChangeWithClient.mockRejectedValue(new Error('DB error'));

      await expect(
        service.approveConfigChange('change-1', 'user-approver', '127.0.0.1', 'test-agent'),
      ).rejects.toThrow('DB error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('toggleKillSwitch', () => {
    it('toggles the kill switch and audits', async () => {
      const { pool } = jest.requireMock('../../../src/shared/database/pool') as {
        pool: { connect: jest.Mock };
      };
      const mockClient = buildMockClient();
      pool.connect.mockResolvedValue(mockClient);

      mockedRepo.setSystemSettingWithClient.mockResolvedValue();
      mockedRepo.createSystemAuditEntryWithClient.mockResolvedValue();

      const result = await service.toggleKillSwitch(true, 'user-mgmt', '127.0.0.1', 'test-agent');

      expect(result).toEqual({ enabled: true });
      expect(mockedRepo.setSystemSettingWithClient).toHaveBeenCalledWith(
        mockClient,
        'payment_kill_switch',
        'true',
        'user-mgmt',
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });
  });
});
