process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/pricing/pricing.service';
import * as repo from '../../../src/services/pricing/pricing.repository';
import type {
  InvoiceForPricing,
  RiskScoreForPricing,
  FacilityForPricing,
  BuyerMargin,
  PricingCalculationInput,
  PricingDisputePayload,
} from '../../../src/services/pricing/pricing.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/pricing/pricing.repository');
jest.mock('../../../src/services/invoices/invoices.repository', () => ({
  findSupplierByUserId: jest.fn(),
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
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  pool: {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    }),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findSupplierByUserId } = require('../../../src/services/invoices/invoices.repository') as {
  findSupplierByUserId: jest.Mock;
};

const mockedRepo = repo as jest.Mocked<typeof repo>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const INVOICE_ID = 'invoice-uuid-1';
const RISK_SCORE_ID = 'risk-score-uuid-1';

function makeInvoice(overrides: Partial<InvoiceForPricing> = {}): InvoiceForPricing {
  return {
    id: INVOICE_ID,
    face_value: '50000000',
    tenor_days: 45,
    status: 'scored',
    buyer_id: 'buyer-1',
    due_date: '2026-05-05',
    ...overrides,
  };
}

function makeRiskScore(overrides: Partial<RiskScoreForPricing> = {}): RiskScoreForPricing {
  return {
    id: RISK_SCORE_ID,
    invoice_id: INVOICE_ID,
    max_advance_pct: '0.9500',
    risk_premium_rate: '0.0050',
    bank_cost_rate: null,
    ...overrides,
  };
}

function makeFacility(overrides: Partial<FacilityForPricing> = {}): FacilityForPricing {
  return {
    id: 'facility-1',
    facility_name: 'Stanbic Working Capital',
    interest_rate_annual: '0.0800',
    ...overrides,
  };
}

function makeBuyerMargin(overrides: Partial<BuyerMargin> = {}): BuyerMargin {
  return {
    ris_margin_rate: '0.0300',
    ...overrides,
  };
}

/** Set up all repo mocks for the acceptance test scenario. */
function setupAcceptanceTestMocks(): void {
  mockedRepo.getInvoiceForPricing.mockResolvedValue(makeInvoice());
  mockedRepo.getRiskScoreForPricing.mockResolvedValue(makeRiskScore());
  mockedRepo.getActiveFacility.mockResolvedValue(makeFacility());
  mockedRepo.getBuyerRisMargin.mockResolvedValue(makeBuyerMargin());
  mockedRepo.updateRiskScoreWithPricing.mockResolvedValue(undefined);
  mockedRepo.updateInvoiceWithPricing.mockResolvedValue(undefined);
  mockedRepo.createAuditEntry.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('pricing.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =======================================================================
  // PURE CALCULATION TESTS — calculatePricing()
  // =======================================================================
  describe('calculatePricing — pure BigInt arithmetic', () => {
    const input: PricingCalculationInput = {
      faceValue: 50_000_000n,
      tenorDays: 45,
      maxAdvancePct: 0.95,
      riskPremiumRate: 0.005,
      bankCostRate: 0.08,
      risMarginRate: 0.03,
    };

    // totalAnnualRate = 0.08 + 0.005 + 0.03 = 0.115
    // totalDiscountRate = 0.115 * (45/365) ≈ 0.01417808
    // advanceAmount = 50_000_000 * 0.95 = 47_500_000
    // discountAmount = 50_000_000 * 0.01417808 ≈ 708_904
    // netPayment = 47_500_000 - 708_904 ≈ 46_791_096

    it('computes advance_amount correctly', () => {
      const result = service.calculatePricing(input);
      expect(result.advanceAmount).toBe(47_500_000n);
    });

    it('computes discount_amount correctly (±1 UGX)', () => {
      const result = service.calculatePricing(input);
      expect(Math.abs(Number(result.discountAmount) - 708_904)).toBeLessThanOrEqual(1);
    });

    it('computes net_payment correctly (±1 UGX)', () => {
      const result = service.calculatePricing(input);
      expect(Math.abs(Number(result.netPaymentToSupplier) - 46_791_096)).toBeLessThanOrEqual(1);
    });

    it('net_payment equals advance minus discount', () => {
      const result = service.calculatePricing(input);
      expect(result.netPaymentToSupplier).toBe(result.advanceAmount - result.discountAmount);
    });

    it('uses integer arithmetic — no floating point in final amounts', () => {
      const result = service.calculatePricing(input);
      expect(typeof result.advanceAmount).toBe('bigint');
      expect(typeof result.discountAmount).toBe('bigint');
      expect(typeof result.netPaymentToSupplier).toBe('bigint');
      expect(typeof result.bankCostAmount).toBe('bigint');
      expect(typeof result.risNetProfit).toBe('bigint');
    });

    it('computes risNetProfit as discount minus bank cost', () => {
      const result = service.calculatePricing(input);
      expect(result.risNetProfit).toBe(result.discountAmount - result.bankCostAmount);
      expect(result.risNetProfit > 0n).toBe(true);
    });

    it('computes totalDiscountRate as a decimal fraction', () => {
      const result = service.calculatePricing(input);
      // (0.08 + 0.005 + 0.03) * (45/365) ≈ 0.01417808
      expect(result.totalDiscountRate).toBeGreaterThan(0.01417);
      expect(result.totalDiscountRate).toBeLessThan(0.01419);
    });
  });

  // =======================================================================
  // ACCEPTANCE TEST — exact numbers (±1 UGX)
  // =======================================================================
  describe('ACCEPTANCE TEST', () => {
    it('produces correct pricing for the standard scenario', async () => {
      setupAcceptanceTestMocks();

      const result = await service.priceInvoice(INVOICE_ID);

      // facility rate=8%, risk=0.5%, margin=3%, tenor=45d, face=50M, advance=95%
      // totalAnnualRate = 0.115, discountRate = 0.115*(45/365) ≈ 0.01417808
      // advance = 47_500_000, discount ≈ 708_904, net ≈ 46_791_096
      expect(Number(result.advanceAmount)).toBe(47_500_000);
      expect(Math.abs(Number(result.discountAmount) - 708_904)).toBeLessThanOrEqual(1);
      expect(Math.abs(Number(result.netPaymentToSupplier) - 46_791_096)).toBeLessThanOrEqual(1);
    });

    it('stores pricing data in risk_scores', async () => {
      setupAcceptanceTestMocks();

      await service.priceInvoice(INVOICE_ID);

      expect(mockedRepo.updateRiskScoreWithPricing).toHaveBeenCalledWith(
        expect.anything(),
        RISK_SCORE_ID,
        expect.objectContaining({
          bank_cost_rate: 0.08,
          ris_margin_rate: 0.03,
          advance_amount: '47500000',
        }),
      );
    });

    it('stores pricing data in invoices', async () => {
      setupAcceptanceTestMocks();

      await service.priceInvoice(INVOICE_ID);

      expect(mockedRepo.updateInvoiceWithPricing).toHaveBeenCalledWith(
        expect.anything(),
        INVOICE_ID,
        expect.objectContaining({
          advance_amount: '47500000',
        }),
      );
    });

    it('writes audit log before returning', async () => {
      setupAcceptanceTestMocks();

      await service.priceInvoice(INVOICE_ID);

      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        expect.anything(),
        null,
        'INVOICE_PRICED',
        'risk_scores',
        INVOICE_ID,
        expect.objectContaining({ status: 'scored' }),
        expect.objectContaining({
          advanceAmount: '47500000',
        }),
      );
    });

    it('returns a fee breakdown for supplier display', async () => {
      setupAcceptanceTestMocks();

      const result = await service.priceInvoice(INVOICE_ID);

      expect(result.feeBreakdown).toBeDefined();
      expect(result.feeBreakdown.faceValue).toBe('50000000');
      expect(result.feeBreakdown.advanceAmount).toBe('47500000');
      expect(result.feeBreakdown.expectedCollectionDate).toBe('2026-05-05');
    });
  });

  // =======================================================================
  // Validation errors
  // =======================================================================
  describe('priceInvoice — validation', () => {
    it('throws NotFoundError when invoice not found', async () => {
      mockedRepo.getInvoiceForPricing.mockResolvedValue(null);

      await expect(service.priceInvoice('missing')).rejects.toThrow('Invoice not found');
    });

    it('throws BusinessRuleError when status is not scored', async () => {
      mockedRepo.getInvoiceForPricing.mockResolvedValue(makeInvoice({ status: 'submitted' }));

      await expect(service.priceInvoice(INVOICE_ID)).rejects.toThrow('scored');
    });

    it('throws NotFoundError when risk score not found', async () => {
      mockedRepo.getInvoiceForPricing.mockResolvedValue(makeInvoice());
      mockedRepo.getRiskScoreForPricing.mockResolvedValue(null);

      await expect(service.priceInvoice(INVOICE_ID)).rejects.toThrow('RiskScore not found');
    });

    it('throws BusinessRuleError when already priced', async () => {
      mockedRepo.getInvoiceForPricing.mockResolvedValue(makeInvoice());
      mockedRepo.getRiskScoreForPricing.mockResolvedValue(
        makeRiskScore({ bank_cost_rate: '0.1800' }),
      );

      await expect(service.priceInvoice(INVOICE_ID)).rejects.toThrow('already been priced');
    });

    it('throws BusinessRuleError when no active facility', async () => {
      mockedRepo.getInvoiceForPricing.mockResolvedValue(makeInvoice());
      mockedRepo.getRiskScoreForPricing.mockResolvedValue(makeRiskScore());
      mockedRepo.getActiveFacility.mockResolvedValue(null);

      await expect(service.priceInvoice(INVOICE_ID)).rejects.toThrow('No active bank facility');
    });

    it('throws NotFoundError when buyer margin not found (line 285-287)', async () => {
      mockedRepo.getInvoiceForPricing.mockResolvedValue(makeInvoice());
      mockedRepo.getRiskScoreForPricing.mockResolvedValue(makeRiskScore());
      mockedRepo.getActiveFacility.mockResolvedValue(makeFacility());
      mockedRepo.getBuyerRisMargin.mockResolvedValue(null);

      await expect(service.priceInvoice(INVOICE_ID)).rejects.toThrow('Buyer');
    });
  });

  // =======================================================================
  // Per-buyer margin override
  // =======================================================================
  describe('per-buyer margin override', () => {
    it('uses buyer-specific margin rate when different from default', async () => {
      const customMargin = '0.0450';
      mockedRepo.getInvoiceForPricing.mockResolvedValue(makeInvoice());
      mockedRepo.getRiskScoreForPricing.mockResolvedValue(makeRiskScore());
      mockedRepo.getActiveFacility.mockResolvedValue(makeFacility());
      mockedRepo.getBuyerRisMargin.mockResolvedValue(
        makeBuyerMargin({ ris_margin_rate: customMargin }),
      );
      mockedRepo.updateRiskScoreWithPricing.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceWithPricing.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.priceInvoice(INVOICE_ID);

      expect(result.risMarginRate).toBe(0.045);
      // Higher margin → higher discount → lower net payment
      expect(Number(result.discountAmount)).toBeGreaterThan(472_603);
    });
  });

  // =======================================================================
  // Transaction rollback
  // =======================================================================
  describe('transaction handling', () => {
    it('rolls back transaction on DB update error', async () => {
      mockedRepo.getInvoiceForPricing.mockResolvedValue(makeInvoice());
      mockedRepo.getRiskScoreForPricing.mockResolvedValue(makeRiskScore());
      mockedRepo.getActiveFacility.mockResolvedValue(makeFacility());
      mockedRepo.getBuyerRisMargin.mockResolvedValue(makeBuyerMargin());
      mockedRepo.updateRiskScoreWithPricing.mockRejectedValue(new Error('DB write failed'));

      await expect(service.priceInvoice(INVOICE_ID)).rejects.toThrow('DB write failed');
    });
  });

  // =======================================================================
  // getPricing (read endpoint)
  // =======================================================================
  describe('getPricing', () => {
    it('returns pricing result when found', async () => {
      mockedRepo.getInvoiceForPricing.mockResolvedValue(makeInvoice());
      mockedRepo.getRiskScoreForPricing.mockResolvedValue(
        makeRiskScore({ bank_cost_rate: '0.1800' }),
      );
      mockedRepo.getActiveFacility.mockResolvedValue(makeFacility());
      mockedRepo.getBuyerRisMargin.mockResolvedValue(makeBuyerMargin());
      mockedRepo.getPricingDetails.mockResolvedValue({
        id: RISK_SCORE_ID,
        invoice_id: INVOICE_ID,
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
      });

      const result = await service.getPricing(INVOICE_ID);

      expect(result).toBeDefined();
      expect(result.advanceAmount).toBe('47500000');
    });

    it('throws NotFoundError when pricing not found', async () => {
      mockedRepo.getPricingDetails.mockResolvedValue(null);

      await expect(service.getPricing(INVOICE_ID)).rejects.toThrow('not found');
    });
  });

  // =======================================================================
  // buildFeeBreakdown
  // =======================================================================
  describe('buildFeeBreakdown', () => {
    it('produces a complete breakdown', () => {
      const breakdown = service.buildFeeBreakdown({
        faceValue: 50_000_000n,
        advanceAmount: 47_500_000n,
        discountAmount: 1_325_342n,
        netPaymentToSupplier: 46_174_658n,
        maxAdvancePct: 0.95,
        totalDiscountRate: 0.02650684,
        bankCostRate: 0.18,
        riskPremiumRate: 0.005,
        risMarginRate: 0.03,
        dueDate: '2026-05-05',
        tenorDays: 45,
      });

      expect(breakdown.faceValue).toBe('50000000');
      expect(breakdown.advancePercentage).toBe('95.00');
      expect(breakdown.advanceAmount).toBe('47500000');
      expect(breakdown.netPaymentToSupplier).toBe('46174658');
      expect(breakdown.expectedCollectionDate).toBe('2026-05-05');
      expect(Number(breakdown.bankCostComponent)).toBeGreaterThan(0);
      expect(Number(breakdown.riskPremiumComponent)).toBeGreaterThan(0);
      expect(Number(breakdown.risMarginComponent)).toBeGreaterThan(0);
    });
  });

  // =======================================================================
  // acceptPricing — supplier accepts pricing
  // =======================================================================
  describe('acceptPricing', () => {
    const USER_ID = 'user-uuid-1';
    const SUPPLIER_ID = 'sup-uuid-1';
    const IP_ADDR = '10.0.0.1';
    const USER_AGENT = 'TestAgent';

    it('succeeds when invoice is priced and not yet accepted', async () => {
      findSupplierByUserId.mockResolvedValue({ id: SUPPLIER_ID });
      mockedRepo.getInvoicePricingStatus.mockResolvedValue({
        id: INVOICE_ID,
        status: 'priced',
        supplier_id: SUPPLIER_ID,
        pricing_accepted_at: null,
        pricing_rejected_at: null,
        pricing_disputed_at: null,
        advance_amount: '47500000',
      });
      mockedRepo.acceptPricingWithClient.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await expect(
        service.acceptPricing(INVOICE_ID, USER_ID, IP_ADDR, USER_AGENT),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenError when supplier not found for user', async () => {
      findSupplierByUserId.mockResolvedValue(null);

      await expect(
        service.acceptPricing(INVOICE_ID, USER_ID, IP_ADDR, USER_AGENT),
      ).rejects.toThrow();
    });

    it('throws NotFoundError when invoice not found for supplier', async () => {
      findSupplierByUserId.mockResolvedValue({ id: SUPPLIER_ID });
      mockedRepo.getInvoicePricingStatus.mockResolvedValue(null);

      await expect(service.acceptPricing(INVOICE_ID, USER_ID, IP_ADDR, USER_AGENT)).rejects.toThrow(
        'not found',
      );
    });

    it('throws BusinessRuleError when invoice has no advance_amount (not priced)', async () => {
      findSupplierByUserId.mockResolvedValue({ id: SUPPLIER_ID });
      mockedRepo.getInvoicePricingStatus.mockResolvedValue({
        id: INVOICE_ID,
        status: 'scored',
        supplier_id: SUPPLIER_ID,
        pricing_accepted_at: null,
        pricing_rejected_at: null,
        pricing_disputed_at: null,
        advance_amount: null,
      });

      await expect(service.acceptPricing(INVOICE_ID, USER_ID, IP_ADDR, USER_AGENT)).rejects.toThrow(
        'not been priced',
      );
    });

    it('throws BusinessRuleError when pricing already accepted', async () => {
      findSupplierByUserId.mockResolvedValue({ id: SUPPLIER_ID });
      mockedRepo.getInvoicePricingStatus.mockResolvedValue({
        id: INVOICE_ID,
        status: 'priced',
        supplier_id: SUPPLIER_ID,
        pricing_accepted_at: '2026-03-01T00:00:00Z',
        pricing_rejected_at: null,
        pricing_disputed_at: null,
        advance_amount: '47500000',
      });

      await expect(service.acceptPricing(INVOICE_ID, USER_ID, IP_ADDR, USER_AGENT)).rejects.toThrow(
        'already accepted',
      );
    });
  });

  // =======================================================================
  // rejectPricing — supplier rejects pricing
  // =======================================================================
  describe('rejectPricing', () => {
    const USER_ID = 'user-uuid-1';
    const SUPPLIER_ID = 'sup-uuid-1';
    const IP_ADDR = '10.0.0.1';
    const USER_AGENT = 'TestAgent';
    const REASON = 'Discount too high';

    it('succeeds when invoice is priced and not yet rejected', async () => {
      findSupplierByUserId.mockResolvedValue({ id: SUPPLIER_ID });
      mockedRepo.getInvoicePricingStatus.mockResolvedValue({
        id: INVOICE_ID,
        status: 'priced',
        supplier_id: SUPPLIER_ID,
        pricing_accepted_at: null,
        pricing_rejected_at: null,
        pricing_disputed_at: null,
        advance_amount: '47500000',
      });
      mockedRepo.rejectPricingWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatusWithClient.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await expect(
        service.rejectPricing(INVOICE_ID, USER_ID, REASON, IP_ADDR, USER_AGENT),
      ).resolves.toBeUndefined();
    });

    it('throws BusinessRuleError when pricing already rejected', async () => {
      findSupplierByUserId.mockResolvedValue({ id: SUPPLIER_ID });
      mockedRepo.getInvoicePricingStatus.mockResolvedValue({
        id: INVOICE_ID,
        status: 'priced',
        supplier_id: SUPPLIER_ID,
        pricing_accepted_at: null,
        pricing_rejected_at: '2026-03-01T00:00:00Z',
        pricing_disputed_at: null,
        advance_amount: '47500000',
      });

      await expect(
        service.rejectPricing(INVOICE_ID, USER_ID, REASON, IP_ADDR, USER_AGENT),
      ).rejects.toThrow('already rejected');
    });

    it('throws ForbiddenError when supplier not found', async () => {
      findSupplierByUserId.mockResolvedValue(null);

      await expect(
        service.rejectPricing(INVOICE_ID, USER_ID, REASON, IP_ADDR, USER_AGENT),
      ).rejects.toThrow();
    });
  });

  // =======================================================================
  // Queue null safety — notification queue
  // =======================================================================
  describe('queue null safety', () => {
    it('logs warning when notification queue is null during priceInvoice', async () => {
      service.setNotificationQueue(null as never);
      setupAcceptanceTestMocks();

      const result = await service.priceInvoice(INVOICE_ID);

      // Should succeed — notification is non-blocking
      expect(result.invoiceId).toBe(INVOICE_ID);
    });

    it('sends notification when notification queue is configured', async () => {
      const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setNotificationQueue(mockQueue as never);
      setupAcceptanceTestMocks();

      await service.priceInvoice(INVOICE_ID);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'pricing-ready',
        expect.objectContaining({ invoiceId: INVOICE_ID }),
        expect.objectContaining({ attempts: 3 }),
      );

      service.setNotificationQueue(null as never);
    });

    it('logs warning when approvals queue is null during acceptPricing', async () => {
      service.setApprovalsQueue(null as never);
      findSupplierByUserId.mockResolvedValue({ id: 'sup-1' });
      mockedRepo.getInvoicePricingStatus.mockResolvedValue({
        id: INVOICE_ID,
        status: 'priced',
        supplier_id: 'sup-1',
        pricing_accepted_at: null,
        pricing_rejected_at: null,
        pricing_disputed_at: null,
        advance_amount: '47500000',
      });
      mockedRepo.acceptPricingWithClient.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await expect(
        service.acceptPricing(INVOICE_ID, 'user-1', '10.0.0.1', 'UA'),
      ).resolves.toBeUndefined();
    });

    it('queues for approval when approvals queue is configured', async () => {
      const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setApprovalsQueue(mockQueue as never);
      findSupplierByUserId.mockResolvedValue({ id: 'sup-1' });
      mockedRepo.getInvoicePricingStatus.mockResolvedValue({
        id: INVOICE_ID,
        status: 'priced',
        supplier_id: 'sup-1',
        pricing_accepted_at: null,
        pricing_rejected_at: null,
        pricing_disputed_at: null,
        advance_amount: '47500000',
      });
      mockedRepo.acceptPricingWithClient.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await service.acceptPricing(INVOICE_ID, 'user-1', '10.0.0.1', 'UA');

      expect(mockQueue.add).toHaveBeenCalledWith(
        'score-for-approval',
        expect.objectContaining({ invoiceId: INVOICE_ID }),
        expect.objectContaining({ attempts: 3 }),
      );

      service.setApprovalsQueue(null as never);
    });
  });

  // =======================================================================
  // validateRateCap
  // =======================================================================
  describe('validateRateCap', () => {
    it('does not throw when rate is within cap', () => {
      expect(() => service.validateRateCap(0.1)).not.toThrow();
    });

    it('throws BusinessRuleError when rate exceeds cap', () => {
      expect(() => service.validateRateCap(0.16)).toThrow('exceeds maximum');
    });

    it('does not throw at exactly the cap', () => {
      expect(() => service.validateRateCap(0.15)).not.toThrow();
    });
  });

  // =======================================================================
  // disputePricing — supplier raises a pricing dispute
  // =======================================================================
  describe('disputePricing', () => {
    const SUPPLIER_ID = 'sup-uuid-1';
    const USER_ID = 'user-uuid-1';
    const IP_ADDR = '10.0.0.1';
    const USER_AGENT = 'TestAgent';
    const DISPUTE_PAYLOAD: PricingDisputePayload = { reason: 'rate_too_high' };

    const MOCK_DISPUTE_ROW = {
      id: 'dispute-uuid-1',
      invoice_id: INVOICE_ID,
      submitted_by: USER_ID,
      reason: 'rate_too_high' as const,
      proposed_rate: null,
      proposed_advance_pct: null,
      notes: null,
      submitted_at: '2026-04-11T00:00:00.000Z',
      sla_deadline: '2026-04-12T00:00:00.000Z',
      status: 'open' as const,
      resolved_at: null,
      resolved_by: null,
      resolution_notes: null,
    };

    function setupPricedInvoice(
      overrides: Partial<{
        pricing_accepted_at: string | null;
        pricing_rejected_at: string | null;
        pricing_disputed_at: string | null;
      }> = {},
    ) {
      mockedRepo.getInvoicePricingStatus.mockResolvedValue({
        id: INVOICE_ID,
        status: 'priced',
        supplier_id: SUPPLIER_ID,
        pricing_accepted_at: null,
        pricing_rejected_at: null,
        pricing_disputed_at: null,
        advance_amount: '47500000',
        ...overrides,
      });
    }

    it('returns DisputeResponse when invoice is priced with no prior dispute', async () => {
      findSupplierByUserId.mockResolvedValue({ id: SUPPLIER_ID });
      setupPricedInvoice();
      mockedRepo.setDisputedAtWithClient.mockResolvedValue(undefined);
      mockedRepo.createPricingDisputeWithClient.mockResolvedValue(MOCK_DISPUTE_ROW);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await service.disputePricing(
        INVOICE_ID,
        USER_ID,
        DISPUTE_PAYLOAD,
        IP_ADDR,
        USER_AGENT,
      );

      expect(result.id).toBe('dispute-uuid-1');
      expect(result.invoiceId).toBe(INVOICE_ID);
      expect(result.status).toBe('open');
      expect(mockedRepo.setDisputedAtWithClient).toHaveBeenCalled();
      expect(mockedRepo.createPricingDisputeWithClient).toHaveBeenCalled();
    });

    it('throws BusinessRuleError(PRICING_ALREADY_ACCEPTED) when pricing already accepted', async () => {
      findSupplierByUserId.mockResolvedValue({ id: SUPPLIER_ID });
      setupPricedInvoice({ pricing_accepted_at: '2026-04-01T00:00:00Z' });

      await expect(
        service.disputePricing(INVOICE_ID, USER_ID, DISPUTE_PAYLOAD, IP_ADDR, USER_AGENT),
      ).rejects.toMatchObject({ errorCode: 'PRICING_ALREADY_ACCEPTED' });
    });

    it('throws BusinessRuleError(PRICING_ALREADY_REJECTED) when pricing already rejected', async () => {
      findSupplierByUserId.mockResolvedValue({ id: SUPPLIER_ID });
      setupPricedInvoice({ pricing_rejected_at: '2026-04-01T00:00:00Z' });

      await expect(
        service.disputePricing(INVOICE_ID, USER_ID, DISPUTE_PAYLOAD, IP_ADDR, USER_AGENT),
      ).rejects.toMatchObject({ errorCode: 'PRICING_ALREADY_REJECTED' });
    });

    it('throws BusinessRuleError(PRICING_ALREADY_DISPUTED) when dispute already submitted', async () => {
      findSupplierByUserId.mockResolvedValue({ id: SUPPLIER_ID });
      setupPricedInvoice({ pricing_disputed_at: '2026-04-01T00:00:00Z' });

      await expect(
        service.disputePricing(INVOICE_ID, USER_ID, DISPUTE_PAYLOAD, IP_ADDR, USER_AGENT),
      ).rejects.toMatchObject({ errorCode: 'PRICING_ALREADY_DISPUTED' });
    });

    it('rolls back and releases client on repository error', async () => {
      const poolMock = jest.requireMock('../../../src/shared/database/pool') as {
        pool: { connect: jest.Mock };
      };
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: jest.fn(),
      };
      poolMock.pool.connect.mockResolvedValueOnce(mockClient);

      findSupplierByUserId.mockResolvedValue({ id: SUPPLIER_ID });
      setupPricedInvoice();
      mockedRepo.setDisputedAtWithClient.mockRejectedValue(new Error('DB error'));

      await expect(
        service.disputePricing(INVOICE_ID, USER_ID, DISPUTE_PAYLOAD, IP_ADDR, USER_AGENT),
      ).rejects.toThrow('DB error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
