import type {
  IScoringFactor,
  ScoringContext,
  FactorScore,
  TrackRecordResult,
} from '../risk-engine.types';
import * as repo from '../risk-engine.repository';
import { getRiskWeights } from '../../../shared/risk-config';
import { logger } from '../../../shared/logger';

/** Default weight — used when config unavailable. */
const DEFAULT_WEIGHT = 0.2;

/**
 * Scores the supplier's historical track record.
 * Weight is loaded from risk_config table (key: weight_track_record).
 * Bands:
 *   any default ever            → 25
 *   first invoice (no history)  → 50
 *   1-3 invoices, on time       → 70
 *   4-10 invoices, >90% ≤95%   → 85
 *   4-10 invoices, >95%         → 100
 *   11+ invoices, >95%          → 100
 */
export class SupplierTrackRecordScorer implements IScoringFactor {
  readonly name = 'track_record';
  readonly weight = DEFAULT_WEIGHT;

  async calculate(ctx: ScoringContext): Promise<FactorScore> {
    try {
      const weights = await getRiskWeights();
      const w = weights.track_record ?? DEFAULT_WEIGHT;
      const record = await repo.getSupplierTrackRecord(ctx.invoice.supplier_id);
      const raw = calculateTrackRecordRaw(record);
      return {
        name: this.name,
        rawScore: raw,
        weightedScore: raw * w,
      };
    } catch (err) {
      logger.warn('SupplierTrackRecordScorer failed, returning zero', {
        component: 'risk-engine',
        invoiceId: ctx.invoiceId,
        errorMessage: err instanceof Error ? err.message : 'Unknown',
      });
      return { name: this.name, rawScore: 0, weightedScore: 0 };
    }
  }
}

/** @internal exported for unit testing */
export function calculateTrackRecordRaw(record: TrackRecordResult): number {
  if (record.has_defaults) return 25;
  if (record.invoice_count === 0) return 50;

  const pct = record.on_time_pct;

  if (record.invoice_count >= 11) {
    return pct > 95 ? 100 : 85;
  }

  if (record.invoice_count >= 4) {
    return pct > 95 ? 100 : pct > 90 ? 85 : 70;
  }

  // 1-3 invoices
  return pct > 90 ? 70 : 50;
}
