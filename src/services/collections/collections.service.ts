import { v4 as uuidv4 } from 'uuid';
import { Queue, Worker, type Job } from 'bullmq';
import { BusinessRuleError, NotFoundError } from '../../shared/errors';
import { pool, beginWithRls } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { enqueueWithContext, withJobContext } from '../../shared/workers/queue-helpers';
import { encrypt, decrypt, hashDocument } from '../../shared/crypto';
import { generateDemandLetter } from '../../shared/pdf/pdf-generator';
import type { DemandLetterData, RisDetails, BuyerDetails } from '../../shared/pdf/pdf-generator';
import { getRiskConfigValue } from '../../shared/risk-config';
import * as repo from './collections.repository';
import { CollectionStatus, CollectionErrorCode, ReminderType } from './collections.types';
import type { EscalationDocumentSummary, EscalationDocumentRow } from './collections.types';
import { getDrawdownByInvoiceId } from '../facilities/facilities.repository';
import type {
  PenaltyCalculation,
  OverdueInvoiceSummary,
  RecordPaymentInput,
  CollectionListFilters,
  PaginatedCollectionsResponse,
  CollectionListItem,
  CollectionSummaryStats,
  CollectionDetailResponse,
  CollectionPaymentHistoryItem,
  EscalationHistoryItem,
  BuyerContactInfo,
  EscalationLevelLabel,
  FrontendRecordPaymentInput,
} from './collections.types';

// =========================================================================
// Constants
// =========================================================================

const FALLBACK_DAILY_PENALTY_RATE = '0.001'; // 0.1% per day — used if risk_config unavailable
const PENALTY_PRECISION = 1_000_000n; // 6 decimal places for rate math

async function getDailyPenaltyRate(): Promise<string> {
  try {
    return await getRiskConfigValue('collections_daily_penalty_rate');
  } catch {
    logger.warn('Failed to read penalty rate from risk_config, using fallback', {
      component: 'collections',
    });
    return FALLBACK_DAILY_PENALTY_RATE;
  }
}
const AML_FLAG_THRESHOLD = BigInt(process.env.AML_FLAG_THRESHOLD_UGX ?? '100000000');

// =========================================================================
// Queue references
// =========================================================================

let notificationQueue: Queue | null = null;
let facilityRepaymentQueue: Queue | null = null;
let settlementQueue: Queue | null = null;

/** Set queue for notifications (SMS, email, WhatsApp). */
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

/** Get notification queue reference (used by worker failure handler). */
export function getNotificationQueueRef(): Queue | null {
  return notificationQueue;
}

/** Set queue for facility repayment triggers. */
export function setFacilityRepaymentQueue(queue: Queue): void {
  facilityRepaymentQueue = queue;
}

/** Set queue for settlement initiation triggers. */
export function setSettlementQueue(queue: Queue): void {
  settlementQueue = queue;
}

// =========================================================================
// Penalty calculation — integer arithmetic only
// =========================================================================

/**
 * Calculate penalty using integer arithmetic.
 * penalty = face_value x daily_penalty_rate x days_overdue
 */
export function calculatePenalty(
  faceValue: string,
  daysOverdue: number,
  dailyPenaltyRate: string,
): string {
  const fv = BigInt(faceValue);
  const days = BigInt(daysOverdue);

  const rateParts = dailyPenaltyRate.split('.');
  const intPart = rateParts[0] ?? '0';
  const fracPart = (rateParts[1] ?? '').padEnd(6, '0').slice(0, 6);
  const rateInt = BigInt(intPart) * PENALTY_PRECISION + BigInt(fracPart);

  const penalty = (fv * rateInt * days) / PENALTY_PRECISION;
  return penalty.toString();
}

// =========================================================================
// Escalation level helpers
// =========================================================================

/**
 * Map numeric escalation level to frontend label.
 */
export function escalationLevelToLabel(level: number): EscalationLevelLabel {
  if (level >= 3) return 'legal';
  if (level >= 2) return 'formal';
  if (level >= 1) return 'reminder';
  return 'none';
}

/**
 * Get a human-readable label for an escalation level number.
 */
function escalationLevelName(level: number): string {
  if (level >= 3) return 'Legal Action Initiated';
  if (level >= 2) return 'Formal Notice Issued';
  if (level >= 1) return 'Reminder Sent';
  return 'None';
}

// =========================================================================
// Process overdue invoice (T+1)
// =========================================================================

/**
 * Mark a collecting invoice as overdue.
 * Requires invoice.status = 'collecting' — funded invoices must first
 * be transitioned to collecting via startCollectionMonitoring (issue #35).
 *
 * If a collections row already exists (created at funded → collecting),
 * its status is updated to 'overdue' and days_overdue + penalty are set.
 * Otherwise (legacy data path) a new overdue row is inserted.
 */
export async function processOverdueInvoice(
  invoiceId: string,
  notifyUserId: string,
): Promise<void> {
  const invoice = await repo.getInvoiceForCollection(invoiceId);
  if (!invoice) throw new NotFoundError('Invoice', invoiceId);
  if (invoice.status !== 'collecting') return;
  const penaltyAmount = calculatePenalty(invoice.face_value, 1, await getDailyPenaltyRate());
  const existing = await repo.getCollectionByInvoiceId(invoiceId);
  const collectionId = existing?.id ?? uuidv4();
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await executeOverdueTxn(
      client,
      invoiceId,
      collectionId,
      invoice,
      penaltyAmount,
      notifyUserId,
      existing !== null,
    );
    await client.query('COMMIT');
    logCollectionEvent('INVOICE_OVERDUE', invoiceId, collectionId);
    await queueNotification('overdue-notification', {
      invoiceId,
      buyerId: invoice.buyer_id,
      type: 'credit_officer_notify',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction body for processOverdueInvoice. */
async function executeOverdueTxn(
  client: import('pg').PoolClient,
  invoiceId: string,
  collectionId: string,
  invoice: { buyer_id: string; face_value: string },
  penaltyAmount: string,
  notifyUserId: string,
  existingCollection: boolean,
): Promise<void> {
  if (existingCollection) {
    await repo.updateCollectionStatus(client, collectionId, CollectionStatus.OVERDUE);
    await repo.updateEscalationLevel(client, collectionId, 0, 1, penaltyAmount);
  } else {
    await repo.createOverdueRecord(client, invoiceId, {
      id: collectionId,
      invoiceId,
      buyerId: invoice.buyer_id,
      faceValue: invoice.face_value,
      amountDue: invoice.face_value,
      daysOverdue: 1,
      dailyPenaltyRate: await getDailyPenaltyRate(),
      penaltyAmount,
    });
  }

  await repo.updateInvoiceStatus(client, invoiceId, 'overdue', 'collecting');

  await repo.createAuditEntry(
    client,
    notifyUserId,
    'INVOICE_OVERDUE',
    'collections',
    invoiceId,
    { status: 'collecting' },
    { status: 'overdue', collectionId, daysOverdue: 1, penaltyAmount },
  );
}

// =========================================================================
// Start collection monitoring (funded → collecting transition)
// =========================================================================

/**
 * Start collection monitoring for a freshly funded invoice.
 * Idempotent: if a collections row already exists for the invoice,
 * the call is a no-op.
 *
 * Inside one transaction:
 *   1. INSERT pending collections row
 *   2. UPDATE invoices SET status='collecting' (was 'funded')
 *   3. INSERT audit_log COLLECTION_STARTED
 *
 * Triggered by the collection-monitoring BullMQ worker, which is
 * enqueued by the payments service after a funded webhook commits.
 */
export async function startCollectionMonitoring(
  invoiceId: string,
  paymentId: string,
): Promise<void> {
  const existing = await repo.getCollectionByInvoiceId(invoiceId);
  if (existing) {
    logger.info('Collection monitoring already started — skipping', {
      component: 'collections',
      invoiceId,
      collectionId: existing.id,
    });
    return;
  }
  const invoice = await repo.getInvoiceForCollection(invoiceId);
  if (!invoice) throw new NotFoundError('Invoice', invoiceId);
  if (invoice.status !== 'funded') {
    logger.info('Invoice no longer funded — skipping collection-monitoring start', {
      component: 'collections',
      invoiceId,
      status: invoice.status,
    });
    return;
  }
  const collectionId = uuidv4();
  await persistCollectionStarted(invoiceId, collectionId, invoice, paymentId);
  logCollectionEvent('COLLECTION_STARTED', invoiceId, collectionId);
}

/** Transaction wrapper for startCollectionMonitoring. */
async function persistCollectionStarted(
  invoiceId: string,
  collectionId: string,
  invoice: { buyer_id: string; face_value: string },
  paymentId: string,
): Promise<void> {
  const dailyRate = await getDailyPenaltyRate();
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.createPendingCollectionRecord(client, invoiceId, {
      id: collectionId,
      invoiceId,
      buyerId: invoice.buyer_id,
      faceValue: invoice.face_value,
      amountDue: invoice.face_value,
      daysOverdue: 0,
      dailyPenaltyRate: dailyRate,
      penaltyAmount: '0',
    });
    await repo.updateInvoiceStatus(client, invoiceId, 'collecting', 'funded');
    await repo.createAuditEntry(
      client,
      'SYSTEM',
      'COLLECTION_STARTED',
      'collections',
      invoiceId,
      { status: 'funded' },
      { status: 'collecting', collectionId, paymentId },
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
// Process escalation (T+3, T+7)
// =========================================================================

/**
 * Determine escalation level from days overdue.
 */
export function determineEscalationLevel(daysOverdue: number): number {
  if (daysOverdue >= 14) return 3;
  if (daysOverdue >= 7) return 2;
  if (daysOverdue >= 3) return 1;
  return 0;
}

/**
 * Escalate an overdue collection based on days overdue.
 */
export async function processEscalation(invoiceId: string, daysOverdue: number): Promise<void> {
  const invoice = await repo.getInvoiceForCollection(invoiceId);
  if (!invoice) throw new NotFoundError('Invoice', invoiceId);
  const collection = await repo.getCollectionByInvoiceId(invoiceId);
  if (!collection) throw new NotFoundError('CollectionRecord', invoiceId);
  const newLevel = determineEscalationLevel(daysOverdue);
  const currentLevel = parseInt(String(collection.escalation_level ?? '0'), 10);
  if (newLevel <= currentLevel) return;
  const penalty = calculatePenalty(invoice.face_value, daysOverdue, await getDailyPenaltyRate());
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await executeEscalationTxn(
      client,
      collection,
      invoice,
      newLevel,
      currentLevel,
      daysOverdue,
      penalty,
    );
    await client.query('COMMIT');
    logCollectionEvent('COLLECTION_ESCALATED', invoiceId, collection.id);
    await notifyEscalation(invoiceId, invoice.buyer_id, daysOverdue, newLevel, penalty);
    await autoGenerateDraft(collection.id, newLevel);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction body for processEscalation. */
async function executeEscalationTxn(
  client: import('pg').PoolClient,
  collection: { id: string; status: string; days_overdue: number },
  invoice: { face_value: string },
  newLevel: number,
  currentLevel: number,
  daysOverdue: number,
  penalty: string,
): Promise<void> {
  await repo.updateCollectionStatus(client, collection.id, CollectionStatus.ESCALATED);
  await repo.updateEscalationLevel(client, collection.id, newLevel, daysOverdue, penalty);

  const sarFlagged = checkSarFlag(newLevel, invoice.face_value);
  if (sarFlagged) {
    await repo.flagForSarReview(client, collection.id);
    logCollectionEvent('SAR_REVIEW_FLAGGED', collection.id, collection.id);
  }

  await repo.createAuditEntry(
    client,
    null,
    'COLLECTION_ESCALATED',
    'collections',
    collection.id,
    {
      status: collection.status,
      daysOverdue: collection.days_overdue,
      escalationLevel: currentLevel,
    },
    {
      status: CollectionStatus.ESCALATED,
      daysOverdue,
      escalationLevel: newLevel,
      escalationTarget: getEscalationTarget(newLevel),
      penaltyAmount: penalty,
      sarFlagged,
    },
  );
}

/** Check if a SAR review flag should be raised at escalation. */
function checkSarFlag(level: number, faceValue: string): boolean {
  return level >= 3 && BigInt(faceValue) >= AML_FLAG_THRESHOLD;
}

/** Queue escalation notification after commit. */
async function notifyEscalation(
  invoiceId: string,
  buyerId: string,
  daysOverdue: number,
  level: number,
  penalty: string,
): Promise<void> {
  await queueNotification('escalation-notification', {
    invoiceId,
    buyerId,
    daysOverdue,
    escalationLevel: level,
    escalationTarget: getEscalationTarget(level),
    penaltyAmount: penalty,
  });
}

/**
 * Get the notification target for a given escalation level.
 */
function getEscalationTarget(level: number): string {
  if (level >= 3) return 'legal';
  if (level >= 2) return 'management';
  return 'credit_manager';
}

// =========================================================================
// Record payment received (original — by invoice ID)
// =========================================================================

/**
 * Record a payment from a buyer (original endpoint, by invoice ID).
 */
export async function recordPaymentReceived(input: RecordPaymentInput): Promise<void> {
  const invoice = await repo.getInvoiceForCollection(input.invoiceId);
  if (!invoice) throw new NotFoundError('Invoice', input.invoiceId);
  if (invoice.status === 'collected') {
    throw new BusinessRuleError(
      CollectionErrorCode.ALREADY_COLLECTED,
      'Invoice has already been collected',
    );
  }

  const collection = await repo.getCollectionByInvoiceId(input.invoiceId);

  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await executePaymentReceivedTxn(client, input, invoice, collection);
    await client.query('COMMIT');

    logCollectionEvent('PAYMENT_RECEIVED', input.invoiceId, collection?.id ?? '');
    await dispatchPostPaymentJobs(input, invoice, collection);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Atomically transition the invoice to `collected`, throwing if the row's
 * status no longer matches `expectedStatus`. The WHERE-clause guard on
 * `updateInvoiceStatus` is what makes two concurrent payment-received
 * transactions serialisable; whichever loses sees `transitioned === false`
 * here and must roll back rather than commit double side effects
 * (`reduceBuyerUsedLimit`, audit log).
 */
async function assertInvoiceCollectedTransition(
  client: import('pg').PoolClient,
  invoiceId: string,
  expectedStatus: string,
): Promise<void> {
  const transitioned = await repo.updateInvoiceStatus(
    client,
    invoiceId,
    'collected',
    expectedStatus,
  );
  if (!transitioned) {
    throw new BusinessRuleError(
      CollectionErrorCode.ALREADY_COLLECTED,
      'Concurrent payment received for this invoice — refusing duplicate commit',
    );
  }
}

/** Transaction body for recordPaymentReceived. */
async function executePaymentReceivedTxn(
  client: import('pg').PoolClient,
  input: RecordPaymentInput,
  invoice: { buyer_id: string; face_value: string; due_date: string; status: string },
  collection: { id: string; penalty_amount: string } | null,
): Promise<void> {
  await assertInvoiceCollectedTransition(client, input.invoiceId, invoice.status);
  await repo.recordPaymentReceived(
    client,
    collection?.id ?? '',
    input.amount,
    input.paymentMethod,
    input.paidBy,
    input.paymentDate,
    input.receivedBy,
    input.paymentReference,
    input.notes,
  );
  await repo.reduceBuyerUsedLimit(client, invoice.buyer_id, invoice.face_value);

  const daysLate = calculateDaysLate(input.paymentDate, invoice.due_date);
  await repo.adjustBuyerPaymentScore(client, invoice.buyer_id, daysLate);
  if (collection) await repo.resolveCollection(client, collection.id, input.amount);

  await repo.createAuditEntry(
    client,
    input.receivedBy,
    'PAYMENT_RECEIVED',
    'collections',
    input.invoiceId,
    { status: invoice.status },
    { status: 'collected', amount: input.amount, paymentDate: input.paymentDate },
  );
}

/** Queue facility repayment, settlement, and supplier notification after payment commit. */
async function dispatchPostPaymentJobs(
  input: RecordPaymentInput,
  invoice: { supplier_id: string },
  collection: { id: string; penalty_amount: string } | null,
): Promise<void> {
  await queueFacilityRepayment(input.invoiceId);
  await queueSettlementInitiation(
    input.invoiceId,
    collection?.id ?? '',
    input.amount,
    collection?.penalty_amount ?? '0',
  );
  await queueNotification('supplier-payment-notification', {
    invoiceId: input.invoiceId,
    supplierId: invoice.supplier_id,
    type: 'buyer_paid',
  });
}

// =========================================================================
// Record payment (frontend-aligned — by collection ID)
// =========================================================================

/**
 * Record a payment against a collection (frontend endpoint).
 */
export async function recordCollectionPayment(
  collectionId: string,
  input: FrontendRecordPaymentInput,
  userId: string,
): Promise<void> {
  const collection = await repo.getCollectionById(collectionId);
  if (!collection) throw new NotFoundError('Collection', collectionId);
  if (collection.status === 'collected') {
    throw new BusinessRuleError(
      CollectionErrorCode.ALREADY_COLLECTED,
      'Collection has already been fully collected',
    );
  }

  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await executeCollectionPaymentTxn(client, collectionId, input, userId, collection.status);
    await client.query('COMMIT');
    logCollectionEvent('PAYMENT_RECEIVED', collection.invoice_id, collectionId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction body for recordCollectionPayment. */
async function executeCollectionPaymentTxn(
  client: import('pg').PoolClient,
  collectionId: string,
  input: FrontendRecordPaymentInput,
  userId: string,
  prevStatus: string,
): Promise<void> {
  const amountStr = input.amount.toString();

  await repo.recordPaymentReceived(
    client,
    collectionId,
    amountStr,
    input.method,
    input.paid_by,
    input.payment_date,
    userId,
    input.reference,
    input.notes,
  );
  await repo.updateCollectionAfterPayment(client, collectionId, amountStr);

  await repo.createAuditEntry(
    client,
    userId,
    'PAYMENT_RECEIVED',
    'collections',
    collectionId,
    { status: prevStatus },
    {
      amount: amountStr,
      paymentDate: input.payment_date,
      method: input.method,
      paidBy: input.paid_by,
    },
  );
}

// =========================================================================
// Escalate / De-escalate / Resolve (frontend-aligned)
// =========================================================================

/**
 * Manually escalate a collection to the next level.
 */
export async function escalateCollection(
  collectionId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const collection = await repo.getCollectionById(collectionId);
  if (!collection) throw new NotFoundError('Collection', collectionId);
  if (collection.status === 'collected') {
    throw new BusinessRuleError(
      CollectionErrorCode.ALREADY_RESOLVED,
      'Cannot escalate a resolved collection',
    );
  }
  const currentLevel = parseInt(String(collection.escalation_level ?? '0'), 10);
  const newLevel = Math.min(currentLevel + 1, 3);
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await executeManualEscalationTxn(
      client,
      collectionId,
      collection.invoice_id,
      currentLevel,
      newLevel,
      userId,
      reason,
    );
    await client.query('COMMIT');
    logCollectionEvent('COLLECTION_ESCALATED', collection.invoice_id, collectionId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction body for escalateCollection. */
async function executeManualEscalationTxn(
  client: import('pg').PoolClient,
  collectionId: string,
  invoiceId: string,
  currentLevel: number,
  newLevel: number,
  userId: string,
  reason: string,
): Promise<void> {
  await repo.setEscalationLevel(client, collectionId, newLevel);

  if (newLevel >= 3) {
    const invoice = await repo.getInvoiceForCollection(invoiceId);
    if (invoice && BigInt(invoice.face_value) >= AML_FLAG_THRESHOLD) {
      await repo.flagForSarReview(client, collectionId);
    }
  }

  await repo.createAuditEntry(
    client,
    userId,
    'COLLECTION_ESCALATED',
    'collections',
    collectionId,
    { escalationLevel: currentLevel },
    { escalationLevel: newLevel, reason },
  );
}

/**
 * Manually de-escalate a collection by one level.
 */
export async function deescalateCollection(
  collectionId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const collection = await repo.getCollectionById(collectionId);
  if (!collection) throw new NotFoundError('Collection', collectionId);
  const currentLevel = parseInt(String(collection.escalation_level ?? '0'), 10);
  if (currentLevel <= 0) {
    throw new BusinessRuleError(
      CollectionErrorCode.CANNOT_DEESCALATE,
      'Collection is already at the lowest escalation level',
    );
  }
  const newLevel = currentLevel - 1;
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await executeDeescalationTxn(client, collectionId, currentLevel, newLevel, userId, reason);
    await client.query('COMMIT');
    logCollectionEvent('COLLECTION_DEESCALATED', collection.invoice_id, collectionId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction body for deescalateCollection. */
async function executeDeescalationTxn(
  client: import('pg').PoolClient,
  collectionId: string,
  currentLevel: number,
  newLevel: number,
  userId: string,
  reason: string,
): Promise<void> {
  await repo.setEscalationLevel(client, collectionId, newLevel);
  if (newLevel === 0) {
    await repo.updateCollectionStatus(client, collectionId, CollectionStatus.OVERDUE);
  }

  await repo.createAuditEntry(
    client,
    userId,
    'COLLECTION_DEESCALATED',
    'collections',
    collectionId,
    { escalationLevel: currentLevel },
    { escalationLevel: newLevel, reason },
  );
}

/**
 * Resolve/mark a collection as collected.
 */
export async function resolveCollectionById(collectionId: string, userId: string): Promise<void> {
  const collection = await repo.getCollectionById(collectionId);
  if (!collection) throw new NotFoundError('Collection', collectionId);
  if (collection.status === 'collected') {
    throw new BusinessRuleError(
      CollectionErrorCode.ALREADY_RESOLVED,
      'Collection is already resolved',
    );
  }

  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await executeResolveTxn(client, collectionId, collection.invoice_id, collection.status, userId);
    await client.query('COMMIT');
    logCollectionEvent('COLLECTION_RESOLVED', collection.invoice_id, collectionId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction body for resolveCollectionById. */
async function executeResolveTxn(
  client: import('pg').PoolClient,
  collectionId: string,
  invoiceId: string,
  prevStatus: string,
  userId: string,
): Promise<void> {
  await repo.resolveCollectionById(client, collectionId);
  const expectedPrev = prevStatus === 'escalated' ? 'overdue' : prevStatus;
  await repo.updateInvoiceStatus(client, invoiceId, 'collected', expectedPrev);

  await repo.createAuditEntry(
    client,
    userId,
    'COLLECTION_RESOLVED',
    'collections',
    collectionId,
    { status: prevStatus },
    { status: 'collected' },
  );
}

// =========================================================================
// List collections (frontend-aligned)
// =========================================================================

/**
 * Get paginated collections list with summary stats.
 */
export async function listCollections(
  filters: CollectionListFilters,
): Promise<PaginatedCollectionsResponse> {
  const page = filters.page ?? 1;
  const pageSize = filters.page_size ?? 20;

  const [listResult, summaryRow] = await Promise.all([
    repo.listCollections(filters),
    repo.getCollectionSummaryStats(filters),
  ]);

  const data: CollectionListItem[] = listResult.rows.map(transformListRow);

  const summaryStats = transformSummaryStats(summaryRow);

  return {
    data,
    total: listResult.total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(listResult.total / pageSize),
    summary_stats: summaryStats,
  };
}

/** Raw row shape from the collections list query. */
interface CollectionListRow {
  id: string;
  invoice_id: string;
  invoice_number: string;
  buyer_name: string;
  supplier_name: string;
  face_value: string;
  outstanding_amount: string;
  due_date: string;
  days_overdue: number;
  status: string;
  escalation_level: number;
  last_payment_date: string | null;
  last_payment_amount: string | null;
  total_collected: string;
}

/** Transform a raw list row to the frontend shape. */
function transformListRow(row: CollectionListRow): CollectionListItem {
  return {
    id: row.id,
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    buyer_name: row.buyer_name,
    supplier_name: row.supplier_name,
    face_value: parseInt(row.face_value, 10),
    outstanding_amount: parseInt(row.outstanding_amount, 10),
    due_date: row.due_date,
    days_overdue: row.days_overdue,
    status: row.status,
    escalation_level: escalationLevelToLabel(row.escalation_level),
    last_payment_date: row.last_payment_date,
    last_payment_amount: parseNullableInt(row.last_payment_amount),
    total_collected: parseInt(row.total_collected ?? '0', 10),
  };
}

/** Parse a nullable string to int, returning null when input is null. */
function parseNullableInt(value: string | null): number | null {
  return value !== null ? parseInt(value, 10) : null;
}

/**
 * Transform raw summary stats to the frontend shape.
 */
function transformSummaryStats(row: {
  total_outstanding_ugx: string;
  overdue_count: string;
  avg_days_overdue: string;
  collection_rate: string;
}): CollectionSummaryStats {
  return {
    total_outstanding_ugx: parseInt(row.total_outstanding_ugx, 10),
    overdue_count: parseInt(row.overdue_count, 10),
    avg_days_overdue: parseFloat(parseFloat(row.avg_days_overdue).toFixed(1)),
    collection_rate: parseFloat(parseFloat(row.collection_rate).toFixed(1)),
  };
}

// =========================================================================
// Get collection detail (frontend-aligned)
// =========================================================================

/**
 * Get full collection detail including payment history and escalation history.
 */
export async function getCollectionDetail(collectionId: string): Promise<CollectionDetailResponse> {
  const detail = await repo.getCollectionDetail(collectionId);
  if (!detail) throw new NotFoundError('Collection', collectionId);

  const [paymentRows, escalationRows, buyerRow] = await Promise.all([
    repo.getPaymentHistory(collectionId),
    repo.getEscalationHistory(collectionId),
    repo.getBuyerContact(detail.buyer_id),
  ]);

  return assembleDetailResponse(
    detail,
    transformPaymentHistory(paymentRows),
    transformEscalationHistory(escalationRows),
    transformBuyerContact(buyerRow),
  );
}

/** Assemble the CollectionDetailResponse from its constituent parts. */
function assembleDetailResponse(
  detail: {
    id: string;
    invoice_id: string;
    invoice_number: string;
    buyer_name: string;
    supplier_name: string;
    buyer_id: string;
    supplier_id: string;
    face_value: string;
    total_collected: string | null;
    outstanding_amount: string;
    due_date: string;
    days_overdue: number;
    status: string;
    escalation_level: number;
    sar_flagged: boolean;
    last_payment_date: string | null;
    created_at: string;
    updated_at: string;
  },
  paymentHistory: CollectionPaymentHistoryItem[],
  escalationHistory: EscalationHistoryItem[],
  buyerContact: BuyerContactInfo,
): CollectionDetailResponse {
  return {
    id: detail.id,
    invoice_id: detail.invoice_id,
    invoice_number: detail.invoice_number,
    buyer_name: detail.buyer_name,
    supplier_name: detail.supplier_name,
    buyer_id: detail.buyer_id,
    supplier_id: detail.supplier_id,
    face_value: parseInt(detail.face_value, 10),
    collected_amount: parseInt(detail.total_collected ?? '0', 10),
    outstanding_amount: parseInt(detail.outstanding_amount, 10),
    due_date: detail.due_date,
    days_overdue: detail.days_overdue,
    status: detail.status,
    escalation_level: escalationLevelToLabel(detail.escalation_level),
    sar_flagged: detail.sar_flagged,
    last_payment_date: detail.last_payment_date,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
    buyer_contact: buyerContact,
    payment_history: paymentHistory,
    escalation_history: escalationHistory,
  };
}

/**
 * Transform payment history rows.
 */
function transformPaymentHistory(
  rows: {
    id: string;
    amount: string;
    payment_date: string;
    method: string;
    reference: string;
    running_balance: string;
    notes: string | null;
  }[],
): CollectionPaymentHistoryItem[] {
  return rows.map((r) => ({
    id: r.id,
    amount: parseInt(r.amount, 10),
    payment_date: r.payment_date,
    method: r.method,
    reference: r.reference,
    running_balance: parseInt(r.running_balance, 10),
    notes: r.notes,
  }));
}

/**
 * Transform escalation history rows.
 */
function transformEscalationHistory(
  rows: {
    id: string;
    escalation_level: number;
    occurred_at: string;
    actor_name: string;
    actor_role: string;
    notes: string | null;
  }[],
): EscalationHistoryItem[] {
  return rows.map((r) => ({
    id: r.id,
    level: escalationLevelToLabel(r.escalation_level),
    level_number: r.escalation_level,
    label: escalationLevelName(r.escalation_level),
    occurred_at: r.occurred_at,
    actor_name: r.actor_name,
    actor_role: r.actor_role,
    notes: r.notes,
  }));
}

/**
 * Transform buyer contact row, decrypting PII fields.
 */
function transformBuyerContact(
  row: {
    id: string;
    company_name: string;
    contact_email_encrypted: string | null;
    contact_phone_encrypted: string | null;
    approved_limit: string;
    payment_score: number;
  } | null,
): BuyerContactInfo {
  if (!row) return emptyBuyerContact();

  return {
    id: row.id,
    company: row.company_name,
    contact_person: '',
    email: safeDecrypt(row.contact_email_encrypted),
    phone: safeDecrypt(row.contact_phone_encrypted),
    address: '',
    payment_terms_days: 30,
  };
}

/** Return a default empty BuyerContactInfo. */
function emptyBuyerContact(): BuyerContactInfo {
  return {
    id: '',
    company: 'Unknown',
    contact_person: '',
    email: '',
    phone: '',
    address: '',
    payment_terms_days: 0,
  };
}

/** Decrypt an encrypted field, returning empty string on null or failure. */
function safeDecrypt(encrypted: string | null): string {
  if (encrypted === null) return '';
  try {
    return decrypt(encrypted);
  } catch {
    return '';
  }
}

// =========================================================================
// Process reminders (cron job)
// =========================================================================

/**
 * Process reminder schedule for all invoices at trigger points.
 */
export async function processReminders(): Promise<void> {
  try {
    const invoices = await repo.getInvoicesDueForReminder();
    for (const inv of invoices) {
      await processSingleReminder(inv);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    logger.error('Reminder processing failed', { component: 'collections', errorMessage: msg });
  }
}

/** Process a single invoice reminder: queue notification + escalation. */
async function processSingleReminder(inv: {
  id: string;
  buyer_id: string;
  reminder_type: ReminderType;
}): Promise<void> {
  try {
    await queueNotification('invoice-reminder', {
      invoiceId: inv.id,
      buyerId: inv.buyer_id,
      reminderType: inv.reminder_type,
    });
    await handleReminderEscalation(inv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    logger.error('Reminder queue failed', {
      component: 'collections',
      invoiceId: inv.id,
      reminderType: inv.reminder_type,
      errorMessage: msg,
    });
  }
}

/**
 * Handle escalation actions triggered by specific reminder types.
 * T+1: transition invoice to overdue via processOverdueInvoice.
 * T-3: queue credit_officer escalation for buyer non-response.
 */
async function handleReminderEscalation(inv: {
  id: string;
  buyer_id: string;
  reminder_type: ReminderType;
}): Promise<void> {
  if (inv.reminder_type === ReminderType.T_PLUS_1) {
    try {
      await processOverdueInvoice(inv.id, 'SYSTEM');
    } catch (err) {
      logger.warn('T+1 overdue processing skipped', {
        component: 'collections',
        invoiceId: inv.id,
        reason: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }
  if (inv.reminder_type === ReminderType.T_MINUS_3) {
    await queueNotification('buyer-payment-escalation', {
      invoiceId: inv.id,
      buyerId: inv.buyer_id,
      type: 'credit_officer_escalation',
      message: 'Buyer has not responded to payment reminder at T-3',
    });
  }
}

// =========================================================================
// Automatic default workflow (cron job)
// =========================================================================

const DEFAULT_OVERDUE_THRESHOLD = 90;

/**
 * Auto-default collections at escalation level 3 with 90+ days overdue.
 * Sets collection → BAD_DEBT, invoice → defaulted. Audit + notify.
 */
export async function processDefaulted(): Promise<void> {
  const collections = await repo.getDefaultableCollections();

  for (const coll of collections) {
    try {
      await defaultSingleCollection(coll.id, coll.invoice_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      logger.error('Auto-default failed', {
        component: 'collections',
        collectionId: coll.id,
        invoiceId: coll.invoice_id,
        errorMessage: msg,
      });
    }
  }
}

async function defaultSingleCollection(collectionId: string, invoiceId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.updateCollectionStatus(client, collectionId, CollectionStatus.BAD_DEBT);
    await repo.updateInvoiceStatus(client, invoiceId, 'defaulted', 'overdue');
    await repo.createAuditEntry(
      client,
      'SYSTEM',
      'INVOICE_DEFAULTED',
      'collections',
      collectionId,
      { status: 'overdue' },
      { status: 'defaulted', threshold: DEFAULT_OVERDUE_THRESHOLD },
    );
    await client.query('COMMIT');
    logCollectionEvent('INVOICE_DEFAULTED', invoiceId, collectionId);
    await notifyDefaulted(invoiceId, collectionId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function notifyDefaulted(invoiceId: string, collectionId: string): Promise<void> {
  await queueNotification('invoice-defaulted', {
    invoiceId,
    collectionId,
    recipients: ['finance_manager', 'management'],
  });
}

// =========================================================================
// Batch overdue processing (scheduled job)
// =========================================================================

/**
 * Process all funded invoices past their due date.
 * Calls processOverdueInvoice for each; logs errors but continues.
 */
export async function processOverdueInvoices(): Promise<void> {
  const invoices = await repo.getFundedOverdueInvoices();
  let processed = 0;

  for (const inv of invoices) {
    try {
      await processOverdueInvoice(inv.id, 'SYSTEM');
      processed++;
    } catch (err) {
      logBatchError('processOverdueInvoices', inv.id, err);
    }
  }

  logger.info('Overdue batch complete', {
    component: 'collections',
    total: invoices.length,
    processed,
  });
}

// =========================================================================
// Batch escalation processing (scheduled job)
// =========================================================================

/**
 * Process escalation for all overdue/escalated collections.
 * Recalculates days_overdue and calls processEscalation.
 */
export async function processEscalations(): Promise<void> {
  const candidates = await repo.getEscalationCandidates();
  let processed = 0;

  for (const cand of candidates) {
    try {
      await processEscalation(cand.invoice_id, cand.days_overdue);
      processed++;
    } catch (err) {
      logBatchError('processEscalations', cand.invoice_id, err);
    }
  }

  logger.info('Escalation batch complete', {
    component: 'collections',
    total: candidates.length,
    processed,
  });
}

/**
 * Log a batch processing error without PII.
 */
function logBatchError(batchName: string, invoiceId: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : 'Unknown';
  logger.error(`${batchName} item failed`, {
    component: 'collections',
    invoiceId,
    errorMessage: msg,
  });
}

// =========================================================================
// Worker factories — overdue + default processing
// =========================================================================

interface ScheduledJobPayload {
  trigger: string;
}

/**
 * Create a BullMQ Worker for the 'overdue-processing' queue.
 * Runs processOverdueInvoices then processEscalations.
 */
export function createOverdueWorker(redisUrl: string): Worker<ScheduledJobPayload> {
  const worker = new Worker<ScheduledJobPayload>(
    'overdue-processing',
    withJobContext<ScheduledJobPayload>(async () => {
      await processOverdueInvoices();
      await processEscalations();
    }),
    { connection: { url: redisUrl }, concurrency: 1 },
  );

  attachWorkerLogging(worker, 'overdue-processing');
  return worker;
}

/**
 * Create a BullMQ Worker for the 'default-processing' queue.
 * Runs processDefaulted to auto-default 90+ day collections.
 */
export function createDefaultWorker(redisUrl: string): Worker<ScheduledJobPayload> {
  const worker = new Worker<ScheduledJobPayload>(
    'default-processing',
    withJobContext<ScheduledJobPayload>(async () => {
      await processDefaulted();
    }),
    { connection: { url: redisUrl }, concurrency: 1 },
  );

  attachWorkerLogging(worker, 'default-processing');
  return worker;
}

/**
 * Attach standard completed/failed logging to a worker.
 */
function attachWorkerLogging(worker: Worker<ScheduledJobPayload>, name: string): void {
  worker.on('completed', (job: Job<ScheduledJobPayload>) => {
    logger.info(`${name} job completed`, {
      component: 'collections',
      jobId: job.id,
    });
  });

  worker.on('failed', (job: Job<ScheduledJobPayload> | undefined, err: Error) => {
    logger.error(`${name} job failed`, {
      component: 'collections',
      jobId: job?.id,
      errorMessage: err.message,
    });
  });
}

// =========================================================================
// Read operations (legacy endpoints)
// =========================================================================

/**
 * Get penalty calculation for an invoice.
 */
export async function getPenaltyByInvoiceId(invoiceId: string): Promise<PenaltyCalculation | null> {
  return repo.getPenaltyByInvoiceId(invoiceId);
}

/**
 * Get all overdue invoices.
 */
export async function getOverdueInvoices(): Promise<OverdueInvoiceSummary[]> {
  return repo.getOverdueInvoices();
}

// =========================================================================
// Queue helpers
// =========================================================================

async function queueNotification(jobName: string, data: Record<string, unknown>): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'collections',
      jobName,
    });
    return;
  }
  await enqueueWithContext(notificationQueue, jobName, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
  });
}

async function queueFacilityRepayment(invoiceId: string): Promise<void> {
  if (!facilityRepaymentQueue) {
    logger.warn('Facility repayment queue not configured', {
      component: 'collections',
      invoiceId,
    });
    return;
  }
  const drawdown = await getDrawdownByInvoiceId(invoiceId);
  const drawdownId = drawdown?.id ?? null;
  await enqueueWithContext(
    facilityRepaymentQueue,
    'facility-repayment',
    { invoiceId, drawdownId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    },
  );
}

async function queueSettlementInitiation(
  invoiceId: string,
  collectionId: string,
  amount: string,
  penaltyAmount: string,
): Promise<void> {
  if (!settlementQueue) {
    logger.warn('Settlement queue not configured', {
      component: 'collections',
      invoiceId,
    });
    return;
  }
  await enqueueWithContext(
    settlementQueue,
    'settlement-initiate',
    { invoiceId, collectionId, amount, penaltyAmount },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );
}

// =========================================================================
// Logging
// =========================================================================

function logCollectionEvent(action: string, invoiceId: string, collectionId: string): void {
  logger.audit(action, {
    component: 'collections',
    invoiceId,
    collectionId,
  });
}

/**
 * Calculate days late: positive = late, zero/negative = on-time or early.
 */
function calculateDaysLate(paymentDate: string, dueDate: string): number {
  const paid = new Date(paymentDate).getTime();
  const due = new Date(dueDate).getTime();
  const msPerDay = 86_400_000;
  return Math.floor((paid - due) / msPerDay);
}

// =========================================================================
// SAR Filing Workflow
// =========================================================================

/**
 * Generate a SAR report in draft status for a collection.
 */
export async function generateSarReport(
  collectionId: string,
  userId: string,
  reason: string,
  ipAddress: string,
  userAgent: string,
): Promise<{ sarId: string }> {
  const collection = await repo.getCollectionById(collectionId);
  if (!collection) throw new NotFoundError('Collection', collectionId);

  const sarId = uuidv4();
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await executeSarGenerationTxn(
      client,
      sarId,
      collectionId,
      collection.invoice_id,
      userId,
      reason,
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

  logger.audit('SAR_REPORT_GENERATED', { component: 'collections', sarId, collectionId });
  return { sarId };
}

/** Transaction body for generateSarReport. */
async function executeSarGenerationTxn(
  client: import('pg').PoolClient,
  sarId: string,
  collectionId: string,
  invoiceId: string,
  userId: string,
  reason: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repo.createSarReportWithClient(client, {
    id: sarId,
    entityType: 'collection',
    entityId: collectionId,
    collectionId,
    invoiceId,
    reason,
  });

  await repo.createAuditEntry(
    client,
    userId,
    'SAR_REPORT_GENERATED',
    'suspicious_activity_reports',
    sarId,
    null,
    { collectionId, reason, status: 'draft' },
    ipAddress,
    userAgent,
  );
}

/**
 * File a SAR with the FIA, updating status to 'filed'.
 */
export async function fileSarWithFia(
  sarId: string,
  fiaReference: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const sar = await repo.getSarById(sarId);
  if (!sar) throw new NotFoundError('SuspiciousActivityReport', sarId);

  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await executeSarFilingTxn(
      client,
      sarId,
      fiaReference,
      sar.report_status,
      userId,
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

  logger.audit('SAR_FILED_WITH_FIA', { component: 'collections', sarId, fiaReference });
}

/** Transaction body for fileSarWithFia. */
async function executeSarFilingTxn(
  client: import('pg').PoolClient,
  sarId: string,
  fiaReference: string,
  prevStatus: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repo.updateSarStatusWithClient(client, sarId, 'filed', fiaReference, userId);

  await repo.createAuditEntry(
    client,
    userId,
    'SAR_FILED_WITH_FIA',
    'suspicious_activity_reports',
    sarId,
    { status: prevStatus },
    { status: 'filed', fiaReference },
    ipAddress,
    userAgent,
  );
}

// =========================================================================
// Escalation Documents — Draft / Review / Send
// =========================================================================

function getRisDetails(): RisDetails {
  return {
    name: process.env.RIS_COMPANY_NAME ?? 'Rapha Integrated Solutions',
    address: process.env.RIS_COMPANY_ADDRESS ?? 'Plot 1, Kampala Road, Kampala',
    registrationNumber: process.env.RIS_REG_NUMBER ?? '',
    tin: process.env.RIS_TIN ?? '',
    vatRegistrationNumber: process.env.RIS_VAT_NUMBER ?? '',
    withholdingAgentNumber: process.env.RIS_WHT_AGENT_NUMBER ?? '',
    bankAccount: process.env.RIS_BANK_ACCOUNT ?? '',
    bankName: process.env.RIS_BANK_NAME ?? '',
    contactEmail: process.env.RIS_CONTACT_EMAIL ?? 'support@raphaintegrated.com',
  };
}

function buildBuyerDetails(contact: { company: string }): BuyerDetails {
  return { name: contact.company, address: '' };
}

function toDocSummary(row: EscalationDocumentRow): EscalationDocumentSummary {
  return {
    id: row.id,
    documentType: row.document_type,
    status: row.status,
    draftParams: row.draft_params,
    generatedBy: row.generated_by,
    finalizedBy: row.finalized_by,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

/** Auto-generate a draft after escalation (non-blocking). */
async function autoGenerateDraft(collectionId: string, level: number): Promise<void> {
  const docType = level === 2 ? 'demand_letter' : level === 3 ? 'legal_notice' : null;
  if (!docType) return;
  try {
    await generateDraftDocument(collectionId, docType, 'SYSTEM');
  } catch {
    logger.warn('Auto-draft generation failed', { component: 'collections', collectionId });
  }
}

/** Generate a draft escalation document (demand letter / legal notice). */
export async function generateDraftDocument(
  collectionId: string,
  documentType: string,
  userId: string,
): Promise<string> {
  const existing = await repo.getDocumentByType(collectionId, documentType);
  if (existing && existing.status === 'draft') {
    throw new BusinessRuleError(CollectionErrorCode.DRAFT_ALREADY_EXISTS, 'Draft already exists');
  }
  const detail = await getCollectionDetail(collectionId);
  const draftParams = { deadlineDays: 14, additionalNotes: '' };
  const pdfBuffer = await renderDemandPdf(detail, draftParams);
  return await persistDraftDocument(collectionId, documentType, pdfBuffer, draftParams, userId);
}

/** Render a demand letter PDF from collection detail and draft params. */
async function renderDemandPdf(
  detail: CollectionDetailResponse,
  params: { deadlineDays: number; additionalNotes: string },
): Promise<Buffer> {
  const data: DemandLetterData = {
    ris: getRisDetails(),
    buyer: buildBuyerDetails(detail.buyer_contact),
    letterDate: new Date().toISOString().slice(0, 10),
    invoices: [
      {
        reference: detail.invoice_number,
        dueDate: detail.due_date,
        faceValue: BigInt(detail.face_value),
        penaltyAccrued: BigInt(0),
      },
    ],
    totalOutstanding: BigInt(detail.outstanding_amount),
  };
  void params; // params used for future template customization
  return generateDemandLetter(data);
}

/** Persist a draft document inside a transaction with audit. */
async function persistDraftDocument(
  collectionId: string,
  documentType: string,
  pdfBuffer: Buffer,
  draftParams: Record<string, unknown>,
  userId: string,
): Promise<string> {
  const docId = uuidv4();
  const encrypted = encrypt(pdfBuffer.toString('base64'));
  const fileHash = hashDocument(pdfBuffer);
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.createEscalationDocumentWithClient(client, {
      id: docId,
      collectionId,
      documentType,
      contentEncrypted: encrypted,
      fileHash,
      draftParams,
      generatedBy: userId,
    });
    await repo.createAuditEntry(
      client,
      userId,
      'ESCALATION_DOCUMENT_GENERATED',
      'escalation_documents',
      docId,
      null,
      { documentType, status: 'draft' },
      null,
      null,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  logger.audit('ESCALATION_DOCUMENT_GENERATED', { component: 'collections', documentId: docId });
  return docId;
}

/** Update draft params and regenerate PDF. */
export async function updateDraftParams(
  documentId: string,
  params: { deadlineDays?: number; additionalNotes?: string },
  userId: string,
): Promise<void> {
  const doc = await repo.getEscalationDocumentById(documentId);
  if (!doc) throw new NotFoundError('EscalationDocument', documentId);
  if (doc.status !== 'draft') {
    throw new BusinessRuleError(
      CollectionErrorCode.DOCUMENT_NOT_DRAFT,
      'Only draft documents can be updated',
    );
  }
  const merged = { ...doc.draft_params, ...params };
  const detail = await getCollectionDetail(doc.collection_id);
  const pdfBuffer = await renderDemandPdf(detail, merged);
  await persistDraftUpdate(documentId, pdfBuffer, merged, userId);
}

/** Persist draft update inside a transaction. */
async function persistDraftUpdate(
  documentId: string,
  pdfBuffer: Buffer,
  draftParams: Record<string, unknown>,
  userId: string,
): Promise<void> {
  const encrypted = encrypt(pdfBuffer.toString('base64'));
  const fileHash = hashDocument(pdfBuffer);
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.updateDocumentContentWithClient(
      client,
      documentId,
      encrypted,
      fileHash,
      draftParams,
    );
    await repo.createAuditEntry(
      client,
      userId,
      'ESCALATION_DOCUMENT_UPDATED',
      'escalation_documents',
      documentId,
      null,
      { status: 'draft' },
      null,
      null,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Finalize a draft and queue email to buyer. */
export async function finalizeAndSend(documentId: string, userId: string): Promise<void> {
  const doc = await repo.getEscalationDocumentById(documentId);
  if (!doc) throw new NotFoundError('EscalationDocument', documentId);
  if (doc.status !== 'draft') {
    throw new BusinessRuleError(CollectionErrorCode.DOCUMENT_ALREADY_SENT, 'Document already sent');
  }
  const detail = await getCollectionDetail(doc.collection_id);
  const buyerEmail = detail.buyer_contact.email ?? '';
  await persistFinalization(documentId, userId, buyerEmail);
  await queueDocumentNotification(documentId, doc.collection_id, detail.buyer_id);
}

/** Persist finalization inside a transaction. */
async function persistFinalization(
  documentId: string,
  userId: string,
  buyerEmail: string,
): Promise<void> {
  const emailEncrypted = buyerEmail ? encrypt(buyerEmail) : '';
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.finalizeDocumentWithClient(client, documentId, userId, emailEncrypted);
    await repo.createAuditEntry(
      client,
      userId,
      'ESCALATION_DOCUMENT_SENT',
      'escalation_documents',
      documentId,
      { status: 'draft' },
      { status: 'sent' },
      null,
      null,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  logger.audit('ESCALATION_DOCUMENT_SENT', { component: 'collections', documentId });
}

/** Queue a notification with the document ID (no PII in payload). */
async function queueDocumentNotification(
  documentId: string,
  collectionId: string,
  buyerId: string,
): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', { component: 'collections', documentId });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'escalation-document-sent',
    {
      documentId,
      collectionId,
      buyerId,
      type: 'buyer_document_notify',
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}

/** Decrypt and return a document PDF buffer. */
export async function getDocumentPdf(
  documentId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const doc = await repo.getEscalationDocumentById(documentId);
  if (!doc || !doc.content_encrypted) {
    throw new NotFoundError('EscalationDocument', documentId);
  }
  const base64 = decrypt(doc.content_encrypted);
  const buffer = Buffer.from(base64, 'base64');
  return { buffer, mimeType: doc.mime_type };
}

/** List all documents for a collection. */
export async function listDocuments(collectionId: string): Promise<EscalationDocumentSummary[]> {
  const rows = await repo.listEscalationDocumentsByCollection(collectionId);
  return rows.map(toDocSummary);
}
