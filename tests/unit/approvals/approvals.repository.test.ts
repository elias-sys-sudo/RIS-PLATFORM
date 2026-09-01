process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import type { QueryResultRow } from 'pg';
import * as repo from '../../../src/services/approvals/approvals.repository';
import { query } from '../../../src/shared/database/pool';
import { ApprovalTier, ApprovalDecision } from '../../../src/services/approvals/approvals.types';

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

const mockedQuery = query as jest.MockedFunction<typeof query>;

function mockQueryResult(rows: QueryResultRow[] = [], rowCount = 0) {
  return {
    rows,
    rowCount,
    command: 'SELECT' as const,
    oid: 0,
    fields: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('approvals.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // createApproval
  // =========================================================================
  describe('createApproval', () => {
    it('inserts an approval record with all required fields', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 1));

      await repo.createApproval({
        id: 'appr-1',
        invoiceId: 'inv-1',
        tier: ApprovalTier.AUTO,
        decision: ApprovalDecision.APPROVED,
        approverId: 'SYSTEM',
        comments: 'Auto-approved: score 80, value 5000000',
      });

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO approvals');
      expect(params).toContain('appr-1');
      expect(params).toContain('inv-1');
      expect(params).toContain(ApprovalTier.AUTO);
      expect(params).toContain(ApprovalDecision.APPROVED);
      expect(params).toContain('SYSTEM');
    });

    it('uses parameterised queries (no string concatenation)', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 1));

      await repo.createApproval({
        id: 'appr-2',
        invoiceId: 'inv-2',
        tier: ApprovalTier.TIER_2,
        decision: ApprovalDecision.APPROVED,
        approverId: 'officer-1',
        comments: 'Approved after review of buyer creditworthiness',
      });

      const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('$1');
      expect(sql).not.toMatch(/\+ ['"`]/);
    });
  });

  // =========================================================================
  // lockInvoiceForReview
  // =========================================================================
  describe('lockInvoiceForReview', () => {
    it('uses SELECT FOR UPDATE to lock the invoice row', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([{ id: 'inv-1' }], 1)),
      };

      const result = await repo.lockInvoiceForReview(mockClient as never, 'inv-1');

      const [sql] = mockClient.query.mock.calls[0] as string[];
      expect(sql).toContain('SELECT');
      expect(sql).toContain('FOR UPDATE');
      expect(result).toBeDefined();
    });

    it('returns null when invoice not found', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 0)),
      };

      const result = await repo.lockInvoiceForReview(mockClient as never, 'missing-id');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getApprovalsByInvoiceId
  // =========================================================================
  describe('getApprovalsByInvoiceId', () => {
    it('returns all approvals for a given invoice', async () => {
      const rows = [
        { id: 'appr-1', invoice_id: 'inv-1', decision: 'APPROVED' },
        { id: 'appr-2', invoice_id: 'inv-1', decision: 'APPROVED' },
      ];
      mockedQuery.mockResolvedValue(mockQueryResult(rows, 2));

      const result = await repo.getApprovalsByInvoiceId('inv-1');

      expect(result).toHaveLength(2);
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE invoice_id = $1'), [
        'inv-1',
      ]);
    });

    it('returns empty array when no approvals exist', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.getApprovalsByInvoiceId('inv-no-approvals');

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getPendingApprovalsByOfficer
  // =========================================================================
  describe('getPendingApprovalsByOfficer', () => {
    it('returns pending invoices assigned to a specific queue', async () => {
      const rows = [{ invoice_id: 'inv-1', face_value: '20000000', tier: 'TIER_2' }];
      mockedQuery.mockResolvedValue(mockQueryResult(rows, 1));

      const result = await repo.getPendingApprovalsByOfficer('officer-1');

      expect(result).toHaveLength(1);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('$1'),
        expect.arrayContaining(['officer-1']),
      );
    });
  });

  // =========================================================================
  // getInvoicesExceedingSLA
  // =========================================================================
  describe('getInvoicesExceedingSLA', () => {
    it('returns invoices pending longer than specified hours', async () => {
      const rows = [{ id: 'inv-1', status: 'approved', hours_pending: 26 }];
      mockedQuery.mockResolvedValue(mockQueryResult(rows, 1));

      const result = await repo.getInvoicesExceedingSLA(24);

      expect(result).toHaveLength(1);
      const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INTERVAL');
      expect(params).toContain(24);
    });

    it('returns empty array when no SLA breaches', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.getInvoicesExceedingSLA(24);

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // incrementTier3RejectionCount
  // =========================================================================
  describe('incrementTier3RejectionCount', () => {
    it('increments and returns the new rejection count from RETURNING', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([{ tier3_rejection_count: 2 }], 1)),
      };

      const count = await repo.incrementTier3RejectionCount(mockClient as never, 'inv-1');

      expect(count).toBe(2);
      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE invoices');
      expect(sql).toContain('tier3_rejection_count');
      expect(sql).toContain('RETURNING');
      expect(params).toContain('inv-1');
    });

    it('returns 1 as fallback when RETURNING row is absent (null coalescing branch)', async () => {
      // rows is empty — result.rows[0] is undefined, so ?? 1 fires
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 0)),
      };

      const count = await repo.incrementTier3RejectionCount(mockClient as never, 'inv-missing');

      expect(count).toBe(1);
    });
  });

  // =========================================================================
  // resetTier3RejectionCount
  // =========================================================================
  describe('resetTier3RejectionCount', () => {
    it('resets the tier3_rejection_count to 0 using the transaction client', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 1)),
      };

      await repo.resetTier3RejectionCount(mockClient as never, 'inv-1');

      expect(mockClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE invoices');
      expect(sql).toContain('tier3_rejection_count = 0');
      expect(params).toContain('inv-1');
    });
  });

  // =========================================================================
  // getInvoiceForApproval
  // =========================================================================
  describe('getInvoiceForApproval', () => {
    it('returns invoice with fields needed for approval routing', async () => {
      const row = {
        id: 'inv-1',
        face_value: '30000000',
        status: 'scored',
        supplier_id: 'sup-1',
        buyer_id: 'buyer-1',
        aml_flagged: false,
      };
      mockedQuery.mockResolvedValue(mockQueryResult([row], 1));

      const result = await repo.getInvoiceForApproval('inv-1');

      expect(result).toEqual(row);
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), ['inv-1']);
    });

    it('returns null when invoice not found', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.getInvoiceForApproval('missing');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getRiskScoreForApproval
  // =========================================================================
  describe('getRiskScoreForApproval', () => {
    it('returns risk score for the invoice', async () => {
      const row = {
        id: 'rs-1',
        invoice_id: 'inv-1',
        final_score: 80,
        recommendation: 'AUTO_APPROVE',
      };
      mockedQuery.mockResolvedValue(mockQueryResult([row], 1));

      const result = await repo.getRiskScoreForApproval('inv-1');

      expect(result).toEqual(row);
    });
  });

  // =========================================================================
  // updateInvoiceStatus (transactional)
  // =========================================================================
  describe('updateInvoiceStatus', () => {
    it('updates invoice status using the transaction client', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 1)),
      };

      await repo.updateInvoiceStatus(mockClient as never, 'inv-1', 'approved', 'scored');

      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE invoices');
      expect(sql).toContain('SET status');
      expect(params).toContain('approved');
      expect(params).toContain('inv-1');
    });
  });

  // =========================================================================
  // createApprovalWithClient (transactional)
  // =========================================================================
  describe('createApprovalWithClient', () => {
    it('inserts approval using the transaction client', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 1)),
      };

      await repo.createApprovalWithClient(mockClient as never, {
        id: 'appr-1',
        invoiceId: 'inv-1',
        tier: ApprovalTier.TIER_2,
        decision: ApprovalDecision.APPROVED,
        approverId: 'officer-1',
        comments: 'Approved after thorough review',
      });

      const [sql] = mockClient.query.mock.calls[0] as string[];
      expect(sql).toContain('INSERT INTO approvals');
    });
  });

  // =========================================================================
  // createAuditEntry (transactional)
  // =========================================================================
  describe('createAuditEntry', () => {
    it('inserts an audit log entry via the transaction client', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 1)),
      };

      await repo.createAuditEntry(
        mockClient as never,
        'officer-1',
        'INVOICE_APPROVED',
        'approvals',
        'inv-1',
        { status: 'scored' },
        { status: 'approved', tier: 'TIER_2' },
      );

      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params).toContain('officer-1');
      expect(params).toContain('INVOICE_APPROVED');
    });

    it('passes null for old_values when oldValues is null', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 1)),
      };

      await repo.createAuditEntry(
        mockClient as never,
        'officer-1',
        'INVOICE_REJECTED',
        'approvals',
        'inv-1',
        null,
        { status: 'rejected', tier: 'TIER_2' },
      );

      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO audit_logs');
      // oldValues is null — param at index 4 (5th param) should be null
      expect(params[4]).toBeNull();
    });

    it('passes null for user_id when userId is null', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 1)),
      };

      await repo.createAuditEntry(
        mockClient as never,
        null,
        'INVOICE_APPROVED',
        'approvals',
        'inv-1',
        { status: 'scored' },
        { status: 'approved' },
      );

      const [, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBeNull();
    });
  });

  // =========================================================================
  // getRiskScoreForApproval — null return branch
  // =========================================================================
  describe('getRiskScoreForApproval — null return', () => {
    it('returns null when no risk score found', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.getRiskScoreForApproval('missing-invoice');

      expect(result).toBeNull();
    });
  });
});
