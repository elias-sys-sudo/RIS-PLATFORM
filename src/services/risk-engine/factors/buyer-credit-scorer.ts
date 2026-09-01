import type { IScoringFactor, ScoringContext, FactorScore } from '../risk-engine.types';
import { getRiskWeights } from '../../../shared/risk-config';
import { logger } from '../../../shared/logger';

/**
 * Credit rating → raw score mapping.
 * A=100 (prime), B=75 (good), C=50 (fair), D=25 (poor).
 */
const CREDIT_RATING_SCORES: Record<string, number> = {
  A: 100,
  B: 75,
  C: 50,
  D: 25,
};

/** Default weight — used when config unavailable. */
const DEFAULT_WEIGHT = 0.3;

/**
 * Scores the buyer's credit rating.
 * Weight is loaded from risk_config table (key: weight_buyer_credit).
 */
export class BuyerCreditScorer implements IScoringFactor {
  readonly name = 'buyer_credit';
  readonly weight = DEFAULT_WEIGHT;

  async calculate(ctx: ScoringContext): Promise<FactorScore> {
    try {
      const weights = await getRiskWeights();
      const w = weights.buyer_credit ?? DEFAULT_WEIGHT;
      const raw = CREDIT_RATING_SCORES[ctx.buyer.credit_rating] ?? 0;
      return {
        name: this.name,
        rawScore: raw,
        weightedScore: raw * w,
      };
    } catch (err) {
      logger.warn('BuyerCreditScorer failed, returning zero', {
        component: 'risk-engine',
        invoiceId: ctx.invoiceId,
        errorMessage: err instanceof Error ? err.message : 'Unknown',
      });
      return { name: this.name, rawScore: 0, weightedScore: 0 };
    }
  }
}
