process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import type { QueryResultRow } from 'pg';
import * as repo from '../../../src/services/compliance/aml-clearance.repository';
import { query } from '../../../src/shared/database/pool';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
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

const INVOICE_ID = '11111111-1111-1111-1111-111111111111';
const OFFICER_ID = '22222222-2222-2222-2222-222222222222';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('aml-clearance.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // listAmlQueue — REFINEMENT 4 — non-PII columns only
  // =========================================================================
  describe('listAmlQueue (REFINEMENT 4)', () => {
    it('SELECTs only non-PII columns — no decrypted name fields', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      await repo.listAmlQueue();

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];

      // Whitelist of allowed identifiers / values
      expect(sql).toContain('i.id');
      expect(sql).toContain('i.supplier_id');
      expect(sql).toContain('i.buyer_id');
      expect(sql).toContain('i.face_value');
      expect(sql).toContain('aml_flagged_at');
      expect(sql).toContain('days_flagged');

      // Hard prohibition: no encrypted-name SELECTs in the list query.
      expect(sql).not.toContain('company_name_encrypted');
      expect(sql).not.toContain('first_name_encrypted');
      expect(sql).not.toContain('last_name_encrypted');
      expect(sql).not.toContain('phone_encrypted');
      expect(sql).not.toContain('email');

      // The list filter is the same as the partial index predicate.
      expect(sql).toContain('aml_flagged = true');
      expect(sql).toContain('aml_cleared_at IS NULL');
    });
  });

  // =========================================================================
  // getAmlDetail — REFINEMENT 4 — DOES select encrypted PII for decryption
  // =========================================================================
  describe('getAmlDetail (REFINEMENT 4)', () => {
    it('SELECTs encrypted company name columns (caller MUST audit the decrypt)', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      await repo.getAmlDetail(INVOICE_ID);

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];

      // The detail query is allowed to project the encrypted columns.
      expect(sql).toContain('s.company_name_encrypted');
      expect(sql).toContain('b.company_name_encrypted');

      expect(params).toContain(INVOICE_ID);
    });

    it('returns null when invoice not found', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.getAmlDetail(INVOICE_ID);

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getInvoiceClearanceState
  // =========================================================================
  describe('getInvoiceClearanceState', () => {
    it('SELECTs only id, aml_flagged, aml_cleared_at — no PII at all', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      await repo.getInvoiceClearanceState(INVOICE_ID);

      const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('id');
      expect(sql).toContain('aml_flagged');
      expect(sql).toContain('aml_cleared_at');
      expect(sql).not.toContain('encrypted');
    });
  });

  // =========================================================================
  // applyAmlClearanceWithClient
  // =========================================================================
  describe('applyAmlClearanceWithClient', () => {
    it('UPDATEs the three columns atomically and gates on aml_cleared_at IS NULL', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 0)),
      };

      await repo.applyAmlClearanceWithClient(
        mockClient as never,
        INVOICE_ID,
        OFFICER_ID,
        'a sufficiently long reason for sanctions clearance',
      );

      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('aml_cleared_at');
      expect(sql).toContain('aml_cleared_by');
      expect(sql).toContain('aml_clearance_reason');
      // The repo guards re-clearance at the SQL layer too — UPDATE WHERE.
      expect(sql).toContain('aml_flagged = true');
      expect(sql).toContain('aml_cleared_at IS NULL');
      expect(params).toEqual([
        OFFICER_ID,
        'a sufficiently long reason for sanctions clearance',
        INVOICE_ID,
      ]);
    });

    it('returns null when 0 rows updated (race condition with another officer)', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 0)),
      };

      const result = await repo.applyAmlClearanceWithClient(
        mockClient as never,
        INVOICE_ID,
        OFFICER_ID,
        'reason text long enough for joi',
      );

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // createAuditEntryWithClient — used inside the clearance txn
  // =========================================================================
  describe('createAuditEntryWithClient', () => {
    it('serialises old/new values as JSON and inserts into audit_logs', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 0)),
      };

      await repo.createAuditEntryWithClient(
        mockClient as never,
        OFFICER_ID,
        'AML_CLEARED',
        'invoices',
        INVOICE_ID,
        {},
        { invoice_id: INVOICE_ID, officer_id: OFFICER_ID },
        '10.0.0.1',
        'TestAgent/1.0',
      );

      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params[1]).toBe('AML_CLEARED');
      expect(params[2]).toBe('invoices');
      expect(params[3]).toBe(INVOICE_ID);
      // old_values and new_values are stringified JSON
      expect(params[4]).toBe('{}');
      expect(params[5]).toBe(JSON.stringify({ invoice_id: INVOICE_ID, officer_id: OFFICER_ID }));
    });
  });

  // =========================================================================
  // createAuditEntry (non-transactional) — for AML_DETAIL_VIEWED
  // =========================================================================
  describe('createAuditEntry', () => {
    it('writes via the pool query, not a passed client', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 1));

      await repo.createAuditEntry(
        OFFICER_ID,
        'AML_DETAIL_VIEWED',
        'invoices',
        INVOICE_ID,
        {},
        { invoice_id: INVOICE_ID, viewer_id: OFFICER_ID, viewer_role: 'compliance_officer' },
        '10.0.0.1',
        'TestAgent/1.0',
      );

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params[1]).toBe('AML_DETAIL_VIEWED');
    });
  });
});
