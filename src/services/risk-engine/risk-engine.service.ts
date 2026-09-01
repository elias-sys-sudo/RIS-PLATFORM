import { v4 as uuidv4 } from 'uuid';
import type { PoolClient } from 'pg';
import { Queue } from 'bullmq';
import { BusinessRuleError, NotFoundError } from '../../shared/errors';
import { beginWithRls } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { enqueueWithContext } from '../../shared/workers/queue-helpers';
import * as repo from './risk-engine.repository';
import { RiskRecommendation, RiskEngineErrorCode } from './risk-engine.types';
import type {
  IScoringFactor,
  ScoringContext,
  FactorScore,
  RiskScore,
  RiskScoreRecord,
} from './risk-engine.types';
import { BuyerCreditScorer } from './factors/buyer-credit-scorer';
import { TenorScorer } from './factors/tenor-scorer';
import { SupplierTrackRecordScorer } from './factors/supplier-track-record-scorer';
import { ConcentrationRiskScorer } from './factors/concentration-risk-scorer';
import { CollateralScorer } from './factors/collateral-scorer';
import { getRiskConfigNumber, getRiskWeights } from '../../shared/risk-config';

// =========================================================================
// Factor registry (Strategy pattern)
// =========================================================================

const scoringFactors: IScoringFactor[] = [
  new BuyerCreditScorer(),
  new TenorScorer(),
  new SupplierTrackRecordScorer(),
  new ConcentrationRiskScorer(),
  new CollateralScorer(),
];

// =========================================================================
// Queue references
// =========================================================================

let notificationQueue: Queue | null = null;
let pricingQueue: Queue | null = null;

/** Set queue for supplier notifications. */
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

/** Set queue for pricing + approval pipeline. */
export function setPricingQueue(queue: Queue): void {
  pricingQueue = queue;
}

// =========================================================================
// Main scoring entry point
// =========================================================================

/**
 * Score an invoice through all 5 risk factors.
 * Transitions status to 'scored' or 'rejected' based on result.
 */
export async function scoreInvoice(invoiceId: string): Promise<RiskScore> {
  const invoice = await fetchAndValidateInvoice(invoiceId);
  const buyer = await fetchBuyer(invoice.buyer_id);

  const weights = await getRiskWeights();
  const weightSum = Object.values(weights).reduce((sum, w) => sum + w, 0);
  if (Math.abs(weightSum - 1.0) > 0.001) {
    throw new BusinessRuleError(
      'RISK_WEIGHT_MISCONFIGURED',
      `Risk factor weights sum to ${String(weightSum)}, expected 1.0`,
    );
  }

  const ctx: ScoringContext = { invoiceId, invoice, buyer };
  const factors = await runAllFactors(ctx);

  const rawSum = factors.reduce((s, f) => s + f.weightedScore, 0);
  const finalScore = Math.round(rawSum);

  const recommendation = await determineRecommendation(finalScore);
  const maxAdvancePct = await determineMaxAdvance(finalScore);
  const riskPremiumRate = await determineRiskPremium(finalScore);

  // Wrap all DB writes in a transaction
  const client = await repo.getClient();
  const newStatus = recommendation === RiskRecommendation.REJECT ? 'rejected' : 'scored';

  try {
    await beginWithRls(client);

    await persistScoreWithClient(
      client,
      invoiceId,
      factors,
      finalScore,
      recommendation,
      maxAdvancePct,
      riskPremiumRate,
    );

    await repo.updateInvoiceStatusWithClient(client, invoiceId, newStatus, 'buyer_confirmed');

    await writeAuditLogWithClient(client, invoiceId, factors, finalScore, recommendation);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Queue operations outside transaction
  if (recommendation === RiskRecommendation.REJECT) {
    await queueNotification(invoiceId, 'invoice-rejected');
  } else {
    await queuePricing(invoiceId);
  }

  logger.audit('INVOICE_SCORED', {
    component: 'risk-engine',
    invoiceId,
    finalScore,
    recommendation,
  });

  return {
    invoiceId,
    factors,
    finalScore,
    recommendation,
    maxAdvancePct,
    riskPremiumRate,
  };
}

/**
 * Retrieve a risk score for an invoice (admin read).
 */
export async function getRiskScore(invoiceId: string): Promise<RiskScoreRecord> {
  const score = await repo.getRiskScoreByInvoiceId(invoiceId);
  if (!score) {
    throw new NotFoundError('RiskScore', invoiceId);
  }
  return score;
}

// =========================================================================
// Validation helpers
// =========================================================================

async function fetchAndValidateInvoice(
  invoiceId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof repo.findInvoiceForScoring>>>> {
  const invoice = await repo.findInvoiceForScoring(invoiceId);
  if (!invoice) {
    throw new NotFoundError('Invoice', invoiceId);
  }
  if (invoice.status !== 'buyer_confirmed') {
    throw new BusinessRuleError(
      RiskEngineErrorCode.INVOICE_WRONG_STATUS,
      `Invoice status is '${invoice.status}', expected 'buyer_confirmed'`,
    );
  }
  const existing = await repo.getRiskScoreByInvoiceId(invoiceId);
  if (existing) {
    throw new BusinessRuleError(
      RiskEngineErrorCode.ALREADY_SCORED,
      'Invoice has already been scored',
    );
  }
  return invoice;
}

async function fetchBuyer(buyerId: string) {
  const buyer = await repo.findBuyerForScoring(buyerId);
  if (!buyer) {
    throw new NotFoundError('Buyer', buyerId);
  }
  return buyer;
}

// =========================================================================
// Factor execution
// =========================================================================

async function runAllFactors(ctx: ScoringContext): Promise<FactorScore[]> {
  return Promise.all(scoringFactors.map((f) => f.calculate(ctx)));
}

// =========================================================================
// Threshold lookups
// =========================================================================

/**
 * Determine recommendation from score using configurable thresholds.
 * Defaults: ≥75 AUTO_APPROVE, 50-74 REFER_TO_MANAGER, <50 REJECT.
 */
export async function determineRecommendation(score: number): Promise<RiskRecommendation> {
  const autoThreshold = await getRiskConfigNumber('threshold_auto_approve');
  const referThreshold = await getRiskConfigNumber('threshold_refer_manager');
  if (score >= autoThreshold) return RiskRecommendation.AUTO_APPROVE;
  if (score >= referThreshold) return RiskRecommendation.REFER_TO_MANAGER;
  return RiskRecommendation.REJECT;
}

/**
 * Determine max advance % from score using configurable rates.
 * Defaults: ≥75=95%, 60-74=90%, 50-59=85%, <50=0%.
 */
export async function determineMaxAdvance(score: number): Promise<number> {
  const autoThreshold = await getRiskConfigNumber('threshold_auto_approve');
  const referThreshold = await getRiskConfigNumber('threshold_refer_manager');
  const pctHigh = await getRiskConfigNumber('advance_pct_high');
  const pctMid = await getRiskConfigNumber('advance_pct_mid');
  const pctLow = await getRiskConfigNumber('advance_pct_low');
  if (score >= autoThreshold) return pctHigh;
  if (score >= 60) return pctMid;
  if (score >= referThreshold) return pctLow;
  return 0;
}

/**
 * Determine risk premium from score using configurable rates.
 * Defaults: ≥80=0%, 70-79=0.5%, 60-69=1%, 50-59=1.5%.
 */
export async function determineRiskPremium(score: number): Promise<number> {
  const p80 = await getRiskConfigNumber('premium_score_80_plus');
  const p70 = await getRiskConfigNumber('premium_score_70_79');
  const p60 = await getRiskConfigNumber('premium_score_60_69');
  const p50 = await getRiskConfigNumber('premium_score_50_59');
  if (score >= 80) return p80;
  if (score >= 70) return p70;
  if (score >= 60) return p60;
  if (score >= 50) return p50;
  return 0;
}

// =========================================================================
// Persistence
// =========================================================================

/**
 * Persist risk score within a transaction.
 */
async function persistScoreWithClient(
  client: PoolClient,
  invoiceId: string,
  factors: FactorScore[],
  finalScore: number,
  recommendation: RiskRecommendation,
  maxAdvancePct: number,
  riskPremiumRate: number,
): Promise<void> {
  const byName = (n: string) => factors.find((f) => f.name === n)?.weightedScore ?? 0;

  await repo.saveRiskScoreWithClient(client, {
    id: uuidv4(),
    invoice_id: invoiceId,
    buyer_credit_score: byName('buyer_credit'),
    tenor_score: byName('tenor'),
    track_record_score: byName('track_record'),
    concentration_score: byName('concentration'),
    collateral_score: byName('collateral'),
    final_score: finalScore,
    recommendation,
    max_advance_pct: maxAdvancePct,
    risk_premium_rate: riskPremiumRate,
    scored_by: 'SYSTEM',
  });
}

/**
 * Write audit log within a transaction.
 */
async function writeAuditLogWithClient(
  client: PoolClient,
  invoiceId: string,
  factors: FactorScore[],
  finalScore: number,
  recommendation: RiskRecommendation,
): Promise<void> {
  const factorMap: Record<string, number> = {};
  for (const f of factors) {
    factorMap[f.name] = f.weightedScore;
  }

  await repo.createAuditEntryWithClient(
    client,
    null,
    'INVOICE_SCORED',
    'risk_scores',
    invoiceId,
    { status: 'buyer_confirmed' },
    { factors: factorMap, finalScore, recommendation },
  );
}

// =========================================================================
// Invoice status transition & queuing
// =========================================================================

async function queueNotification(invoiceId: string, jobName: string): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'risk-engine',
      invoiceId,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    jobName,
    { invoiceId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );
}

async function queuePricing(invoiceId: string): Promise<void> {
  if (!pricingQueue) {
    logger.warn('Pricing queue not configured', {
      component: 'risk-engine',
      invoiceId,
    });
    return;
  }
  await enqueueWithContext(
    pricingQueue,
    'price-invoice',
    { invoiceId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );
}
