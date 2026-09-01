process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/risk-engine/risk-engine.service';
import * as repo from '../../../src/services/risk-engine/risk-engine.repository';
import { RiskRecommendation } from '../../../src/services/risk-engine/risk-engine.types';
import { BuyerCreditScorer } from '../../../src/services/risk-engine/factors/buyer-credit-scorer';
import type {
  InvoiceForScoring,
  BuyerForScoring,
  TrackRecordResult,
  BuyerUtilisation,
  CollateralForScoring,
  RiskScoreRecord,
} from '../../../src/services/risk-engine/risk-engine.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/risk-engine/risk-engine.repository');
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('../../../src/shared/risk-config', () => ({
  getRiskWeights: jest.fn().mockResolvedValue({
    buyer_credit: 0.3,
    tenor: 0.2,
    track_record: 0.2,
    concentration: 0.15,
    collateral: 0.15,
  }),
  getRiskConfigNumber: jest.fn().mockImplementation((key: string) => {
    const defaults: Record<string, number> = {
      threshold_auto_approve: 75,
      threshold_refer_manager: 50,
      advance_pct_high: 0.95,
      advance_pct_mid: 0.9,
      advance_pct_low: 0.85,
      premium_score_80_plus: 0,
      premium_score_70_79: 0.005,
      premium_score_60_69: 0.01,
      premium_score_50_59: 0.015,
    };
    return Promise.resolve(defaults[key] ?? 0);
  }),
  getRiskConfigValue: jest.fn().mockResolvedValue('0'),
  loadRiskConfig: jest.fn().mockResolvedValue(new Map()),
  invalidateRiskConfigCache: jest.fn(),
  getDefaults: jest.fn().mockReturnValue({}),
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;

// Mock PoolClient for transaction support
const mockClient = {
  query: jest.fn().mockResolvedValue(undefined),
  release: jest.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const INVOICE_ID = 'invoice-uuid-1';

function makeInvoice(overrides: Partial<InvoiceForScoring> = {}): InvoiceForScoring {
  return {
    id: INVOICE_ID,
    invoice_number: 'INV-001',
    face_value: '50000000',
    tenor_days: 45,
    status: 'buyer_confirmed',
    buyer_id: 'buyer-1',
    supplier_id: 'supplier-1',
    aml_flagged: false,
    ...overrides,
  };
}

function makeBuyer(overrides: Partial<BuyerForScoring> = {}): BuyerForScoring {
  return {
    id: 'buyer-1',
    credit_rating: 'B',
    approved_limit: '100000000',
    used_limit: '5000000',
    ris_margin_rate: '0.0300',
    payment_score: 80,
    ...overrides,
  };
}

function makeTrackRecord(overrides: Partial<TrackRecordResult> = {}): TrackRecordResult {
  return {
    invoice_count: 8,
    on_time_pct: 100,
    has_defaults: false,
    ...overrides,
  };
}

function makeUtilisation(overrides: Partial<BuyerUtilisation> = {}): BuyerUtilisation {
  return {
    used_limit: '5000000',
    approved_limit: '100000000',
    projected_utilisation_pct: 55,
    ...overrides,
  };
}

function makeCollateral(overrides: Partial<CollateralForScoring> = {}): CollateralForScoring {
  return {
    collateral_type: 'post_dated_cheque_full_value',
    value: '50000000',
    is_active: true,
    ...overrides,
  };
}

/** Set up all repo mocks for the acceptance test scenario. */
function setupAcceptanceTestMocks(): void {
  mockedRepo.findInvoiceForScoring.mockResolvedValue(makeInvoice());
  mockedRepo.findBuyerForScoring.mockResolvedValue(makeBuyer());
  mockedRepo.getRiskScoreByInvoiceId.mockResolvedValue(null);
  mockedRepo.getSupplierTrackRecord.mockResolvedValue(makeTrackRecord());
  mockedRepo.getBuyerUtilisation.mockResolvedValue(makeUtilisation());
  mockedRepo.findBestCollateral.mockResolvedValue(makeCollateral());
  mockedRepo.saveRiskScoreWithClient.mockResolvedValue(undefined);
  mockedRepo.updateInvoiceStatusWithClient.mockResolvedValue(1);
  mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('risk-engine.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockResolvedValue(undefined);
    mockClient.release.mockReset();
    mockedRepo.getClient.mockResolvedValue(mockClient as never);
  });

  // =======================================================================
  // ACCEPTANCE TEST — exact numbers required
  // =======================================================================
  describe('ACCEPTANCE TEST', () => {
    it('produces exact factor scores and final result', async () => {
      setupAcceptanceTestMocks();

      const result = await service.scoreInvoice(INVOICE_ID);

      // Individual factor scores
      const byName = (n: string) => result.factors.find((f) => f.name === n);

      expect(byName('buyer_credit')?.weightedScore).toBe(22.5);
      expect(byName('tenor')?.weightedScore).toBe(15.0);
      expect(byName('track_record')?.weightedScore).toBe(20.0);
      expect(byName('concentration')?.weightedScore).toBe(11.25);
      expect(byName('collateral')?.weightedScore).toBe(9.0);

      // Final score
      expect(result.finalScore).toBe(78);
      expect(result.recommendation).toBe(RiskRecommendation.AUTO_APPROVE);
      expect(result.maxAdvancePct).toBe(0.95);
      expect(result.riskPremiumRate).toBe(0.005);
    });

    it('persists the score with correct values', async () => {
      setupAcceptanceTestMocks();

      await service.scoreInvoice(INVOICE_ID);

      expect(mockedRepo.saveRiskScoreWithClient).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          invoice_id: INVOICE_ID,
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
        }),
      );
    });

    it('transitions invoice to scored status', async () => {
      setupAcceptanceTestMocks();

      await service.scoreInvoice(INVOICE_ID);

      expect(mockedRepo.updateInvoiceStatusWithClient).toHaveBeenCalledWith(
        mockClient,
        INVOICE_ID,
        'scored',
        'buyer_confirmed',
      );
    });

    it('writes audit log before returning', async () => {
      setupAcceptanceTestMocks();

      await service.scoreInvoice(INVOICE_ID);

      expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
        mockClient,
        null,
        'INVOICE_SCORED',
        'risk_scores',
        INVOICE_ID,
        { status: 'buyer_confirmed' },
        expect.objectContaining({
          finalScore: 78,
          recommendation: 'AUTO_APPROVE',
        }),
      );
    });
  });

  // =======================================================================
  // scoreInvoice — validation errors
  // =======================================================================
  describe('scoreInvoice — validation', () => {
    it('throws NotFoundError when invoice not found', async () => {
      mockedRepo.findInvoiceForScoring.mockResolvedValue(null);

      await expect(service.scoreInvoice('missing')).rejects.toThrow('Invoice not found');
    });

    it('throws BusinessRuleError when status is not buyer_confirmed', async () => {
      mockedRepo.findInvoiceForScoring.mockResolvedValue(makeInvoice({ status: 'submitted' }));

      await expect(service.scoreInvoice(INVOICE_ID)).rejects.toThrow('buyer_confirmed');
    });

    it('throws BusinessRuleError when already scored', async () => {
      mockedRepo.findInvoiceForScoring.mockResolvedValue(makeInvoice());
      mockedRepo.getRiskScoreByInvoiceId.mockResolvedValue({
        id: 'existing',
      } as RiskScoreRecord);

      await expect(service.scoreInvoice(INVOICE_ID)).rejects.toThrow('already been scored');
    });

    it('throws NotFoundError when buyer not found', async () => {
      mockedRepo.findInvoiceForScoring.mockResolvedValue(makeInvoice());
      mockedRepo.getRiskScoreByInvoiceId.mockResolvedValue(null);
      mockedRepo.findBuyerForScoring.mockResolvedValue(null);

      await expect(service.scoreInvoice(INVOICE_ID)).rejects.toThrow('Buyer not found');
    });
  });

  // =======================================================================
  // scoreInvoice — REJECT flow
  // =======================================================================
  describe('scoreInvoice — reject flow', () => {
    it('transitions invoice to rejected on low score', async () => {
      mockedRepo.findInvoiceForScoring.mockResolvedValue(makeInvoice());
      mockedRepo.findBuyerForScoring.mockResolvedValue(makeBuyer({ credit_rating: 'D' }));
      mockedRepo.getRiskScoreByInvoiceId.mockResolvedValue(null);
      mockedRepo.getSupplierTrackRecord.mockResolvedValue(
        makeTrackRecord({ invoice_count: 0, on_time_pct: 0 }),
      );
      mockedRepo.getBuyerUtilisation.mockResolvedValue(
        makeUtilisation({ projected_utilisation_pct: 95 }),
      );
      mockedRepo.findBestCollateral.mockResolvedValue(null);
      mockedRepo.saveRiskScoreWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatusWithClient.mockResolvedValue(1);
      mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);

      const result = await service.scoreInvoice(INVOICE_ID);

      expect(result.recommendation).toBe(RiskRecommendation.REJECT);
      expect(mockedRepo.updateInvoiceStatusWithClient).toHaveBeenCalledWith(
        mockClient,
        INVOICE_ID,
        'rejected',
        'buyer_confirmed',
      );
    });
  });

  // =======================================================================
  // scoreInvoice — REFER_TO_MANAGER flow
  // =======================================================================
  describe('scoreInvoice — refer flow', () => {
    it('transitions invoice to scored on mid-range score', async () => {
      mockedRepo.findInvoiceForScoring.mockResolvedValue(makeInvoice());
      mockedRepo.findBuyerForScoring.mockResolvedValue(makeBuyer({ credit_rating: 'C' }));
      mockedRepo.getRiskScoreByInvoiceId.mockResolvedValue(null);
      mockedRepo.getSupplierTrackRecord.mockResolvedValue(
        makeTrackRecord({ invoice_count: 3, on_time_pct: 100 }),
      );
      mockedRepo.getBuyerUtilisation.mockResolvedValue(
        makeUtilisation({ projected_utilisation_pct: 50 }),
      );
      mockedRepo.findBestCollateral.mockResolvedValue(makeCollateral());
      mockedRepo.saveRiskScoreWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatusWithClient.mockResolvedValue(1);
      mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);

      const result = await service.scoreInvoice(INVOICE_ID);

      // C=50*0.30=15, tenor 45=75*0.20=15, track 3inv 100%=70*0.20=14,
      // conc 50%=75*0.15=11.25, coll PDC=60*0.15=9 → sum=64.25 → 64
      expect(result.recommendation).toBe(RiskRecommendation.REFER_TO_MANAGER);
      expect(mockedRepo.updateInvoiceStatusWithClient).toHaveBeenCalledWith(
        mockClient,
        INVOICE_ID,
        'scored',
        'buyer_confirmed',
      );
    });
  });

  // =======================================================================
  // scoreInvoice — no collateral
  // =======================================================================
  describe('scoreInvoice — no collateral', () => {
    it('handles null collateral with score 0', async () => {
      setupAcceptanceTestMocks();
      mockedRepo.findBestCollateral.mockResolvedValue(null);

      const result = await service.scoreInvoice(INVOICE_ID);

      const collateralFactor = result.factors.find((f) => f.name === 'collateral');
      expect(collateralFactor?.weightedScore).toBe(0);
    });
  });

  // =======================================================================
  // scoreInvoice — byName ?? 0 fallback (persistScoreWithClient)
  // =======================================================================
  describe('scoreInvoice — byName fallback to 0 when factor not found', () => {
    it('uses 0 for a score when a factor returns an unexpected name', async () => {
      setupAcceptanceTestMocks();

      // Spy on BuyerCreditScorer.prototype.calculate to return a factor
      // with a name that will NOT match 'buyer_credit' in byName lookup
      const spy = jest
        .spyOn(BuyerCreditScorer.prototype, 'calculate')
        .mockResolvedValueOnce({ name: 'unknown_factor', rawScore: 100, weightedScore: 30 });

      await service.scoreInvoice(INVOICE_ID);

      // byName('buyer_credit') finds no matching factor → falls back to ?? 0
      const savedCall = mockedRepo.saveRiskScoreWithClient.mock.calls[0][1];
      expect(savedCall.buyer_credit_score).toBe(0);

      spy.mockRestore();
    });
  });

  // =======================================================================
  // getRiskScore
  // =======================================================================
  describe('getRiskScore', () => {
    it('returns the risk score when found', async () => {
      const mockScore = {
        id: 'score-1',
        invoice_id: INVOICE_ID,
        final_score: 78,
      } as RiskScoreRecord;
      mockedRepo.getRiskScoreByInvoiceId.mockResolvedValue(mockScore);

      const result = await service.getRiskScore(INVOICE_ID);

      expect(result).toEqual(mockScore);
    });

    it('throws NotFoundError when not found', async () => {
      mockedRepo.getRiskScoreByInvoiceId.mockResolvedValue(null);

      await expect(service.getRiskScore(INVOICE_ID)).rejects.toThrow('RiskScore not found');
    });
  });

  // =======================================================================
  // Threshold functions
  // =======================================================================
  describe('determineRecommendation', () => {
    it.each([
      [100, RiskRecommendation.AUTO_APPROVE],
      [80, RiskRecommendation.AUTO_APPROVE],
      [78, RiskRecommendation.AUTO_APPROVE],
      [75, RiskRecommendation.AUTO_APPROVE],
      [74, RiskRecommendation.REFER_TO_MANAGER],
      [60, RiskRecommendation.REFER_TO_MANAGER],
      [50, RiskRecommendation.REFER_TO_MANAGER],
      [49, RiskRecommendation.REJECT],
      [0, RiskRecommendation.REJECT],
    ])('score %d → %s', async (score, expected) => {
      expect(await service.determineRecommendation(score)).toBe(expected);
    });
  });

  describe('determineMaxAdvance', () => {
    it.each([
      [100, 0.95],
      [80, 0.95],
      [75, 0.95],
      [74, 0.9],
      [60, 0.9],
      [59, 0.85],
      [50, 0.85],
      [49, 0],
      [0, 0],
    ])('score %d → %s', async (score, expected) => {
      expect(await service.determineMaxAdvance(score)).toBe(expected);
    });
  });

  describe('determineRiskPremium', () => {
    it.each([
      [100, 0],
      [80, 0],
      [79, 0.005],
      [78, 0.005],
      [70, 0.005],
      [69, 0.01],
      [60, 0.01],
      [59, 0.015],
      [50, 0.015],
      [49, 0],
    ])('score %d → %s', async (score, expected) => {
      expect(await service.determineRiskPremium(score)).toBe(expected);
    });
  });

  // =======================================================================
  // setNotificationQueue / setPricingQueue
  // =======================================================================
  describe('queue setters', () => {
    it('setNotificationQueue stores queue reference', () => {
      const mockQueue = { add: jest.fn() } as never;
      expect(() => service.setNotificationQueue(mockQueue)).not.toThrow();
    });

    it('setPricingQueue stores queue reference', () => {
      const mockQueue = { add: jest.fn() } as never;
      expect(() => service.setPricingQueue(mockQueue)).not.toThrow();
    });
  });

  // =======================================================================
  // scoreInvoice — transaction rollback on DB error
  // =======================================================================
  describe('scoreInvoice — transaction rollback', () => {
    it('rolls back and re-throws on DB error during persist', async () => {
      setupAcceptanceTestMocks();
      mockedRepo.saveRiskScoreWithClient.mockRejectedValue(new Error('DB write failed'));

      await expect(service.scoreInvoice(INVOICE_ID)).rejects.toThrow('DB write failed');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  // =======================================================================
  // scoreInvoice — queue operations with configured queues
  // =======================================================================
  describe('scoreInvoice — queues configured', () => {
    it('queues pricing when score >= 50 and pricingQueue set', async () => {
      const mockPricingQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setPricingQueue(mockPricingQueue as never);

      setupAcceptanceTestMocks();

      await service.scoreInvoice(INVOICE_ID);

      expect(mockPricingQueue.add).toHaveBeenCalledWith(
        'price-invoice',
        expect.objectContaining({ invoiceId: INVOICE_ID }),
        expect.objectContaining({ attempts: 3 }),
      );

      // Clean up
      service.setPricingQueue(null as never);
    });

    it('queues notification when score < 50 and notificationQueue set', async () => {
      const mockNotifQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setNotificationQueue(mockNotifQueue as never);

      mockedRepo.findInvoiceForScoring.mockResolvedValue(makeInvoice());
      mockedRepo.findBuyerForScoring.mockResolvedValue(makeBuyer({ credit_rating: 'D' }));
      mockedRepo.getRiskScoreByInvoiceId.mockResolvedValue(null);
      mockedRepo.getSupplierTrackRecord.mockResolvedValue(
        makeTrackRecord({ invoice_count: 0, on_time_pct: 0 }),
      );
      mockedRepo.getBuyerUtilisation.mockResolvedValue(
        makeUtilisation({ projected_utilisation_pct: 95 }),
      );
      mockedRepo.findBestCollateral.mockResolvedValue(null);
      mockedRepo.saveRiskScoreWithClient.mockResolvedValue(undefined);
      mockedRepo.updateInvoiceStatusWithClient.mockResolvedValue(1);
      mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);

      await service.scoreInvoice(INVOICE_ID);

      expect(mockNotifQueue.add).toHaveBeenCalledWith(
        'invoice-rejected',
        expect.objectContaining({ invoiceId: INVOICE_ID }),
        expect.objectContaining({ attempts: 3 }),
      );

      // Clean up
      service.setNotificationQueue(null as never);
    });
  });
});
