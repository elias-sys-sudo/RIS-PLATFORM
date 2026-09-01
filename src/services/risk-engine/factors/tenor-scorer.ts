import type { IScoringFactor, ScoringContext, FactorScore } from '../risk-engine.types';
import { getRiskWeights } from '../../../shared/risk-config';
import { logger } from '../../../shared/logger';

/** Default weight — used when config unavailable. */
const DEFAULT_WEIGHT = 0.2;

/**
 * Scores the invoice tenor (days to maturity).
 * 1-30d=100, 31-60d=75, 61-90d=50, outside=0.
 * Weight is loaded from risk_config table (key: weight_tenor).
 */
export class TenorScorer implements IScoringFactor {
  readonly name = 'tenor';
  readonly weight = DEFAULT_WEIGHT;

  async calculate(ctx: ScoringContext): Promise<FactorScore> {
    try {
      const weights = await getRiskWeights();
      const w = weights.tenor ?? DEFAULT_WEIGHT;
      const days = ctx.invoice.tenor_days;
      const raw = calculateTenorRaw(days);
      return {
        name: this.name,
        rawScore: raw,
        weightedScore: raw * w,
      };
    } catch (err) {
      logger.warn('TenorScorer failed, returning zero', {
        component: 'risk-engine',
        invoiceId: ctx.invoiceId,
        errorMessage: err instanceof Error ? err.message : 'Unknown',
      });
      return { name: this.name, rawScore: 0, weightedScore: 0 };
    }
  }
}

/** @internal exported for unit testing */
export function calculateTenorRaw(days: number): number {
  if (days >= 1 && days <= 30) return 100;
  if (days >= 31 && days <= 60) return 75;
  if (days >= 61 && days <= 90) return 50;
  return 0;
}
