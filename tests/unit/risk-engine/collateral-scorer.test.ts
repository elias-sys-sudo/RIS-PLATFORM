import {
  CollateralScorer,
  calculateCollateralRaw,
} from '../../../src/services/risk-engine/factors/collateral-scorer';
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

describe('calculateCollateralRaw', () => {
  it('bank_guarantee → 100', () => {
    expect(calculateCollateralRaw('bank_guarantee')).toBe(100);
  });

  it('fixed_deposit_lien → 85', () => {
    expect(calculateCollateralRaw('fixed_deposit_lien')).toBe(85);
  });

  it('post_dated_cheque_full_value → 60', () => {
    expect(calculateCollateralRaw('post_dated_cheque_full_value')).toBe(60);
  });

  it('corporate_guarantee → 40', () => {
    expect(calculateCollateralRaw('corporate_guarantee')).toBe(40);
  });

  it('none → 0', () => {
    expect(calculateCollateralRaw('none')).toBe(0);
  });

  it('unknown type → 0', () => {
    expect(calculateCollateralRaw('unknown')).toBe(0);
  });

  // ACCEPTANCE TEST factor: post_dated_cheque_full_value → 60 → weighted 9.0
  it('acceptance test: PDC → raw 60', () => {
    expect(calculateCollateralRaw('post_dated_cheque_full_value')).toBe(60);
  });
});

describe('CollateralScorer.calculate', () => {
  const scorer = new CollateralScorer();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back to DEFAULT_WEIGHT (0.15) when collateral weight is missing from config', async () => {
    // Omit collateral key from weights to trigger the ?? DEFAULT_WEIGHT branch
    mockedGetRiskWeights.mockResolvedValueOnce({
      buyer_credit: 0.3,
      tenor: 0.2,
      track_record: 0.2,
      concentration: 0.15,
    } as never);
    mockedRepo.findBestCollateral.mockResolvedValue({
      collateral_type: 'bank_guarantee',
      value: '50000000',
      is_active: true,
    });

    const result = await scorer.calculate(makeCtx());
    // raw=100, weight falls back to 0.15 (DEFAULT_WEIGHT)
    expect(result.rawScore).toBe(100);
    expect(result.weightedScore).toBe(15.0);
  });
});
