import {
  ConcentrationRiskScorer,
  calculateConcentrationRaw,
} from '../../../src/services/risk-engine/factors/concentration-risk-scorer';
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

describe('calculateConcentrationRaw', () => {
  it.each([
    [0, 100],
    [10, 100],
    [40, 100],
    [41, 75],
    [50, 75],
    [55, 75],
    [60, 75],
    [61, 50],
    [70, 50],
    [75, 50],
    [76, 25],
    [85, 25],
    [90, 25],
    [91, 0],
    [100, 0],
  ])('utilisation %d%% → raw %d', (pct, expected) => {
    expect(calculateConcentrationRaw(pct)).toBe(expected);
  });

  // ACCEPTANCE TEST factor: 55% → 75 → weighted 11.25
  it('acceptance test: 55% utilisation → raw 75', () => {
    expect(calculateConcentrationRaw(55)).toBe(75);
  });
});

describe('ConcentrationRiskScorer.calculate', () => {
  const scorer = new ConcentrationRiskScorer();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back to DEFAULT_WEIGHT (0.15) when concentration weight is missing from config', async () => {
    // Omit concentration key from weights to trigger the ?? DEFAULT_WEIGHT branch
    mockedGetRiskWeights.mockResolvedValueOnce({
      buyer_credit: 0.3,
      tenor: 0.2,
      track_record: 0.2,
      collateral: 0.15,
    } as never);
    mockedRepo.getBuyerUtilisation.mockResolvedValue({
      used_limit: '5000000',
      approved_limit: '100000000',
      projected_utilisation_pct: 30,
    });

    const result = await scorer.calculate(makeCtx());
    // utilisation 30% → raw=100, weight falls back to 0.15 (DEFAULT_WEIGHT)
    expect(result.rawScore).toBe(100);
    expect(result.weightedScore).toBe(15.0);
  });
});
