import type { IScoringFactor, ScoringContext, FactorScore } from '../risk-engine.types';
import * as repo from '../risk-engine.repository';
import { getRiskWeights } from '../../../shared/risk-config';
import { logger } from '../../../shared/logger';

/** Default weight — used when config unavailable. */
const DEFAULT_WEIGHT = 0.15;

/**
 * Scores concentration risk based on buyer utilisation.
 * Weight is loaded from risk_config table (key: weight_concentration).
 * (used_limit + invoice) / approved_limit expressed as %.
 *   ≤40%  = 100
 *   41-60 = 75
 *   61-75 = 50
 *   76-90 = 25
 *   >90%  = 0
 */
export class ConcentrationRiskScorer implements IScoringFactor {
  readonly name = 'concentration';
  readonly weight = DEFAULT_WEIGHT;

  async calculate(ctx: ScoringContext): Promise<FactorScore> {
    try {
      const weights = await getRiskWeights();
      const w = weights.concentration ?? DEFAULT_WEIGHT;
      const util = await repo.getBuyerUtilisation(ctx.buyer.id, ctx.invoice.face_value);
      const raw = calculateConcentrationRaw(util.projected_utilisation_pct);
      return {
        name: this.name,
        rawScore: raw,
        weightedScore: raw * w,
      };
    } catch (err) {
      logger.warn('ConcentrationRiskScorer failed, returning zero', {
        component: 'risk-engine',
        invoiceId: ctx.invoiceId,
        errorMessage: err instanceof Error ? err.message : 'Unknown',
      });
      return { name: this.name, rawScore: 0, weightedScore: 0 };
    }
  }
}

/** @internal exported for unit testing */
export function calculateConcentrationRaw(pct: number): number {
  if (pct <= 40) return 100;
  if (pct <= 60) return 75;
  if (pct <= 75) return 50;
  if (pct <= 90) return 25;
  return 0;
}
