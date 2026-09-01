import { v4 as uuidv4 } from 'uuid';
import type { Queue } from 'bullmq';
import type { PoolClient } from 'pg';
import { BusinessRuleError, NotFoundError } from '../../shared/errors';
import { pool, beginWithRls } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { enqueueWithContext } from '../../shared/workers/queue-helpers';
import * as repo from './facilities.repository';
import { FacilityStatus, DrawdownStatus, FacilityErrorCode } from './facilities.types';
import type {
  BankFacility,
  RepaymentCalculation,
  FacilityDashboard,
  FacilityDashboardItem,
  FacilityDetail,
  FacilityDetailDrawdown,
  FacilityDetailRepayment,
} from './facilities.types';
import type { DrawdownDetailRow, RepaymentDetailRow } from './facilities.repository';

// =========================================================================
// Constants
// =========================================================================

const RATE_PRECISION = 1_000_000_000n;
const DAYS_PER_YEAR = 365n;
const UTILISATION_WARNING = 80;
const UTILISATION_CRITICAL = 90;
const MATURITY_ALERT_DAYS = 5;

// =========================================================================
// Queue references
// =========================================================================

let notificationQueue: Queue | null = null;

/** Set queue for notifications. */
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

// =========================================================================
// Pure calculation functions (exported for unit testing)
// =========================================================================

/**
 * Calculate daily interest using integer arithmetic.
 * daily_interest = principal × (annual_rate / 365)
 * Rate is a decimal string (e.g. "0.18" = 18%).
 */
export function calculateDailyInterest(principal: string, annualRate: string): string {
  const p = BigInt(principal);
  if (p === 0n) return '0';

  const rateScaled = parseRateToScaled(annualRate);
  const daily = (p * rateScaled) / (DAYS_PER_YEAR * RATE_PRECISION);
  return daily.toString();
}

/**
 * Calculate utilisation percentage.
 */
export function calculateUtilisation(drawnAmount: string, totalLimit: string): number {
  const drawn = BigInt(drawnAmount);
  const limit = BigInt(totalLimit);
  if (limit === 0n) return 0;
  return Number((drawn * 10000n) / limit) / 100;
}

// =========================================================================
// getActiveFacilities
// =========================================================================

/**
 * Return all active bank facilities.
 */
export async function getActiveFacilities(): Promise<BankFacility[]> {
  return repo.getActiveFacilities();
}

// =========================================================================
// getFacilityDetail
// =========================================================================

/**
 * Return a single facility with its drawdowns and repayments.
 * Throws NotFoundError if the facility does not exist.
 */
export async function getFacilityDetail(facilityId: string): Promise<FacilityDetail> {
  const facility = await repo.getFacilityById(facilityId);
  if (!facility) {
    throw new NotFoundError('Facility', facilityId);
  }

  const [aggregates, drawdowns, repayments] = await Promise.all([
    repo.getFacilityAggregates(facilityId),
    repo.getDrawdownsForFacility(facilityId),
    repo.getRepaymentsForFacility(facilityId),
  ]);

  return {
    id: facility.id,
    bankName: facility.bank_name,
    totalLimit: facility.total_limit,
    drawnAmount: facility.drawn_amount,
    availableAmount: facility.available_amount,
    utilisationPct: calculateUtilisation(facility.drawn_amount, facility.total_limit),
    interestRate: facility.annual_rate,
    interestAccrued: aggregates.interest_accrued,
    defaultedExposure: aggregates.defaulted_exposure,
    maturityDate: facility.maturity_date,
    status: facility.status,
    createdAt: facility.created_at,
    drawdowns: drawdowns.map(toDrawdown),
    repayments: repayments.map(toRepayment),
  };
}

function toDrawdown(d: DrawdownDetailRow): FacilityDetailDrawdown {
  return {
    id: d.id,
    amount: d.principal,
    invoiceRef: d.invoice_number ?? d.id.slice(0, 8).toUpperCase(),
    drawnAt: d.created_at,
  };
}

function toRepayment(r: RepaymentDetailRow): FacilityDetailRepayment {
  return {
    id: r.id,
    amount: r.total_amount,
    paidAt: r.repaid_at,
    reference: `RP-${r.id.slice(0, 8).toUpperCase()}`,
  };
}

// =========================================================================
// createDrawdown
// =========================================================================

/**
 * Create a drawdown against a facility for an invoice.
 */
export async function createDrawdown(
  facilityId: string,
  invoiceId: string,
  principal: string,
  bankFees: string,
  invoiceDueDate: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ipAddress: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userAgent: string,
): Promise<{
  drawdownId: string;
  facilityId: string;
  invoiceId: string;
  principal: string;
}> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    const fac = await loadDrawdownFacility(client, facilityId, invoiceDueDate, principal);

    const drawdownId = await insertDrawdownTxn(
      client,
      fac,
      facilityId,
      invoiceId,
      principal,
      bankFees,
      userId,
    );

    await client.query('COMMIT');
    logDrawdown(facilityId, drawdownId, userId);

    return { drawdownId, facilityId, invoiceId, principal };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Load and validate a facility for drawdown eligibility.
 */
async function loadDrawdownFacility(
  client: PoolClient,
  facilityId: string,
  invoiceDueDate: string,
  principal: string,
): Promise<BankFacility> {
  const facility = await repo.getFacilityByIdWithClient(client, facilityId);
  validateFacilityForDrawdown(facility, facilityId);
  const fac = facility!;
  validateMaturity(fac, invoiceDueDate);
  validateAvailableAmount(fac, principal);
  return fac;
}

/**
 * Insert drawdown record, update drawn amount, and handle utilisation.
 * Must be called inside an active transaction.
 */
async function insertDrawdownTxn(
  client: PoolClient,
  fac: BankFacility,
  facilityId: string,
  invoiceId: string,
  principal: string,
  bankFees: string,
  userId: string,
): Promise<string> {
  const drawdownId = uuidv4();
  await repo.createDrawdownWithClient(client, {
    id: drawdownId,
    facilityId,
    invoiceId,
    principal,
    bankFees,
  });

  const newDrawn = (BigInt(fac.drawn_amount) + BigInt(principal)).toString();
  await repo.updateDrawnAmountWithClient(client, facilityId, newDrawn);

  const utilisation = calculateUtilisation(newDrawn, fac.total_limit);
  await handleUtilisationThresholds(client, facilityId, utilisation);

  await repo.createAuditEntry(
    client,
    userId,
    'DRAWDOWN_CREATED',
    'facility_drawdowns',
    drawdownId,
    null,
    { facilityId, invoiceId, principal, bankFees },
  );

  return drawdownId;
}

// =========================================================================
// processRepayment
// =========================================================================

/**
 * Process a repayment for a drawdown (atomic).
 */
export async function processRepayment(
  facilityId: string,
  drawdownId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ipAddress: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userAgent: string,
): Promise<RepaymentCalculation> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    const facility = await loadFacilityOrThrow(client, facilityId);
    const drawdown = await loadRepayableDrawdown(client, drawdownId);

    const result = await recordRepaymentTxn(
      client,
      facility,
      drawdown,
      facilityId,
      drawdownId,
      userId,
    );

    await client.query('COMMIT');
    logRepayment(facilityId, drawdownId, userId);

    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Load facility within transaction, throwing NotFoundError if missing.
 */
async function loadFacilityOrThrow(client: PoolClient, facilityId: string): Promise<BankFacility> {
  const facility = await repo.getFacilityByIdWithClient(client, facilityId);
  if (!facility) {
    throw new NotFoundError('Facility', facilityId);
  }
  return facility;
}

/**
 * Load drawdown and guard it has not already been repaid.
 */
async function loadRepayableDrawdown(
  client: PoolClient,
  drawdownId: string,
): Promise<{ principal: string; accrued_interest: string; bank_fees: string; status: string }> {
  const drawdown = await repo.getDrawdownByIdWithClient(client, drawdownId);
  if (!drawdown) {
    throw new NotFoundError('Drawdown', drawdownId);
  }
  if (drawdown.status === (DrawdownStatus.REPAID as string)) {
    throw new BusinessRuleError(
      FacilityErrorCode.DRAWDOWN_ALREADY_REPAID,
      'Drawdown has already been repaid',
    );
  }
  return drawdown;
}

/**
 * Create repayment record, mark drawdown repaid, and reduce drawn amount.
 * Must be called inside an active transaction.
 */
async function recordRepaymentTxn(
  client: PoolClient,
  facility: BankFacility,
  drawdown: { principal: string; accrued_interest: string; bank_fees: string },
  facilityId: string,
  drawdownId: string,
  userId: string,
): Promise<RepaymentCalculation> {
  const totalRepayment = calculateTotal(drawdown);
  const repaymentId = uuidv4();

  await repo.createRepaymentWithClient(client, {
    id: repaymentId,
    drawdownId,
    facilityId,
    principal: drawdown.principal,
    interest: drawdown.accrued_interest,
    bankFees: drawdown.bank_fees,
    totalAmount: totalRepayment,
  });

  await repo.updateDrawdownStatusWithClient(client, drawdownId, DrawdownStatus.REPAID);

  const newDrawn = (BigInt(facility.drawn_amount) - BigInt(drawdown.principal)).toString();
  await repo.updateDrawnAmountWithClient(client, facilityId, newDrawn);

  await repo.createAuditEntry(
    client,
    userId,
    'REPAYMENT_RECORDED',
    'facility_repayments',
    repaymentId,
    null,
    { facilityId, drawdownId, totalRepayment },
  );

  return {
    drawdownId,
    principal: drawdown.principal,
    accruedInterest: drawdown.accrued_interest,
    bankFees: drawdown.bank_fees,
    totalRepayment,
  };
}

// =========================================================================
// accrueInterest (Bull cron — midnight Africa/Nairobi)
// =========================================================================

/**
 * Accrue daily interest for all active drawdowns.
 * Recovers missed accruals from last_accrued_date.
 */
export async function accrueInterest(todayStr: string): Promise<void> {
  const drawdowns = await repo.getActiveDrawdowns();

  for (const dd of drawdowns) {
    await accrueForDrawdown(dd, todayStr);
  }
}

// =========================================================================
// checkUtilisationAlerts
// =========================================================================

/**
 * Check facility utilisation and send alerts.
 */
export async function checkUtilisationAlerts(): Promise<void> {
  const facilities = await repo.getActiveFacilities();

  for (const fac of facilities) {
    const util = calculateUtilisation(fac.drawn_amount, fac.total_limit);
    await sendUtilisationAlert(fac, util);
  }
}

// =========================================================================
// checkMaturityAlerts
// =========================================================================

/**
 * Check for facilities nearing maturity and notify.
 */
export async function checkMaturityAlerts(): Promise<void> {
  const facilities = await repo.getFacilitiesNearMaturity(MATURITY_ALERT_DAYS);

  for (const fac of facilities) {
    await queueMaturityAlert(fac);
  }
}

// =========================================================================
// getDashboard
// =========================================================================

/**
 * Build the facility dashboard for finance_manager / management.
 */
export async function getDashboard(): Promise<FacilityDashboard> {
  const facilities = await repo.getActiveFacilities();
  const items = await buildDashboardItems(facilities);

  let totalLimit = 0n;
  let totalDrawn = 0n;

  for (const fac of facilities) {
    totalLimit += BigInt(fac.total_limit);
    totalDrawn += BigInt(fac.drawn_amount);
  }

  return buildDashboardSummary(facilities.length, totalLimit, totalDrawn, items);
}

/**
 * Build a dashboard item for each facility, including active drawdown count.
 */
async function buildDashboardItems(facilities: BankFacility[]): Promise<FacilityDashboardItem[]> {
  const items: FacilityDashboardItem[] = [];

  for (const fac of facilities) {
    const count = await repo.getActiveDrawdownCount(fac.id);
    items.push({
      id: fac.id,
      bankName: fac.bank_name,
      totalLimit: fac.total_limit,
      drawnAmount: fac.drawn_amount,
      availableAmount: fac.available_amount,
      utilisationPercent: calculateUtilisation(fac.drawn_amount, fac.total_limit),
      annualRate: fac.annual_rate,
      maturityDate: fac.maturity_date,
      status: fac.status,
      activeDrawdowns: count,
    });
  }

  return items;
}

/**
 * Assemble the final dashboard summary from totals and items.
 */
function buildDashboardSummary(
  totalFacilities: number,
  totalLimit: bigint,
  totalDrawn: bigint,
  facilities: FacilityDashboardItem[],
): FacilityDashboard {
  const totalAvailable = totalLimit - totalDrawn;
  const overallUtil = totalLimit === 0n ? 0 : Number((totalDrawn * 10000n) / totalLimit) / 100;

  return {
    totalFacilities,
    totalLimit: totalLimit.toString(),
    totalDrawn: totalDrawn.toString(),
    totalAvailable: totalAvailable.toString(),
    overallUtilisation: overallUtil,
    facilities,
  };
}

// =========================================================================
// Private helpers
// =========================================================================

function parseRateToScaled(rateStr: string): bigint {
  const parts = rateStr.split('.');
  const intPart = parts[0] ?? '0';
  const decPart = (parts[1] ?? '').padEnd(9, '0').slice(0, 9);
  return BigInt(intPart) * RATE_PRECISION + BigInt(decPart);
}

function validateFacilityForDrawdown(facility: BankFacility | null, facilityId: string): void {
  if (!facility) {
    throw new NotFoundError('Facility', facilityId);
  }
  if (facility.status === (FacilityStatus.SUSPENDED as string)) {
    throw new BusinessRuleError(
      FacilityErrorCode.FACILITY_SUSPENDED,
      'Facility is suspended — no new drawdowns allowed',
    );
  }
  if (facility.status === (FacilityStatus.MATURED as string)) {
    throw new BusinessRuleError(FacilityErrorCode.FACILITY_MATURED, 'Facility has matured');
  }
  if (facility.status === (FacilityStatus.CLOSED as string)) {
    throw new BusinessRuleError(FacilityErrorCode.FACILITY_CLOSED, 'Facility is closed');
  }
}

function validateMaturity(facility: BankFacility, invoiceDueDate: string): void {
  const facMaturity = new Date(facility.maturity_date);
  const invoiceDue = new Date(invoiceDueDate);
  if (facMaturity < invoiceDue) {
    throw new BusinessRuleError(
      FacilityErrorCode.MATURITY_MISMATCH,
      'Facility maturity is before invoice due date',
    );
  }
}

function validateAvailableAmount(facility: BankFacility, principal: string): void {
  if (BigInt(principal) > BigInt(facility.available_amount)) {
    throw new BusinessRuleError(
      FacilityErrorCode.INSUFFICIENT_AVAILABLE,
      'Principal exceeds available facility amount',
    );
  }
}

function calculateTotal(drawdown: {
  principal: string;
  accrued_interest: string;
  bank_fees: string;
}): string {
  return (
    BigInt(drawdown.principal) +
    BigInt(drawdown.accrued_interest) +
    BigInt(drawdown.bank_fees)
  ).toString();
}

async function handleUtilisationThresholds(
  client: PoolClient,
  facilityId: string,
  utilisation: number,
): Promise<void> {
  if (utilisation >= UTILISATION_CRITICAL) {
    await repo.updateFacilityStatusWithClient(client, facilityId, FacilityStatus.SUSPENDED);
    await queueUtilisationAlert(facilityId, utilisation, 'critical');
  } else if (utilisation >= UTILISATION_WARNING) {
    await queueUtilisationAlert(facilityId, utilisation, 'warning');
  }
}

async function queueUtilisationAlert(
  facilityId: string,
  utilisationPercent: number,
  alertLevel: 'warning' | 'critical',
): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'facilities',
      facilityId,
    });
    return;
  }

  const notifyRoles =
    alertLevel === 'critical' ? ['finance_manager', 'management'] : ['finance_manager'];

  await enqueueWithContext(
    notificationQueue,
    'facility-utilisation-alert',
    {
      facilityId,
      utilisationPercent,
      alertLevel,
      notifyRoles,
    },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );
}

async function sendUtilisationAlert(facility: BankFacility, utilisation: number): Promise<void> {
  if (utilisation >= UTILISATION_CRITICAL) {
    await repo.updateFacilityStatus(facility.id, FacilityStatus.SUSPENDED);
    await queueUtilisationAlert(facility.id, utilisation, 'critical');
  } else if (utilisation >= UTILISATION_WARNING) {
    await queueUtilisationAlert(facility.id, utilisation, 'warning');
  }
}

async function queueMaturityAlert(facility: BankFacility): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'facilities',
      facilityId: facility.id,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'facility-maturity-alert',
    {
      facilityId: facility.id,
      bankName: facility.bank_name,
      maturityDate: facility.maturity_date,
      notifyRoles: ['finance_manager'],
    },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );
}

async function accrueForDrawdown(
  dd: { id: string; facility_id: string; principal: string; last_accrued_date: string },
  todayStr: string,
): Promise<void> {
  const lastAccrued = new Date(dd.last_accrued_date);
  const today = new Date(todayStr);

  if (lastAccrued >= today) return;

  const facility = await repo.getFacilityById(dd.facility_id);
  if (!facility) return;

  const dailyInterest = calculateDailyInterest(dd.principal, facility.annual_rate);
  await applyAccrualTxn(dd, dailyInterest, lastAccrued, today, todayStr);
}

/**
 * Apply daily interest accruals inside a transaction.
 */
async function applyAccrualTxn(
  dd: { id: string; facility_id: string },
  dailyInterest: string,
  lastAccrued: Date,
  today: Date,
  todayStr: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    await accrueEachDay(client, dd.id, dailyInterest, lastAccrued, today);

    await repo.createAuditEntry(
      client,
      null,
      'INTEREST_ACCRUED',
      'facility_drawdowns',
      dd.id,
      null,
      { facilityId: dd.facility_id, dailyInterest, accrualDate: todayStr },
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Interest accrual failed', {
      component: 'facilities',
      drawdownId: dd.id,
      errorMessage: err instanceof Error ? err.message : 'Unknown',
    });
  } finally {
    client.release();
  }
}

/**
 * Walk each day from lastAccrued to today and insert daily interest.
 */
async function accrueEachDay(
  client: PoolClient,
  drawdownId: string,
  dailyInterest: string,
  lastAccrued: Date,
  today: Date,
): Promise<void> {
  const cursor = new Date(lastAccrued);
  while (cursor < today) {
    cursor.setDate(cursor.getDate() + 1);
    const dateStr = cursor.toISOString().split('T')[0];
    await repo.accrueDailyInterestWithClient(client, drawdownId, dailyInterest, dateStr);
  }
}

// =========================================================================
// Logging
// =========================================================================

function logDrawdown(facilityId: string, drawdownId: string, userId: string): void {
  logger.audit('DRAWDOWN_CREATED', {
    component: 'facilities',
    facilityId,
    drawdownId,
    userId,
  });
}

function logRepayment(facilityId: string, drawdownId: string, userId: string): void {
  logger.audit('REPAYMENT_RECORDED', {
    component: 'facilities',
    facilityId,
    drawdownId,
    userId,
  });
}
