process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as repo from '../../../src/services/pricing/pricing.repository';
import { query } from '../../../src/shared/database/pool';

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
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('pricing.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =======================================================================
  // getInvoiceForPricing
  // =======================================================================
  describe('getInvoiceForPricing', () => {
    it('returns invoice when found', async () => {
      const invoice = {
        id: 'inv-1',
        face_value: '50000000',
        tenor_days: 45,
        status: 'scored',
        buyer_id: 'buyer-1',
        due_date: '2026-05-05',
      };
      mockedQuery.mockResolvedValue({
        rows: [invoice],
        rowCount: 1,
      } as never);

      const result = await repo.getInvoiceForPricing('inv-1');

      expect(result).toEqual(invoice);
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT'), ['inv-1']);
    });

    it('returns null when invoice not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await repo.getInvoiceForPricing('missing');

      expect(result).toBeNull();
    });
  });

  // =======================================================================
  // getRiskScoreForPricing
  // =======================================================================
  describe('getRiskScoreForPricing', () => {
    it('returns risk score when found', async () => {
      const score = {
        id: 'rs-1',
        invoice_id: 'inv-1',
        max_advance_pct: '0.9500',
        risk_premium_rate: '0.0050',
        bank_cost_rate: null,
      };
      mockedQuery.mockResolvedValue({
        rows: [score],
        rowCount: 1,
      } as never);

      const result = await repo.getRiskScoreForPricing('inv-1');

      expect(result).toEqual(score);
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await repo.getRiskScoreForPricing('missing');

      expect(result).toBeNull();
    });
  });

  // =======================================================================
  // getActiveFacility
  // =======================================================================
  describe('getActiveFacility', () => {
    it('returns active facility when available', async () => {
      const facility = {
        id: 'fac-1',
        facility_name: 'Stanbic WC',
        interest_rate_annual: '0.1800',
      };
      mockedQuery.mockResolvedValue({
        rows: [facility],
        rowCount: 1,
      } as never);

      const result = await repo.getActiveFacility();

      expect(result).toEqual(facility);
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('is_active'), []);
    });

    it('returns null when no active facility', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await repo.getActiveFacility();

      expect(result).toBeNull();
    });
  });

  // =======================================================================
  // getBuyerRisMargin
  // =======================================================================
  describe('getBuyerRisMargin', () => {
    it('returns buyer margin rate', async () => {
      const margin = { ris_margin_rate: '0.0300' };
      mockedQuery.mockResolvedValue({
        rows: [margin],
        rowCount: 1,
      } as never);

      const result = await repo.getBuyerRisMargin('buyer-1');

      expect(result).toEqual(margin);
    });

    it('returns null when buyer not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await repo.getBuyerRisMargin('missing');

      expect(result).toBeNull();
    });
  });

  // =======================================================================
  // updateRiskScoreWithPricing
  // =======================================================================
  describe('updateRiskScoreWithPricing', () => {
    it('updates risk score with pricing data', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rowCount: 1 }),
      };
      const data = {
        bank_cost_rate: 0.18,
        ris_margin_rate: 0.03,
        total_discount_rate: 0.026507,
        advance_amount: '47500000',
        discount_amount: '1325342',
        net_payment_to_supplier: '46174658',
      };

      await repo.updateRiskScoreWithPricing(mockClient as never, 'rs-1', data);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE risk_scores'),
        expect.arrayContaining([0.18, 0.03, 'rs-1']),
      );
    });
  });

  // =======================================================================
  // updateInvoiceWithPricing
  // =======================================================================
  describe('updateInvoiceWithPricing', () => {
    it('updates invoice with pricing amounts', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rowCount: 1 }),
      };
      const data = {
        advance_amount: '47500000',
        discount_amount: '1325342',
        net_payment_to_supplier: '46174658',
      };

      await repo.updateInvoiceWithPricing(mockClient as never, 'inv-1', data);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE invoices'),
        expect.arrayContaining(['47500000', '1325342', '46174658', 'inv-1']),
      );
    });
  });

  // =======================================================================
  // getPricingDetails
  // =======================================================================
  describe('getPricingDetails', () => {
    it('returns pricing details when found', async () => {
      const details = {
        id: 'rs-1',
        invoice_id: 'inv-1',
        bank_cost_rate: '0.1800',
        ris_margin_rate: '0.0300',
        risk_premium_rate: '0.0050',
        total_discount_rate: '0.026507',
        max_advance_pct: '0.9500',
        advance_amount: '47500000',
        discount_amount: '1325342',
        net_payment_to_supplier: '46174658',
        face_value: '50000000',
        tenor_days: 45,
        due_date: '2026-05-05',
      };
      mockedQuery.mockResolvedValue({
        rows: [details],
        rowCount: 1,
      } as never);

      const result = await repo.getPricingDetails('inv-1');

      expect(result).toEqual(details);
    });

    it('returns null when not priced', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await repo.getPricingDetails('inv-1');

      expect(result).toBeNull();
    });
  });

  // =======================================================================
  // setDisputedAtWithClient
  // =======================================================================
  describe('setDisputedAtWithClient', () => {
    it('executes parameterised UPDATE setting pricing_disputed_at', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rowCount: 1 }),
      };

      await repo.setDisputedAtWithClient(mockClient as never, 'inv-dispute-1');

      const [sql, params] = mockClient.query.mock.calls[0] as [string, string[]];
      expect(sql).toContain('pricing_disputed_at');
      expect(sql).toContain('UPDATE invoices');
      expect(sql).not.toContain('inv-dispute-1'); // ID must be in params, not SQL
      expect(params).toContain('inv-dispute-1');
    });
  });

  // =======================================================================
  // createPricingDisputeWithClient
  // =======================================================================
  describe('createPricingDisputeWithClient', () => {
    it('INSERTs a pricing_disputes row and returns the created record', async () => {
      const DISPUTE_ROW = {
        id: 'dispute-uuid-1',
        invoice_id: 'inv-1',
        submitted_by: 'user-1',
        reason: 'rate_too_high',
        proposed_rate: null,
        proposed_advance_pct: null,
        notes: null,
        submitted_at: '2026-04-11T00:00:00.000Z',
        sla_deadline: '2026-04-12T00:00:00.000Z',
        status: 'open',
        resolved_at: null,
        resolved_by: null,
        resolution_notes: null,
      };
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [DISPUTE_ROW], rowCount: 1 }),
      };

      const result = await repo.createPricingDisputeWithClient(
        mockClient as never,
        'inv-1',
        'user-1',
        'rate_too_high',
        null,
        null,
        null,
        new Date('2026-04-12T00:00:00.000Z'),
      );

      expect(result).toEqual(DISPUTE_ROW);
      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO pricing_disputes');
      expect(params).toContain('inv-1');
      expect(params).toContain('user-1');
      expect(params).toContain('rate_too_high');
    });
  });

  // =======================================================================
  // getOpenPricingDispute
  // =======================================================================
  describe('getOpenPricingDispute', () => {
    it('returns null when no open dispute exists', async () => {
      mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

      const result = await repo.getOpenPricingDispute('inv-no-dispute');

      expect(result).toBeNull();
    });

    it('returns the open dispute row when found', async () => {
      const DISPUTE_ROW = {
        id: 'dispute-uuid-2',
        invoice_id: 'inv-1',
        submitted_by: 'user-1',
        reason: 'advance_too_low',
        proposed_rate: null,
        proposed_advance_pct: null,
        notes: 'Advance too low for my needs',
        submitted_at: '2026-04-11T00:00:00.000Z',
        sla_deadline: '2026-04-12T00:00:00.000Z',
        status: 'open',
        resolved_at: null,
        resolved_by: null,
        resolution_notes: null,
      };
      mockedQuery.mockResolvedValue({ rows: [DISPUTE_ROW], rowCount: 1 } as never);

      const result = await repo.getOpenPricingDispute('inv-1');

      expect(result).toEqual(DISPUTE_ROW);
      const [sql, params] = mockedQuery.mock.calls[0] as [string, string[]];
      expect(sql).toContain("status = 'open'");
      expect(params).toContain('inv-1');
    });
  });

  // =======================================================================
  // createAuditEntry
  // =======================================================================
  describe('createAuditEntry', () => {
    it('inserts audit log entry using transaction client', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rowCount: 1 }),
      };

      await repo.createAuditEntry(
        mockClient as never,
        null,
        'INVOICE_PRICED',
        'risk_scores',
        'inv-1',
        { status: 'scored' },
        { advanceAmount: '47500000' },
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining(['INVOICE_PRICED', 'risk_scores', 'inv-1']),
      );
    });

    it('passes null for old_values when oldValues is null (branch coverage)', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rowCount: 1 }),
      };

      await repo.createAuditEntry(
        mockClient as never,
        'officer-1',
        'INVOICE_PRICED',
        'risk_scores',
        'inv-1',
        null,
        { advanceAmount: '47500000' },
      );

      const [, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      // oldValues null → param[4] should be null
      expect(params[4]).toBeNull();
    });

    it('passes null for ipAddress and userAgent when omitted (??  null branches)', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rowCount: 1 }),
      };

      await repo.createAuditEntry(
        mockClient as never,
        'user-1',
        'INVOICE_PRICED',
        'risk_scores',
        'inv-1',
        { old: 'val' },
        { new: 'val' },
        // ipAddress and userAgent intentionally omitted
      );

      const [, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(params[6]).toBeNull();
      expect(params[7]).toBeNull();
    });
  });
});
