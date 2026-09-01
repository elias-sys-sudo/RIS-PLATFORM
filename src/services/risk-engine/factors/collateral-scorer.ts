import type { IScoringFactor, ScoringContext, FactorScore } from '../risk-engine.types';
import * as repo from '../risk-engine.repository';
import { getRiskWeights } from '../../../shared/risk-config';
import { logger } from '../../../shared/logger';

/**
 * Collateral type → raw score mapping.
 * Bank guarantee is strongest (100), none is weakest (0).
 */
const COLLATERAL_SCORES: Record<string, number> = {
  bank_guarantee: 100,
  fixed_deposit_lien: 85,
  assignment_of_receivables: 75,
  performance_bond: 70,
  post_dated_cheque_full_value: 60,
  corporate_guarantee: 40,
  none: 0,
};

/** Default weight — used when config unavailable. */
const DEFAULT_WEIGHT = 0.15;

/**
 * Scores the collateral backing the invoice.
 * Weight is loaded from risk_config table (key: weight_collateral).
 */
export class CollateralScorer implements IScoringFactor {
  readonly name = 'collateral';
  readonly weight = DEFAULT_WEIGHT;

  async calculate(ctx: ScoringContext): Promise<FactorScore> {
    try {
      const weights = await getRiskWeights();
      const w = weights.collateral ?? DEFAULT_WEIGHT;
      const collateral = await repo.findBestCollateral(ctx.invoice.id, ctx.invoice.supplier_id);
      const raw = calculateCollateralRaw(collateral?.collateral_type ?? 'none');
      return {
        name: this.name,
        rawScore: raw,
        weightedScore: raw * w,
      };
    } catch (err) {
      logger.warn('CollateralScorer failed, returning zero', {
        component: 'risk-engine',
        invoiceId: ctx.invoiceId,
        errorMessage: err instanceof Error ? err.message : 'Unknown',
      });
      return { name: this.name, rawScore: 0, weightedScore: 0 };
    }
  }
}

/** @internal exported for unit testing */
export function calculateCollateralRaw(type: string): number {
  return COLLATERAL_SCORES[type] ?? 0;
}
