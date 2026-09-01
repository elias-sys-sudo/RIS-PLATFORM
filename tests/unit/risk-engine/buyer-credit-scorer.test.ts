import { BuyerCreditScorer } from '../../../src/services/risk-engine/factors/buyer-credit-scorer';
import type { ScoringContext } from '../../../src/services/risk-engine/risk-engine.types';
import { getRiskWeights } from '../../../src/shared/risk-config';

function makeCtx(creditRating: string): ScoringContext {
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
      credit_rating: creditRating,
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

const mockedGetRiskWeights = getRiskWeights as jest.MockedFunction<typeof getRiskWeights>;

describe('BuyerCreditScorer', () => {
  const scorer = new BuyerCreditScorer();

  it('has name "buyer_credit" and weight 0.30', () => {
    expect(scorer.name).toBe('buyer_credit');
    expect(scorer.weight).toBe(0.3);
  });

  it('scores A rating as 100 raw, 30.0 weighted', async () => {
    const result = await scorer.calculate(makeCtx('A'));
    expect(result.rawScore).toBe(100);
    expect(result.weightedScore).toBe(30.0);
  });

  it('scores B rating as 75 raw, 22.5 weighted', async () => {
    const result = await scorer.calculate(makeCtx('B'));
    expect(result.rawScore).toBe(75);
    expect(result.weightedScore).toBe(22.5);
  });

  it('scores C rating as 50 raw, 15.0 weighted', async () => {
    const result = await scorer.calculate(makeCtx('C'));
    expect(result.rawScore).toBe(50);
    expect(result.weightedScore).toBe(15.0);
  });

  it('scores D rating as 25 raw, 7.5 weighted', async () => {
    const result = await scorer.calculate(makeCtx('D'));
    expect(result.rawScore).toBe(25);
    expect(result.weightedScore).toBe(7.5);
  });

  it('scores unknown rating as 0', async () => {
    const result = await scorer.calculate(makeCtx('X'));
    expect(result.rawScore).toBe(0);
    expect(result.weightedScore).toBe(0);
  });

  it('falls back to DEFAULT_WEIGHT (0.30) when buyer_credit weight is missing from config', async () => {
    // Omit buyer_credit key from weights to trigger the ?? DEFAULT_WEIGHT branch
    mockedGetRiskWeights.mockResolvedValueOnce({
      tenor: 0.2,
      track_record: 0.2,
      concentration: 0.15,
      collateral: 0.15,
    } as never);

    const result = await scorer.calculate(makeCtx('A'));
    // raw=100, weight falls back to 0.3 (DEFAULT_WEIGHT)
    expect(result.rawScore).toBe(100);
    expect(result.weightedScore).toBe(30.0);
  });
});
