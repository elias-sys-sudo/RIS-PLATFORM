const mockPoolConnect = jest.fn();
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: mockPoolConnect },
}));

import { query } from '../../../src/shared/database/pool';
import * as repo from '../../../src/services/risk-engine/risk-engine.repository';

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('risk-engine.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // findInvoiceForScoring
  // -----------------------------------------------------------------------
  describe('findInvoiceForScoring', () => {
    it('returns invoice when found', async () => {
      const row = {
        id: 'inv-1',
        invoice_number: 'INV-001',
        face_value: '50000000',
        tenor_days: 45,
        status: 'buyer_confirmed',
        buyer_id: 'b-1',
        supplier_id: 's-1',
        aml_flagged: false,
      };
      mockedQuery.mockResolvedValue({ rows: [row], rowCount: 1 } as never);

      const result = await repo.findInvoiceForScoring('inv-1');

      expect(result).toEqual(row);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM invoices WHERE id = $1'),
        ['inv-1'],
      );
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
      const result = await repo.findInvoiceForScoring('missing');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // findBuyerForScoring
  // -----------------------------------------------------------------------
  describe('findBuyerForScoring', () => {
    it('returns buyer when found', async () => {
      const row = {
        id: 'b-1',
        credit_rating: 'B',
        approved_limit: '100000000',
        used_limit: '5000000',
        ris_margin_rate: '0.0300',
        payment_score: 80,
      };
      mockedQuery.mockResolvedValue({ rows: [row], rowCount: 1 } as never);

      const result = await repo.findBuyerForScoring('b-1');
      expect(result).toEqual(row);
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
      const result = await repo.findBuyerForScoring('missing');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getSupplierTrackRecord
  // -----------------------------------------------------------------------
  describe('getSupplierTrackRecord', () => {
    it('calculates on-time percentage correctly', async () => {
      mockedQuery.mockResolvedValue({
        rows: [
          {
            invoice_count: '10',
            collected_count: '8',
            defaulted_count: '2',
          },
        ],
        rowCount: 1,
      } as never);

      const result = await repo.getSupplierTrackRecord('s-1');

      expect(result.invoice_count).toBe(10);
      expect(result.on_time_pct).toBe(80);
      expect(result.has_defaults).toBe(true);
    });

    it('returns zero for no history', async () => {
      mockedQuery.mockResolvedValue({
        rows: [
          {
            invoice_count: '0',
            collected_count: '0',
            defaulted_count: '0',
          },
        ],
        rowCount: 1,
      } as never);

      const result = await repo.getSupplierTrackRecord('s-1');

      expect(result.invoice_count).toBe(0);
      expect(result.on_time_pct).toBe(0);
      expect(result.has_defaults).toBe(false);
    });

    it('returns fallback values when row is undefined (null coalescing branches)', async () => {
      // Simulate DB returning no rows at all — triggers all three ?? fallbacks
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

      const result = await repo.getSupplierTrackRecord('s-missing');

      // invoice_count ?? '0' → total = 0, so on_time_pct = 0, has_defaults = false
      expect(result.invoice_count).toBe(0);
      expect(result.on_time_pct).toBe(0);
      expect(result.has_defaults).toBe(false);
    });

    it('uses actual row values when all counts are present (non-null ?? branches)', async () => {
      // Provide a full row so row?.invoice_count is not undefined (branch 1 for each ??)
      mockedQuery.mockResolvedValue({
        rows: [
          {
            invoice_count: '5',
            collected_count: '5',
            defaulted_count: '0',
          },
        ],
        rowCount: 1,
      } as never);

      const result = await repo.getSupplierTrackRecord('s-perfect');

      expect(result.invoice_count).toBe(5);
      expect(result.on_time_pct).toBe(100);
      expect(result.has_defaults).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getBuyerUtilisation
  // -----------------------------------------------------------------------
  describe('getBuyerUtilisation', () => {
    it('calculates projected utilisation', async () => {
      mockedQuery.mockResolvedValue({
        rows: [
          {
            used_limit: '5000000',
            approved_limit: '100000000',
          },
        ],
        rowCount: 1,
      } as never);

      const result = await repo.getBuyerUtilisation('b-1', '50000000');

      expect(result.projected_utilisation_pct).toBe(55);
    });

    it('returns 100% when buyer not found', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

      const result = await repo.getBuyerUtilisation('missing', '100');
      expect(result.projected_utilisation_pct).toBe(100);
    });

    it('returns 100% when approved_limit is 0', async () => {
      mockedQuery.mockResolvedValue({
        rows: [
          {
            used_limit: '0',
            approved_limit: '0',
          },
        ],
        rowCount: 1,
      } as never);

      const result = await repo.getBuyerUtilisation('b-1', '100');
      expect(result.projected_utilisation_pct).toBe(100);
    });
  });

  // -----------------------------------------------------------------------
  // findBestCollateral
  // -----------------------------------------------------------------------
  describe('findBestCollateral', () => {
    it('returns best collateral when found', async () => {
      const row = {
        collateral_type: 'bank_guarantee',
        value: '50000000',
        is_active: true,
      };
      mockedQuery.mockResolvedValue({ rows: [row], rowCount: 1 } as never);

      const result = await repo.findBestCollateral('inv-1', 's-1');
      expect(result).toEqual(row);
    });

    it('returns null when no collateral', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
      const result = await repo.findBestCollateral('inv-1', 's-1');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // saveRiskScore
  // -----------------------------------------------------------------------
  describe('saveRiskScore', () => {
    it('inserts with parameterised query', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);

      await repo.saveRiskScore({
        id: 'rs-1',
        invoice_id: 'inv-1',
        buyer_credit_score: 22.5,
        tenor_score: 15.0,
        track_record_score: 20.0,
        concentration_score: 11.25,
        collateral_score: 9.0,
        final_score: 78,
        recommendation: 'AUTO_APPROVE',
        max_advance_pct: 0.95,
        risk_premium_rate: 0.005,
        scored_by: 'SYSTEM',
      });

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO risk_scores'),
        expect.arrayContaining(['rs-1', 'inv-1', 22.5, 78]),
      );
    });
  });

  // -----------------------------------------------------------------------
  // getRiskScoreByInvoiceId
  // -----------------------------------------------------------------------
  describe('getRiskScoreByInvoiceId', () => {
    it('returns score when found', async () => {
      const row = { id: 'rs-1', invoice_id: 'inv-1', final_score: 78 };
      mockedQuery.mockResolvedValue({ rows: [row], rowCount: 1 } as never);

      const result = await repo.getRiskScoreByInvoiceId('inv-1');
      expect(result).toEqual(row);
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
      const result = await repo.getRiskScoreByInvoiceId('missing');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // updateInvoiceStatus
  // -----------------------------------------------------------------------
  describe('updateInvoiceStatus', () => {
    it('uses parameterised query with optimistic lock', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);

      const count = await repo.updateInvoiceStatus('inv-1', 'scored', 'buyer_confirmed');

      expect(count).toBe(1);
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('AND status = $3'), [
        'scored',
        'inv-1',
        'buyer_confirmed',
      ]);
    });

    it('returns 0 when rowCount is null (?? 0 branch)', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: null } as never);

      const count = await repo.updateInvoiceStatus('inv-1', 'scored', 'wrong_status');

      expect(count).toBe(0);
    });

    it('returns actual rowCount when not null (non-null ?? branch)', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 3 } as never);

      const count = await repo.updateInvoiceStatus('inv-1', 'scored', 'buyer_confirmed');

      expect(count).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // createAuditEntry
  // -----------------------------------------------------------------------
  describe('createAuditEntry', () => {
    it('inserts audit log with parameterised query', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);

      await repo.createAuditEntry(
        null,
        'INVOICE_SCORED',
        'risk_scores',
        'inv-1',
        { status: 'buyer_confirmed' },
        { finalScore: 78, recommendation: 'AUTO_APPROVE' },
      );

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining([null, 'INVOICE_SCORED', 'risk_scores']),
      );
    });

    it('handles null old_values', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);

      await repo.createAuditEntry(null, 'TEST', 'test', 'rec-1', null, { foo: 'bar' });

      const args = mockedQuery.mock.calls[0][1] as unknown[];
      expect(args[4]).toBeNull();
    });

    it('passes null for ipAddress and userAgent when omitted (??  null branches)', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);

      await repo.createAuditEntry(
        'user-1',
        'INVOICE_SCORED',
        'risk_scores',
        'inv-1',
        { status: 'buyer_confirmed' },
        { finalScore: 78 },
        // ipAddress and userAgent intentionally omitted
      );

      const args = mockedQuery.mock.calls[0][1] as unknown[];
      expect(args[6]).toBeNull();
      expect(args[7]).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getClient
  // -----------------------------------------------------------------------
  describe('getClient', () => {
    it('returns a client from the pool', async () => {
      const fakeClient = { query: jest.fn(), release: jest.fn() };
      mockPoolConnect.mockResolvedValue(fakeClient);

      const client = await repo.getClient();

      expect(client).toBe(fakeClient);
      expect(mockPoolConnect).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // saveRiskScoreWithClient
  // -----------------------------------------------------------------------
  describe('saveRiskScoreWithClient', () => {
    it('inserts risk score using the provided client', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.saveRiskScoreWithClient(mockClient as never, {
        id: 'rs-1',
        invoice_id: 'inv-1',
        buyer_credit_score: 22.5,
        tenor_score: 15.0,
        track_record_score: 20.0,
        concentration_score: 11.25,
        collateral_score: 9.0,
        final_score: 78,
        recommendation: 'AUTO_APPROVE',
        max_advance_pct: 0.95,
        risk_premium_rate: 0.005,
        scored_by: 'SYSTEM',
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO risk_scores'),
        expect.arrayContaining(['rs-1', 'inv-1', 22.5, 78]),
      );
    });
  });

  // -----------------------------------------------------------------------
  // updateInvoiceStatusWithClient
  // -----------------------------------------------------------------------
  describe('updateInvoiceStatusWithClient', () => {
    it('updates invoice status using the provided client', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };

      const count = await repo.updateInvoiceStatusWithClient(
        mockClient as never,
        'inv-1',
        'scored',
        'buyer_confirmed',
      );

      expect(count).toBe(1);
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE invoices'), [
        'scored',
        'inv-1',
        'buyer_confirmed',
      ]);
    });

    it('returns 0 when rowCount is null', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rowCount: null }) };

      const count = await repo.updateInvoiceStatusWithClient(
        mockClient as never,
        'inv-1',
        'scored',
        'wrong_status',
      );

      expect(count).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // createAuditEntryWithClient
  // -----------------------------------------------------------------------
  describe('createAuditEntryWithClient', () => {
    it('inserts audit log using the provided client', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.createAuditEntryWithClient(
        mockClient as never,
        null,
        'INVOICE_SCORED',
        'risk_scores',
        'inv-1',
        { status: 'buyer_confirmed' },
        { finalScore: 78, recommendation: 'AUTO_APPROVE' },
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining([null, 'INVOICE_SCORED', 'risk_scores', 'inv-1']),
      );
    });

    it('handles null old_values', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.createAuditEntryWithClient(
        mockClient as never,
        'user-1',
        'TEST',
        'test',
        'rec-1',
        null,
        { foo: 'bar' },
      );

      const args = (mockClient.query.mock.calls[0] as [string, unknown[]])[1];
      expect(args[4]).toBeNull();
    });

    it('passes null for ipAddress and userAgent when omitted (??  null branches)', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.createAuditEntryWithClient(
        mockClient as never,
        'user-1',
        'INVOICE_SCORED',
        'risk_scores',
        'inv-1',
        null,
        { finalScore: 78 },
        // ipAddress and userAgent intentionally omitted
      );

      const args = (mockClient.query.mock.calls[0] as [string, unknown[]])[1];
      expect(args[6]).toBeNull();
      expect(args[7]).toBeNull();
    });
  });
});
