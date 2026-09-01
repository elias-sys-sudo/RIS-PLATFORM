process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.AML_FLAG_THRESHOLD_UGX = '100000000';

import * as service from '../../../src/services/collections/collections.service';
import * as repo from '../../../src/services/collections/collections.repository';
import { NotFoundError } from '../../../src/shared/errors/index';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/collections/collections.repository');
jest.mock('../../../src/services/facilities/facilities.repository', () => ({
  getDrawdownByInvoiceId: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('sar-uuid-1'),
}));
jest.mock('../../../src/shared/crypto', () => ({
  encrypt: jest.fn((v: string) => `encrypted:${v}`),
  decrypt: jest.fn((v: string) => v.replace('encrypted:', '')),
  hashDocument: jest.fn(() => 'hash'),
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;

const mockClient = {
  query: jest.fn().mockResolvedValue(undefined),
  release: jest.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const IP = '127.0.0.1';
const UA = 'jest-test-agent';
const USER_ID = 'compliance-user-1';

function makeCollectionRecord(): {
  id: string;
  invoice_id: string;
  buyer_id: string;
  face_value: string;
  amount_due: string;
  days_overdue: number;
  daily_penalty_rate: string;
  penalty_amount: string;
  status: string;
  escalation_level: string | null;
  demand_notice_sent: boolean;
  sar_flagged: boolean;
  total_collected: string | null;
  last_payment_at: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: 'collection-uuid-1',
    invoice_id: 'invoice-uuid-1',
    buyer_id: 'buyer-uuid-1',
    face_value: '150000000',
    amount_due: '150000000',
    days_overdue: 14,
    daily_penalty_rate: '0.001',
    penalty_amount: '2100000',
    status: 'escalated',
    escalation_level: '3',
    demand_notice_sent: true,
    sar_flagged: true,
    total_collected: '0',
    last_payment_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-15T00:00:00Z',
  };
}

function makeSarRecord(): {
  id: string;
  entity_type: string;
  entity_id: string;
  collection_id: string | null;
  invoice_id: string | null;
  reason: string;
  report_status: string;
  fia_reference: string | null;
  filed_by: string | null;
  filed_at: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: 'sar-uuid-1',
    entity_type: 'collection',
    entity_id: 'collection-uuid-1',
    collection_id: 'collection-uuid-1',
    invoice_id: 'invoice-uuid-1',
    reason: 'Suspected structuring activity',
    report_status: 'draft',
    fia_reference: null,
    filed_by: null,
    filed_at: null,
    created_at: '2026-01-15T00:00:00Z',
    updated_at: '2026-01-15T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
// We need to mock the pool import used by the service
jest.mock('../../../src/shared/database/pool', () => ({
  pool: {
    connect: jest.fn(),
    query: jest.fn(),
  },
  query: jest.fn(),
  beginWithRls: jest.fn().mockResolvedValue(undefined),
}));

const { pool, beginWithRls } = jest.requireMock('../../../src/shared/database/pool') as {
  pool: { connect: jest.Mock; query: jest.Mock };
  beginWithRls: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.query.mockResolvedValue(undefined);
  mockClient.release.mockReset();
  pool.connect.mockResolvedValue(mockClient);
  beginWithRls.mockResolvedValue(undefined);
});

// =========================================================================
// SAR Filing Workflow Tests
// =========================================================================
describe('generateSarReport', () => {
  it('creates a SAR report in draft status for a valid collection', async () => {
    mockedRepo.getCollectionById.mockResolvedValue(makeCollectionRecord());
    mockedRepo.createSarReportWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    const result = await service.generateSarReport(
      'collection-uuid-1',
      USER_ID,
      'Suspected structuring activity',
      IP,
      UA,
    );

    expect(result.sarId).toBe('sar-uuid-1');
    expect(mockedRepo.createSarReportWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        id: 'sar-uuid-1',
        entityType: 'collection',
        entityId: 'collection-uuid-1',
        collectionId: 'collection-uuid-1',
        invoiceId: 'invoice-uuid-1',
        reason: 'Suspected structuring activity',
      }),
    );
  });

  it('throws NotFoundError when collection does not exist', async () => {
    mockedRepo.getCollectionById.mockResolvedValue(null);

    await expect(
      service.generateSarReport('nonexistent', USER_ID, 'reason', IP, UA),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('writes audit entry inside transaction', async () => {
    mockedRepo.getCollectionById.mockResolvedValue(makeCollectionRecord());
    mockedRepo.createSarReportWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.generateSarReport('collection-uuid-1', USER_ID, 'Suspected structuring', IP, UA);

    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      mockClient,
      USER_ID,
      'SAR_REPORT_GENERATED',
      'suspicious_activity_reports',
      'sar-uuid-1',
      null,
      expect.objectContaining({ collectionId: 'collection-uuid-1', status: 'draft' }),
      IP,
      UA,
    );
  });

  it('rolls back on error', async () => {
    mockedRepo.getCollectionById.mockResolvedValue(makeCollectionRecord());
    mockedRepo.createSarReportWithClient.mockRejectedValue(new Error('DB error'));

    await expect(
      service.generateSarReport('collection-uuid-1', USER_ID, 'reason', IP, UA),
    ).rejects.toThrow('DB error');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe('fileSarWithFia', () => {
  it('updates SAR status to filed with FIA reference', async () => {
    mockedRepo.getSarById.mockResolvedValue(makeSarRecord());
    mockedRepo.updateSarStatusWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.fileSarWithFia('sar-uuid-1', 'FIA-2026-001', USER_ID, IP, UA);

    expect(mockedRepo.updateSarStatusWithClient).toHaveBeenCalledWith(
      mockClient,
      'sar-uuid-1',
      'filed',
      'FIA-2026-001',
      USER_ID,
    );
  });

  it('throws NotFoundError when SAR does not exist', async () => {
    mockedRepo.getSarById.mockResolvedValue(null);

    await expect(
      service.fileSarWithFia('nonexistent', 'FIA-123', USER_ID, IP, UA),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('writes audit log with old and new status', async () => {
    mockedRepo.getSarById.mockResolvedValue(makeSarRecord());
    mockedRepo.updateSarStatusWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.fileSarWithFia('sar-uuid-1', 'FIA-2026-001', USER_ID, IP, UA);

    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      mockClient,
      USER_ID,
      'SAR_FILED_WITH_FIA',
      'suspicious_activity_reports',
      'sar-uuid-1',
      { status: 'draft' },
      { status: 'filed', fiaReference: 'FIA-2026-001' },
      IP,
      UA,
    );
  });

  it('rolls back on error and releases client', async () => {
    mockedRepo.getSarById.mockResolvedValue(makeSarRecord());
    mockedRepo.updateSarStatusWithClient.mockRejectedValue(new Error('DB error'));

    await expect(service.fileSarWithFia('sar-uuid-1', 'FIA-123', USER_ID, IP, UA)).rejects.toThrow(
      'DB error',
    );

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});
