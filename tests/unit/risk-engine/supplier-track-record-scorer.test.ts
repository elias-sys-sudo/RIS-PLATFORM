import {
  SupplierTrackRecordScorer,
  calculateTrackRecordRaw,
} from '../../../src/services/risk-engine/factors/supplier-track-record-scorer';
import type { ScoringContext } from '../../../src/services/risk-engine/risk-engine.types';
import { getRiskWeights } from '../../../src/shared/risk-config';
import * as repo from '../../../src/services/risk-engine/risk-engine.repository';

jest.mock('../../../src/services/risk-engine/risk-engine.repository');

jest.mock('../../../src/shared/risk-config', () => ({
  getRiskWeights: jest.fn().mockResolvedValue({
    buyer_credit: 0.3,
    tenor: 0.2,
    track_record: 0.2,
    concentration: 0.15,
    collateral: 0.15,
  }),
  getRiskConfigNumber: jest.fn().mockResolvedValue(0),
  getRiskConfigValue: jest.fn().mockResolvedValue('0'),
  loadRiskConfig: jest.fn().mockResolvedValue(new Map()),
  invalidateRiskConfigCache: jest.fn(),
  getDefaults: jest.fn().mockReturnValue({}),
}));

const mockedGetRiskWeights = getRiskWeights as jest.MockedFunction<typeof getRiskWeights>;
const mockedRepo = repo as jest.Mocked<typeof repo>;

function makeCtx(): ScoringContext {
  return {
    invoiceId: 'inv-1',
    invoice: {
      id: 'inv-1',
      invoice_number: 'INV-001',
      face_value: '50000000',
      tenor_days: 45,
      status: 'buyer_confirmed',
      buyer_id: 'buyer-1',
      supplier_id: 'supplier-1',
      aml_flagged: false,
    },
    buyer: {
      id: 'buyer-1',
      credit_rating: 'B',
      approved_limit: '100000000',
      used_limit: '5000000',
      ris_margin_rate: '0.0300',
      payment_score: 80,
    },
  };
}

describe('calculateTrackRecordRaw', () => {
  it('returns 25 if any defaults', () => {
    expect(
      calculateTrackRecordRaw({
        invoice_count: 10,
        on_time_pct: 90,
        has_defaults: true,
      }),
    ).toBe(25);
  });

  it('returns 50 for first invoice (no history)', () => {
    expect(
      calculateTrackRecordRaw({
        invoice_count: 0,
        on_time_pct: 0,
        has_defaults: false,
      }),
    ).toBe(50);
  });

  it('returns 70 for 1-3 invoices with >90% on-time', () => {
    expect(
      calculateTrackRecordRaw({
        invoice_count: 3,
        on_time_pct: 100,
        has_defaults: false,
      }),
    ).toBe(70);
  });

  it('returns 50 for 1-3 invoices with ≤90% on-time', () => {
    expect(
      calculateTrackRecordRaw({
        invoice_count: 2,
        on_time_pct: 50,
        has_defaults: false,
      }),
    ).toBe(50);
  });

  it('returns 85 for 4-10 invoices with >90% ≤95% on-time', () => {
    expect(
      calculateTrackRecordRaw({
        invoice_count: 6,
        on_time_pct: 92,
        has_defaults: false,
      }),
    ).toBe(85);
  });

  it('returns 100 for 4-10 invoices with >95% on-time', () => {
    expect(
      calculateTrackRecordRaw({
        invoice_count: 8,
        on_time_pct: 100,
        has_defaults: false,
      }),
    ).toBe(100);
  });

  it('returns 100 for 8 invoices with 96% on-time', () => {
    expect(
      calculateTrackRecordRaw({
        invoice_count: 8,
        on_time_pct: 96,
        has_defaults: false,
      }),
    ).toBe(100);
  });

  it('returns 70 for 4-10 invoices with ≤90% on-time', () => {
    expect(
      calculateTrackRecordRaw({
        invoice_count: 5,
        on_time_pct: 80,
        has_defaults: false,
      }),
    ).toBe(70);
  });

  it('returns 100 for 11+ invoices with >95% on-time', () => {
    expect(
      calculateTrackRecordRaw({
        invoice_count: 15,
        on_time_pct: 98,
        has_defaults: false,
      }),
    ).toBe(100);
  });

  it('returns 85 for 11+ invoices with ≤95% on-time', () => {
    expect(
      calculateTrackRecordRaw({
        invoice_count: 20,
        on_time_pct: 90,
        has_defaults: false,
      }),
    ).toBe(85);
  });

  // ACCEPTANCE TEST factor: 8 invoices, 100% on-time → 100 → weighted 20.0
  it('acceptance test: 8 invoices 100% on-time → raw 100', () => {
    expect(
      calculateTrackRecordRaw({
        invoice_count: 8,
        on_time_pct: 100,
        has_defaults: false,
      }),
    ).toBe(100);
  });
});

describe('SupplierTrackRecordScorer.calculate', () => {
  const scorer = new SupplierTrackRecordScorer();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back to DEFAULT_WEIGHT (0.20) when track_record weight is missing from config', async () => {
    // Omit track_record key from weights to trigger the ?? DEFAULT_WEIGHT branch
    mockedGetRiskWeights.mockResolvedValueOnce({
      buyer_credit: 0.3,
      tenor: 0.2,
      concentration: 0.15,
      collateral: 0.15,
    } as never);
    mockedRepo.getSupplierTrackRecord.mockResolvedValue({
      invoice_count: 8,
      on_time_pct: 100,
      has_defaults: false,
    });

    const result = await scorer.calculate(makeCtx());
    // raw=100, weight falls back to 0.2 (DEFAULT_WEIGHT)
    expect(result.rawScore).toBe(100);
    expect(result.weightedScore).toBe(20.0);
  });
});
