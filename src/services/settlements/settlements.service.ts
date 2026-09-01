// ============================================================
// settlements.service.ts — Settlement lifecycle + profit booking
// ============================================================

import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { Worker, type Job, type Queue } from 'bullmq';
import { pool } from '../../shared/database/pool';
import { beginWithRls } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { BusinessRuleError, NotFoundError } from '../../shared/errors';
import { enqueueWithContext, withJobContext } from '../../shared/workers/queue-helpers';
import * as repo from './settlements.repository';
import { SettlementStatus, SettlementErrorCode } from './settlements.types';
import type {
  SettlementRecord,
  EnrichedSettlement,
  SettlementSummary,
  DashboardResponse,
} from './settlements.types';

const MODULE = 'settlements';

// =========================================================================
// Idempotency
// =========================================================================

// Fixed namespace UUID used to derive deterministic settlement idempotency
// keys via UUIDv5. Same (invoiceId, collectionId) pair → same UUID, so a
// retried BullMQ job hits ON CONFLICT and replays the existing settlement
// rather than disbursing twice.
const SETTLEMENT_IDEMPOTENCY_NAMESPACE = 'ec7a4f8e-3a2b-4d1c-9f8b-2e5f1a3c7d9e';

export function deriveSettlementIdempotencyKey(invoiceId: string, collectionId: string): string {
  return uuidv5(`${invoiceId}:${collectionId}`, SETTLEMENT_IDEMPOTENCY_NAMESPACE);
}

// =========================================================================
// Queue setup
// =========================================================================

let notificationQueue: Queue | null = null;
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

// =========================================================================
// Status transition guard
// =========================================================================

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  [SettlementStatus.PENDING]: [SettlementStatus.FACILITY_REPAID],
  [SettlementStatus.FACILITY_REPAID]: [SettlementStatus.PROFIT_BOOKED],
  [SettlementStatus.PROFIT_BOOKED]: [SettlementStatus.CLOSED],
};

function assertTransition(current: string, next: string): void {
  const allowed = ALLOWED_TRANSITIONS[current];
  if (allowed === undefined || !allowed.includes(next)) {
    throw new BusinessRuleError(
      SettlementErrorCode.WRONG_STATUS,
      `Cannot transition settlement from '${current}' to '${next}'`,
    );
  }
}

// =========================================================================
// Initiate settlement — called when collection status = collected
// =========================================================================

export async function initiateSettlement(
  invoiceId: string,
  collectionId: string,
  buyerPaymentAmount: string,
  penaltyIncome: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
  idempotencyKey: string,
): Promise<SettlementRecord> {
  const replay = await repo.getSettlementByIdempotencyKey(idempotencyKey);
  if (replay) {
    logger.info('Settlement idempotency replay', {
      component: MODULE,
      settlementId: replay.id,
      invoiceId,
    });
    return replay;
  }
  const existing = await repo.getSettlementByInvoiceId(invoiceId);
  if (existing)
    throw new BusinessRuleError(
      SettlementErrorCode.ALREADY_EXISTS,
      'Settlement already exists for this invoice',
    );
  return runFreshInitiateSettlement(
    invoiceId,
    collectionId,
    buyerPaymentAmount,
    penaltyIncome,
    idempotencyKey,
    userId,
    ipAddress,
    userAgent,
  );
}

/**
 * Fresh-insert path for initiateSettlement: open the connection, run the
 * transaction, COMMIT and audit. Split out so initiateSettlement itself stays
 * inside the function-length budget (the replay/exists guards already cost
 * many lines before any transaction work begins).
 */
async function runFreshInitiateSettlement(
  invoiceId: string,
  collectionId: string,
  buyerPaymentAmount: string,
  penaltyIncome: string,
  idempotencyKey: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<SettlementRecord> {
  const drawdown = await findDrawdownForInvoice(invoiceId);
  const settlementId = uuidv4();
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    const settlement = await executeInitiateTxn(
      client,
      settlementId,
      invoiceId,
      collectionId,
      drawdown,
      buyerPaymentAmount,
      penaltyIncome,
      idempotencyKey,
      userId,
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
    logger.audit('SETTLEMENT_INITIATED', { component: MODULE, settlementId, invoiceId });
    return settlement;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction body for initiateSettlement. */
async function executeInitiateTxn(
  client: import('pg').PoolClient,
  settlementId: string,
  invoiceId: string,
  collectionId: string,
  drawdown: DrawdownRow | null,
  buyerPaymentAmount: string,
  penaltyIncome: string,
  idempotencyKey: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<SettlementRecord> {
  const settlement = await repo.createSettlementWithClient(
    client,
    settlementId,
    invoiceId,
    collectionId,
    drawdown?.id ?? null,
    buyerPaymentAmount,
    drawdown?.principal ?? '0',
    drawdown?.accrued_interest ?? '0',
    penaltyIncome,
    idempotencyKey,
  );

  await repo.createAuditEntryWithClient(
    client,
    userId,
    'SETTLEMENT_INITIATED',
    MODULE,
    settlementId,
    null,
    { invoiceId, status: SettlementStatus.PENDING },
    ipAddress,
    userAgent,
  );

  return settlement;
}

// =========================================================================
// Repay facility — updates settlement with actual repayment amounts
// =========================================================================

export async function repayFacility(
  settlementId: string,
  facilityRepaymentAmount: string,
  accruedInterest: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<SettlementRecord> {
  const settlement = await getSettlementOrThrow(settlementId);
  assertTransition(settlement.status, SettlementStatus.FACILITY_REPAID);

  const client = await pool.connect();
  try {
    await beginWithRls(client);
    const updated = await executeRepayFacilityTxn(
      client,
      settlementId,
      facilityRepaymentAmount,
      accruedInterest,
      settlement.status,
      userId,
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
    logger.audit('SETTLEMENT_FACILITY_REPAID', { component: MODULE, settlementId });
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction body for repayFacility. */
async function executeRepayFacilityTxn(
  client: import('pg').PoolClient,
  settlementId: string,
  facilityRepaymentAmount: string,
  accruedInterest: string,
  prevStatus: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<SettlementRecord> {
  await repo.updateFacilityRepaymentWithClient(
    client,
    settlementId,
    facilityRepaymentAmount,
    accruedInterest,
  );

  const updated = await repo.updateSettlementStatusWithClient(
    client,
    settlementId,
    SettlementStatus.FACILITY_REPAID,
    userId,
  );

  await repo.createAuditEntryWithClient(
    client,
    userId,
    'SETTLEMENT_FACILITY_REPAID',
    MODULE,
    settlementId,
    { status: prevStatus },
    { status: SettlementStatus.FACILITY_REPAID, facilityRepaymentAmount },
    ipAddress,
    userAgent,
  );

  return updated!;
}

// =========================================================================
// Book profit — calculates and records net profit
// =========================================================================

export async function bookProfit(
  settlementId: string,
  discountEarned: string,
  bankCostPaid: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<SettlementRecord> {
  const settlement = await getSettlementOrThrow(settlementId);
  assertTransition(settlement.status, SettlementStatus.PROFIT_BOOKED);
  const netProfit = calculateNetProfit(discountEarned, bankCostPaid, settlement.penalty_income);
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    const updated = await executeBookProfitTxn(
      client,
      settlementId,
      discountEarned,
      bankCostPaid,
      settlement.penalty_income,
      netProfit,
      settlement.status,
      userId,
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
    logger.audit('SETTLEMENT_PROFIT_BOOKED', { component: MODULE, settlementId, netProfit });
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction body for bookProfit. */
async function executeBookProfitTxn(
  client: import('pg').PoolClient,
  settlementId: string,
  discountEarned: string,
  bankCostPaid: string,
  penaltyIncome: string,
  netProfit: string,
  prevStatus: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<SettlementRecord> {
  await repo.createProfitBookingWithClient(
    client,
    uuidv4(),
    settlementId,
    discountEarned,
    bankCostPaid,
    penaltyIncome,
    netProfit,
    userId,
  );
  await repo.updateNetProfitWithClient(client, settlementId, netProfit);

  const updated = await repo.updateSettlementStatusWithClient(
    client,
    settlementId,
    SettlementStatus.PROFIT_BOOKED,
    userId,
  );

  await repo.createAuditEntryWithClient(
    client,
    userId,
    'SETTLEMENT_PROFIT_BOOKED',
    MODULE,
    settlementId,
    { status: prevStatus },
    { status: SettlementStatus.PROFIT_BOOKED, netProfit },
    ipAddress,
    userAgent,
  );

  return updated!;
}

// =========================================================================
// Close settlement — final step, notifies supplier
// =========================================================================

export async function closeSettlement(
  settlementId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<SettlementRecord> {
  const settlement = await getSettlementOrThrow(settlementId);
  assertTransition(settlement.status, SettlementStatus.CLOSED);

  const client = await pool.connect();
  try {
    await beginWithRls(client);
    const updated = await executeCloseTxn(
      client,
      settlementId,
      settlement.status,
      userId,
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');

    logger.audit('SETTLEMENT_CLOSED', { component: MODULE, settlementId });
    await queueSettlementNotification(settlement.invoice_id, settlementId, updated.net_profit);
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction body for closeSettlement. */
async function executeCloseTxn(
  client: import('pg').PoolClient,
  settlementId: string,
  prevStatus: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<SettlementRecord> {
  const updated = await repo.updateSettlementStatusWithClient(
    client,
    settlementId,
    SettlementStatus.CLOSED,
    userId,
  );

  await repo.createAuditEntryWithClient(
    client,
    userId,
    'SETTLEMENT_CLOSED',
    MODULE,
    settlementId,
    { status: prevStatus },
    { status: SettlementStatus.CLOSED },
    ipAddress,
    userAgent,
  );

  return updated!;
}

// =========================================================================
// Read operations
// =========================================================================

export async function getSettlement(settlementId: string): Promise<EnrichedSettlement> {
  const settlement = await repo.getEnrichedSettlementById(settlementId);
  if (!settlement) {
    throw new NotFoundError('Settlement', settlementId);
  }
  return settlement;
}

export async function getSettlementList(
  page: number,
  limit: number,
): Promise<{ data: SettlementSummary[]; total: number }> {
  return repo.listSettlements(page, limit);
}

// =========================================================================
// Dashboard (REQ-SETTLE-008)
// =========================================================================

const DEFAULT_DASHBOARD_PERIOD_DAYS = 30;

/**
 * Aggregated settlement metrics for the management/finance/auditor dashboard.
 * Defaults to the last 30 days when no bounds supplied. Read-only; not audited.
 */
export async function getDashboard(
  periodStart?: Date,
  periodEnd?: Date,
): Promise<DashboardResponse> {
  const end = periodEnd ?? new Date();
  const start = periodStart ?? new Date(end.getTime() - DEFAULT_DASHBOARD_PERIOD_DAYS * 86400_000);

  if (start.getTime() >= end.getTime()) {
    throw new BusinessRuleError(
      'SETTLEMENT_DASHBOARD_INVALID_PERIOD',
      'period_start must be earlier than period_end',
    );
  }

  const row = await repo.getDashboardMetrics(start, end);
  logger.info('Settlement dashboard generated', {
    component: MODULE,
    totalSettlements: row.total_settlements,
    pendingCount: row.pending_count,
  });

  return {
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    total_settlements: Number(row.total_settlements),
    total_profit_booked: row.total_profit_booked,
    total_facility_repayment: row.total_facility_repayment,
    pending_count: Number(row.pending_count),
    avg_profit_per_invoice: row.avg_profit_per_invoice,
  };
}

// =========================================================================
// Private helpers
// =========================================================================

async function getSettlementOrThrow(id: string): Promise<SettlementRecord> {
  const settlement = await repo.getSettlementById(id);
  if (!settlement) {
    throw new NotFoundError('Settlement', id);
  }
  return settlement;
}

function calculateNetProfit(
  discountEarned: string,
  bankCostPaid: string,
  penaltyIncome: string,
): string {
  const net = BigInt(discountEarned) - BigInt(bankCostPaid) + BigInt(penaltyIncome);
  return net.toString();
}

interface DrawdownRow {
  id: string;
  principal: string;
  accrued_interest: string;
}

async function findDrawdownForInvoice(invoiceId: string): Promise<DrawdownRow | null> {
  const { rows } = await pool.query<DrawdownRow>(
    `SELECT id, principal::text, accrued_interest::text
     FROM facility_drawdowns
     WHERE invoice_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [invoiceId],
  );
  return rows[0] ?? null;
}

async function queueSettlementNotification(
  invoiceId: string,
  settlementId: string,
  netProfit: string,
): Promise<void> {
  if (!notificationQueue) {
    logger.warn(`${MODULE}: notification queue not configured`, {
      settlementId,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'settlement_complete',
    { invoiceId, settlementId, netProfit },
    { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}

// =========================================================================
// BullMQ Worker factory — settlement initiation
// =========================================================================

interface SettlementJobPayload {
  invoiceId: string;
  collectionId: string;
  amount: string;
  penaltyAmount: string;
}

/**
 * Create a BullMQ Worker for the 'settlement-initiate' queue.
 * Processes settlement initiation triggered by buyer payment.
 */
export function createSettlementWorker(redisUrl: string): Worker<SettlementJobPayload> {
  const worker = new Worker<SettlementJobPayload>(
    'settlement-initiate',
    withJobContext<SettlementJobPayload>(async (job: Job<SettlementJobPayload>) => {
      await handleSettlementJob(job.data);
    }),
    { connection: { url: redisUrl }, concurrency: 1 },
  );
  attachSettlementWorkerLogging(worker);
  return worker;
}

/** Attach completed/failed logging to the settlement worker. */
function attachSettlementWorkerLogging(worker: Worker<SettlementJobPayload>): void {
  worker.on('completed', (job: Job<SettlementJobPayload>) => {
    logger.info('Settlement initiation job completed', {
      component: MODULE,
      jobId: job.id,
      invoiceId: job.data.invoiceId,
    });
  });

  worker.on('failed', (job: Job<SettlementJobPayload> | undefined, err: Error) => {
    logger.error('Settlement initiation job failed', {
      component: MODULE,
      jobId: job?.id,
      invoiceId: job?.data?.invoiceId,
      errorMessage: err.message,
    });
  });
}

/**
 * Handle a single settlement initiation job.
 * Only creates the settlement in PENDING status.
 * Remaining stages (repay facility → book profit → close) are
 * triggered manually by the finance team via the frontend.
 */
async function handleSettlementJob(data: SettlementJobPayload): Promise<void> {
  await initiateSettlement(
    data.invoiceId,
    data.collectionId,
    data.amount,
    data.penaltyAmount,
    'SYSTEM',
    '0.0.0.0',
    'scheduled-worker',
    deriveSettlementIdempotencyKey(data.invoiceId, data.collectionId),
  );
}
