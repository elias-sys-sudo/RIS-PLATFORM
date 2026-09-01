import { Queue } from 'bullmq';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { pool, beginWithRls } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { enqueueWithContext } from '../../shared/workers/queue-helpers';
import * as repo from './pricing.repository';
import { findSupplierByUserId } from '../invoices/invoices.repository';
import { PricingErrorCode } from './pricing.types';
import type {
  PricingCalculationInput,
  PricingCalculationResult,
  PricingResult,
  FeeBreakdown,
  PricingDisputePayload,
  DisputeResponse,
} from './pricing.types';

// =========================================================================
// Constants
// =========================================================================

/** Precision multiplier for BigInt rate arithmetic (1e8 = 8 decimal places). */
const PRECISION = 100_000_000n;
const DAYS_PER_YEAR = 365n;

// =========================================================================
// Queue references
// =========================================================================

let notificationQueue: Queue | null = null;
let approvalsQueue: Queue | null = null;

/** Set queue for notifications. */
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

/** Set queue for approvals processing. */
export function setApprovalsQueue(queue: Queue): void {
  approvalsQueue = queue;
}

// =========================================================================
// Main pricing entry point
// =========================================================================

/**
 * Price a scored invoice: calculate discount, persist, audit log.
 * Wraps all writes in a database transaction.
 */
export async function priceInvoice(invoiceId: string): Promise<PricingResult> {
  const invoice = await fetchAndValidateInvoice(invoiceId);
  const riskScore = await fetchAndValidateRiskScore(invoiceId);
  const facility = await fetchActiveFacility();
  const buyerMargin = await fetchBuyerMargin(invoice.buyer_id);

  const bankCostRate = parseFloat(facility.interest_rate_annual);
  const riskPremiumRate = parseFloat(riskScore.risk_premium_rate);
  const risMarginRate = parseFloat(buyerMargin.ris_margin_rate);
  const maxAdvancePct = parseFloat(riskScore.max_advance_pct);

  const calcResult = calculatePricing({
    faceValue: BigInt(invoice.face_value),
    tenorDays: invoice.tenor_days,
    maxAdvancePct,
    riskPremiumRate,
    bankCostRate,
    risMarginRate,
  });

  const totalAnnualRate = bankCostRate + riskPremiumRate + risMarginRate;
  validateRateCap(totalAnnualRate);

  await persistPricing(invoiceId, riskScore.id, calcResult, bankCostRate, risMarginRate);

  const feeBreakdown = buildFeeBreakdown({
    faceValue: BigInt(invoice.face_value),
    advanceAmount: calcResult.advanceAmount,
    discountAmount: calcResult.discountAmount,
    netPaymentToSupplier: calcResult.netPaymentToSupplier,
    maxAdvancePct,
    totalDiscountRate: calcResult.totalDiscountRate,
    bankCostRate,
    riskPremiumRate,
    risMarginRate,
    dueDate: invoice.due_date,
    tenorDays: invoice.tenor_days,
  });

  logPricing(invoiceId, calcResult);
  await queuePricingReadyNotification(invoiceId);

  return {
    invoiceId,
    faceValue: invoice.face_value,
    advanceAmount: calcResult.advanceAmount.toString(),
    discountAmount: calcResult.discountAmount.toString(),
    netPaymentToSupplier: calcResult.netPaymentToSupplier.toString(),
    bankCostRate,
    riskPremiumRate,
    risMarginRate,
    totalDiscountRate: calcResult.totalDiscountRate,
    bankCostAmount: calcResult.bankCostAmount.toString(),
    risNetProfit: calcResult.risNetProfit.toString(),
    feeBreakdown,
  };
}

// =========================================================================
// Read endpoint
// =========================================================================

/**
 * Retrieve pricing details for an already-priced invoice.
 */
export async function getPricing(invoiceId: string): Promise<PricingResult> {
  const row = await repo.getPricingDetails(invoiceId);
  if (!row) {
    throw new NotFoundError('Pricing', invoiceId);
  }

  const faceValue = BigInt(row.face_value);
  const advanceAmount = BigInt(row.advance_amount);
  const discountAmount = BigInt(row.discount_amount);
  const netPayment = BigInt(row.net_payment_to_supplier);
  const bankCostRate = parseFloat(row.bank_cost_rate);
  const riskPremiumRate = parseFloat(row.risk_premium_rate);
  const risMarginRate = parseFloat(row.ris_margin_rate);
  const maxAdvancePct = parseFloat(row.max_advance_pct);
  const totalDiscountRate = parseFloat(row.total_discount_rate);

  const bankCostRateScaled = (toScaled(bankCostRate) * BigInt(row.tenor_days)) / DAYS_PER_YEAR;
  const bankCostAmount = (advanceAmount * bankCostRateScaled) / PRECISION;
  const risNetProfit = discountAmount - bankCostAmount;

  const feeBreakdown = buildFeeBreakdown({
    faceValue,
    advanceAmount,
    discountAmount,
    netPaymentToSupplier: netPayment,
    maxAdvancePct,
    totalDiscountRate,
    bankCostRate,
    riskPremiumRate,
    risMarginRate,
    dueDate: row.due_date,
    tenorDays: row.tenor_days,
  });

  return {
    invoiceId: row.invoice_id,
    faceValue: row.face_value,
    advanceAmount: row.advance_amount,
    discountAmount: row.discount_amount,
    netPaymentToSupplier: row.net_payment_to_supplier,
    bankCostRate,
    riskPremiumRate,
    risMarginRate,
    totalDiscountRate,
    bankCostAmount: bankCostAmount.toString(),
    risNetProfit: risNetProfit.toString(),
    feeBreakdown,
  };
}

// =========================================================================
// Supplier pricing acceptance / rejection
// =========================================================================

/**
 * Supplier accepts the pricing terms for their invoice.
 */
export async function acceptPricing(
  invoiceId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const supplierId = await resolveSupplier(userId);
  const invoice = await fetchAndValidatePricingAcceptance(invoiceId, supplierId);
  if (invoice.pricing_accepted_at !== null) {
    throw new BusinessRuleError(PricingErrorCode.ALREADY_ACCEPTED, 'Pricing already accepted');
  }

  await persistAcceptance(invoiceId, userId, ipAddress, userAgent);
  await queueForApproval(invoiceId);
  logger.audit('PRICING_ACCEPTED', { component: 'pricing', invoiceId });
}

/**
 * Supplier rejects the pricing terms for their invoice.
 */
export async function rejectPricing(
  invoiceId: string,
  userId: string,
  reason: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const supplierId = await resolveSupplier(userId);
  const invoice = await fetchAndValidatePricingAcceptance(invoiceId, supplierId);
  if (invoice.pricing_rejected_at !== null) {
    throw new BusinessRuleError(PricingErrorCode.ALREADY_REJECTED, 'Pricing already rejected');
  }

  await persistRejection(invoiceId, userId, reason, ipAddress, userAgent);
  logger.audit('PRICING_REJECTED', { component: 'pricing', invoiceId, status: 'rejected' });
}

/**
 * Supplier raises a pricing dispute (keeps invoice eligible for funding).
 * Creates a pricing_disputes record and stamps pricing_disputed_at on the invoice.
 * SLA deadline = submitted_at + 24 hours.
 */
export async function disputePricing(
  invoiceId: string,
  userId: string,
  payload: PricingDisputePayload,
  ipAddress: string,
  userAgent: string,
): Promise<DisputeResponse> {
  const supplierId = await resolveSupplier(userId);
  const invoice = await fetchAndValidatePricingAcceptance(invoiceId, supplierId);
  if (invoice.pricing_accepted_at !== null) {
    throw new BusinessRuleError(PricingErrorCode.ALREADY_ACCEPTED, 'Pricing already accepted');
  }
  if (invoice.pricing_rejected_at !== null) {
    throw new BusinessRuleError(PricingErrorCode.ALREADY_REJECTED, 'Pricing already rejected');
  }
  if (invoice.pricing_disputed_at !== null) {
    throw new BusinessRuleError(
      PricingErrorCode.ALREADY_DISPUTED,
      'Pricing dispute already submitted',
    );
  }

  const dispute = await persistDispute(invoiceId, userId, payload, ipAddress, userAgent);
  logger.audit('PRICING_DISPUTED', { component: 'pricing', invoiceId });
  return dispute;
}

async function persistDispute(
  invoiceId: string,
  userId: string,
  payload: PricingDisputePayload,
  ipAddress: string,
  userAgent: string,
): Promise<DisputeResponse> {
  const slaDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.setDisputedAtWithClient(client, invoiceId);
    const row = await repo.createPricingDisputeWithClient(
      client,
      invoiceId,
      userId,
      payload.reason,
      payload.proposedRate ?? null,
      payload.proposedAdvancePct ?? null,
      payload.notes ?? null,
      slaDeadline,
    );
    await repo.createAuditEntry(
      client,
      userId,
      'PRICING_DISPUTED',
      'pricing_disputes',
      row.id,
      null,
      {
        invoiceId,
        reason: payload.reason,
        proposedRate: payload.proposedRate ?? null,
        slaDeadline: slaDeadline.toISOString(),
      },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
    return {
      id: row.id,
      invoiceId: row.invoice_id,
      reason: row.reason,
      proposedRate: row.proposed_rate,
      proposedAdvancePct: row.proposed_advance_pct,
      notes: row.notes,
      submittedAt: row.submitted_at,
      slaDeadline: row.sla_deadline,
      status: row.status,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function resolveSupplier(userId: string): Promise<string> {
  const supplier = await findSupplierByUserId(userId);
  if (!supplier) {
    throw new ForbiddenError();
  }
  return supplier.id;
}

async function fetchAndValidatePricingAcceptance(
  invoiceId: string,
  supplierId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof repo.getInvoicePricingStatus>>>> {
  const invoice = await repo.getInvoicePricingStatus(invoiceId, supplierId);
  if (!invoice) {
    throw new NotFoundError('Invoice', invoiceId);
  }
  if (invoice.advance_amount === null) {
    throw new BusinessRuleError(PricingErrorCode.NOT_PRICED, 'Invoice has not been priced yet');
  }
  return invoice;
}

async function persistAcceptance(
  invoiceId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.acceptPricingWithClient(client, invoiceId, userId);
    await repo.createAuditEntry(
      client,
      userId,
      'PRICING_ACCEPTED',
      'invoices',
      invoiceId,
      { pricingAcceptedAt: null },
      { pricingAcceptedAt: 'now' },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function persistRejection(
  invoiceId: string,
  userId: string,
  reason: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.rejectPricingWithClient(client, invoiceId, reason);
    await repo.updateInvoiceStatusWithClient(client, invoiceId, 'rejected', 'priced');
    await repo.createAuditEntry(
      client,
      userId,
      'PRICING_REJECTED',
      'invoices',
      invoiceId,
      { pricingRejectedAt: null, status: 'priced' },
      { pricingRejectedAt: 'now', reason, status: 'rejected' },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================================
// Pure calculation (BigInt arithmetic — no floating point)
// =========================================================================

/**
 * Convert a decimal rate to a scaled BigInt (×1e8).
 */
function toScaled(rate: number): bigint {
  return BigInt(Math.round(rate * Number(PRECISION)));
}

/**
 * Calculate all pricing amounts using integer arithmetic only.
 * Formula: Total Discount Rate = (Bank + Risk + RIS) × (Tenor / 365)
 */
export function calculatePricing(input: PricingCalculationInput): PricingCalculationResult {
  const { faceValue, tenorDays, maxAdvancePct, riskPremiumRate, bankCostRate, risMarginRate } =
    input;

  const tenor = BigInt(tenorDays);
  const bankScaled = toScaled(bankCostRate);
  const riskScaled = toScaled(riskPremiumRate);
  const risScaled = toScaled(risMarginRate);
  const advPctScaled = toScaled(maxAdvancePct);

  const totalAnnualScaled = bankScaled + riskScaled + risScaled;
  const discountRateScaled = (totalAnnualScaled * tenor) / DAYS_PER_YEAR;

  const advanceAmount = (faceValue * advPctScaled) / PRECISION;
  const discountAmount = (faceValue * discountRateScaled) / PRECISION;
  const netPaymentToSupplier = advanceAmount - discountAmount;

  const bankCostRateScaled = (bankScaled * tenor) / DAYS_PER_YEAR;
  const bankCostAmount = (advanceAmount * bankCostRateScaled) / PRECISION;
  const risNetProfit = discountAmount - bankCostAmount;

  const totalDiscountRate = Number(discountRateScaled) / Number(PRECISION);

  return {
    advanceAmount,
    discountAmount,
    netPaymentToSupplier,
    totalDiscountRate,
    bankCostAmount,
    risNetProfit,
  };
}

// =========================================================================
// Fee breakdown builder
// =========================================================================

interface FeeBreakdownInput {
  faceValue: bigint;
  advanceAmount: bigint;
  discountAmount: bigint;
  netPaymentToSupplier: bigint;
  maxAdvancePct: number;
  totalDiscountRate: number;
  bankCostRate: number;
  riskPremiumRate: number;
  risMarginRate: number;
  dueDate: string;
  tenorDays: number;
}

/**
 * Build a transparent fee breakdown for supplier display.
 */
export function buildFeeBreakdown(input: FeeBreakdownInput): FeeBreakdown {
  const tenor = BigInt(input.tenorDays);

  const bankComponent =
    (input.faceValue * toScaled(input.bankCostRate) * tenor) / (DAYS_PER_YEAR * PRECISION);

  const riskComponent =
    (input.faceValue * toScaled(input.riskPremiumRate) * tenor) / (DAYS_PER_YEAR * PRECISION);

  const risComponent =
    (input.faceValue * toScaled(input.risMarginRate) * tenor) / (DAYS_PER_YEAR * PRECISION);

  return {
    faceValue: input.faceValue.toString(),
    advancePercentage: (input.maxAdvancePct * 100).toFixed(2),
    advanceAmount: input.advanceAmount.toString(),
    discountPercentage: (input.totalDiscountRate * 100).toFixed(4),
    discountAmount: input.discountAmount.toString(),
    netPaymentToSupplier: input.netPaymentToSupplier.toString(),
    bankCostComponent: bankComponent.toString(),
    riskPremiumComponent: riskComponent.toString(),
    risMarginComponent: risComponent.toString(),
    expectedCollectionDate: input.dueDate,
  };
}

// =========================================================================
// Rate cap validation
// =========================================================================

/** Maximum annual discount rate (15%). */
const MAX_ANNUAL_RATE = 0.15;

/**
 * Validate that the total annual rate does not exceed the cap.
 */
export function validateRateCap(totalAnnualRate: number): void {
  if (totalAnnualRate > MAX_ANNUAL_RATE) {
    throw new BusinessRuleError(
      PricingErrorCode.RATE_CAP_EXCEEDED,
      `Total annual rate ${String(totalAnnualRate)} exceeds maximum ${String(MAX_ANNUAL_RATE)}`,
    );
  }
}

// =========================================================================
// Validation helpers
// =========================================================================

async function fetchAndValidateInvoice(
  invoiceId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof repo.getInvoiceForPricing>>>> {
  const invoice = await repo.getInvoiceForPricing(invoiceId);
  if (!invoice) {
    throw new NotFoundError('Invoice', invoiceId);
  }
  if (invoice.status !== 'scored') {
    throw new BusinessRuleError(
      PricingErrorCode.INVOICE_WRONG_STATUS,
      `Invoice status is '${invoice.status}', expected 'scored'`,
    );
  }
  return invoice;
}

async function fetchAndValidateRiskScore(
  invoiceId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof repo.getRiskScoreForPricing>>>> {
  const score = await repo.getRiskScoreForPricing(invoiceId);
  if (!score) {
    throw new NotFoundError('RiskScore', invoiceId);
  }
  if (score.bank_cost_rate !== null) {
    throw new BusinessRuleError(PricingErrorCode.ALREADY_PRICED, 'Invoice has already been priced');
  }
  return score;
}

async function fetchActiveFacility(): Promise<
  NonNullable<Awaited<ReturnType<typeof repo.getActiveFacility>>>
> {
  const facility = await repo.getActiveFacility();
  if (!facility) {
    throw new BusinessRuleError(
      PricingErrorCode.NO_ACTIVE_FACILITY,
      'No active bank facility available for drawdown',
    );
  }
  return facility;
}

async function fetchBuyerMargin(
  buyerId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof repo.getBuyerRisMargin>>>> {
  const margin = await repo.getBuyerRisMargin(buyerId);
  if (!margin) {
    throw new NotFoundError('Buyer', buyerId);
  }
  return margin;
}

// =========================================================================
// Persistence (transactional)
// =========================================================================

async function persistPricing(
  invoiceId: string,
  riskScoreId: string,
  calc: PricingCalculationResult,
  bankCostRate: number,
  risMarginRate: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    const pricingUpdate = {
      bank_cost_rate: bankCostRate,
      ris_margin_rate: risMarginRate,
      total_discount_rate: calc.totalDiscountRate,
      advance_amount: calc.advanceAmount.toString(),
      discount_amount: calc.discountAmount.toString(),
      net_payment_to_supplier: calc.netPaymentToSupplier.toString(),
    };

    await repo.updateRiskScoreWithPricing(client, riskScoreId, pricingUpdate);

    await repo.updateInvoiceWithPricing(client, invoiceId, {
      advance_amount: pricingUpdate.advance_amount,
      discount_amount: pricingUpdate.discount_amount,
      net_payment_to_supplier: pricingUpdate.net_payment_to_supplier,
    });

    await repo.updateInvoiceStatusWithClient(client, invoiceId, 'priced', 'scored');

    await repo.createAuditEntry(
      client,
      null,
      'INVOICE_PRICED',
      'risk_scores',
      invoiceId,
      { status: 'scored' },
      {
        status: 'priced',
        advanceAmount: calc.advanceAmount.toString(),
        discountAmount: calc.discountAmount.toString(),
        netPaymentToSupplier: calc.netPaymentToSupplier.toString(),
        bankCostRate,
        risMarginRate,
        totalDiscountRate: calc.totalDiscountRate,
      },
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================================
// Queue helpers
// =========================================================================

async function queuePricingReadyNotification(invoiceId: string): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', { component: 'pricing', invoiceId });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'pricing-ready',
    { invoiceId },
    { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}

async function queueForApproval(invoiceId: string): Promise<void> {
  if (!approvalsQueue) {
    logger.warn('Approvals queue not configured', { component: 'pricing', invoiceId });
    return;
  }
  await enqueueWithContext(
    approvalsQueue,
    'score-for-approval',
    { invoiceId },
    { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}

// =========================================================================
// Logging
// =========================================================================

function logPricing(invoiceId: string, calc: PricingCalculationResult): void {
  logger.audit('INVOICE_PRICED', {
    component: 'pricing',
    invoiceId,
    advanceAmount: calc.advanceAmount.toString(),
    discountAmount: calc.discountAmount.toString(),
    netPaymentToSupplier: calc.netPaymentToSupplier.toString(),
  });
}
