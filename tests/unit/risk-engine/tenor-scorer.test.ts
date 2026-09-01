import {
  TenorScorer,
  calculateTenorRaw,
} from '../../../src/services/risk-engine/factors/tenor-scorer';
import type { ScoringContext } from '../../../src/services/risk-engine/risk-engine.types';
import { getRiskWeights } from '../../../src/shared/risk-config';

const mockedGetRiskWeights = getRiskWeights as jest.MockedFunction<typeof getRiskWeights>;

function makeCtx(tenorDays: number): ScoringContext {
  return {
    invoiceId: 'inv-1',
    invoice: {
      id: 'inv-1',
      invoice_number: 'INV-001',
      face_value: '50000000',
      tenor_days: tenorDays,
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

describe('TenorScorer', () => {
  const scorer = new TenorScorer();

  it('has name "tenor" and weight 0.20', () => {
    expect(scorer.name).toBe('tenor');
    expect(scorer.weight).toBe(0.2);
  });

  it('scores 1 day as 100 raw, 20.0 weighted', async () => {
    const r = await scorer.calculate(makeCtx(1));
    expect(r.rawScore).toBe(100);
    expect(r.weightedScore).toBe(20.0);
  });

  it('scores 30 days as 100 raw', async () => {
    const r = await scorer.calculate(makeCtx(30));
    expect(r.rawScore).toBe(100);
  });

  it('scores 31 days as 75 raw, 15.0 weighted', async () => {
    const r = await scorer.calculate(makeCtx(31));
    expect(r.rawScore).toBe(75);
    expect(r.weightedScore).toBe(15.0);
  });

  it('scores 45 days as 75 raw, 15.0 weighted', async () => {
    const r = await scorer.calculate(makeCtx(45));
    expect(r.rawScore).toBe(75);
    expect(r.weightedScore).toBe(15.0);
  });

  it('scores 60 days as 75 raw', async () => {
    const r = await scorer.calculate(makeCtx(60));
    expect(r.rawScore).toBe(75);
  });

  it('scores 61 days as 50 raw, 10.0 weighted', async () => {
    const r = await scorer.calculate(makeCtx(61));
    expect(r.rawScore).toBe(50);
    expect(r.weightedScore).toBe(10.0);
  });

  it('scores 90 days as 50 raw', async () => {
    const r = await scorer.calculate(makeCtx(90));
    expect(r.rawScore).toBe(50);
  });

  it('scores 0 days as 0', async () => {
    const r = await scorer.calculate(makeCtx(0));
    expect(r.rawScore).toBe(0);
  });

  it('scores 91 days as 0', async () => {
    const r = await scorer.calculate(makeCtx(91));
    expect(r.rawScore).toBe(0);
  });

  it('falls back to DEFAULT_WEIGHT (0.20) when tenor weight is missing from config', async () => {
    // Omit tenor key from weights to trigger the ?? DEFAULT_WEIGHT branch
    mockedGetRiskWeights.mockResolvedValueOnce({
      buyer_credit: 0.3,
      track_record: 0.2,
      concentration: 0.15,
      collateral: 0.15,
    } as never);

    const r = await scorer.calculate(makeCtx(15));
    // raw=100, weight falls back to 0.2 (DEFAULT_WEIGHT)
    expect(r.rawScore).toBe(100);
    expect(r.weightedScore).toBe(20.0);
  });
});

describe('calculateTenorRaw', () => {
  it.each([
    [7, 100],
    [15, 100],
    [30, 100],
    [31, 75],
    [45, 75],
    [60, 75],
    [61, 50],
    [75, 50],
    [90, 50],
    [0, 0],
    [91, 0],
    [-1, 0],
  ])('tenor %d → %d', (days, expected) => {
    expect(calculateTenorRaw(days)).toBe(expected);
  });
});
