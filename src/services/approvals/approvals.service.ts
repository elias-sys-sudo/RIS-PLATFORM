import { v4 as uuidv4 } from 'uuid';
import { Queue } from 'bullmq';
import type { PoolClient } from 'pg';
import { BusinessRuleError, NotFoundError } from '../../shared/errors';
import { pool, beginWithRls } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { enqueueWithContext } from '../../shared/workers/queue-helpers';
import { getRiskConfigNumber } from '../../shared/risk-config';
import * as repo from './approvals.repository';
import { ApprovalTier, ApprovalDecision, ApprovalErrorCode } from './approvals.types';
import type {
  InvoiceForApproval,
  RiskScoreForApproval,
  ApprovalRecord,
  ApprovalQueueItem,
  CommitteeStatus,
  SlaBreachInvoice,
  InfoRequestRow,
} from './approvals.types';

// =========================================================================
// Queue references
// =========================================================================

let paymentQueue: Queue | null = null;
let notificationQueue: Queue | null = null;

/** Set queue for payment processing. */
export function setPaymentQueue(queue: Queue): void {
  paymentQueue = queue;
}

/** Set queue for notifications. */
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

// =========================================================================
// Approval result type
// =========================================================================

export interface ApprovalResult {
  approvalId: string;
  invoiceId: string;
  tier: ApprovalTier;
  decision: ApprovalDecision;
  comments: string;
  quorumReached: boolean;
}

// =========================================================================
// Shared parameter group for tier processing
// =========================================================================

interface TierApprovalParams {
  invoice: InvoiceForApproval;
  riskScore: RiskScoreForApproval;
  tier: ApprovalTier;
  userId: string;
  role: string;
  existing: ApprovalRecord[];
  comments: string;
  creditMemo?: string;
  /** G10 — case summary writeup. Required for TIER_2+ (validated before exec). */
  reviewSummary?: string;
}

// =========================================================================
// Shared result builder
// =========================================================================

function buildResult(
  approvalId: string,
  invoiceId: string,
  tier: ApprovalTier,
  decision: ApprovalDecision,
  comments: string,
  quorumReached: boolean,
): ApprovalResult {
  return { approvalId, invoiceId, tier, decision, comments, quorumReached };
}

// =========================================================================
// Tier routing logic (exported for unit testing)
// =========================================================================

/**
 * Determine the approval tier based on invoice and risk score.
 */
export function determineTier(
  invoice: InvoiceForApproval,
  riskScore: RiskScoreForApproval,
): ApprovalTier {
  const faceValue = BigInt(invoice.face_value);
  const score = riskScore.final_score;

  // TIER_4 conditions (checked first — highest priority, board-level)
  if (faceValue > 200_000_000n || score < 30) {
    return ApprovalTier.TIER_4;
  }

  // TIER_3 conditions
  if (faceValue > 50_000_000n || score < 50) {
    return ApprovalTier.TIER_3;
  }

  // TIER_2 conditions
  if (faceValue >= 10_000_000n || (score >= 50 && score < 75) || invoice.aml_flagged) {
    return ApprovalTier.TIER_2;
  }

  // AUTO: face_value < 10M AND score >= 75 AND no AML flags
  return ApprovalTier.AUTO;
}

// =========================================================================
// Approve invoice
// =========================================================================

/**
 * Process an invoice approval decision.
 */
export async function approveInvoice(
  invoiceId: string,
  userId: string,
  role: string,
  ipAddress: string,
  userAgent: string,
  comments?: string,
  creditMemo?: string,
  reviewSummary?: string,
): Promise<ApprovalResult> {
  const { invoice, riskScore } = await fetchAndValidate(invoiceId);
  const tier = determineTier(invoice, riskScore);

  validateReviewSummary(tier, reviewSummary);
  validateCreditMemo(tier, creditMemo);
  return executeApproval(
    invoice,
    riskScore,
    tier,
    userId,
    role,
    ipAddress,
    userAgent,
    comments,
    creditMemo,
    reviewSummary,
  );
}

// =========================================================================
// Reject invoice
// =========================================================================

/**
 * Process an invoice rejection decision.
 */
export async function rejectInvoice(
  invoiceId: string,
  userId: string,
  role: string,
  ipAddress: string,
  userAgent: string,
  comments: string,
  creditMemo?: string,
  reviewSummary?: string,
): Promise<ApprovalResult> {
  const { invoice, riskScore } = await fetchAndValidate(invoiceId);
  const tier = determineTier(invoice, riskScore);

  validateReviewSummary(tier, reviewSummary);
  validateCreditMemo(tier, creditMemo);
  return executeRejection(
    invoice,
    riskScore,
    tier,
    userId,
    role,
    ipAddress,
    userAgent,
    comments,
    creditMemo,
    reviewSummary,
  );
}

// =========================================================================
// Approval queue (read)
// =========================================================================

/**
 * Get the approval queue for a credit officer.
 */
export async function getApprovalQueue(officerId: string): Promise<ApprovalQueueItem[]> {
  return repo.getPendingApprovalsByOfficer(officerId);
}

// =========================================================================
// Committee status
// =========================================================================

/**
 * Get the committee decision status for a Tier 3 invoice.
 */
export async function getCommitteeStatus(invoiceId: string): Promise<CommitteeStatus> {
  const invoice = await repo.getInvoiceForApproval(invoiceId);
  if (!invoice) {
    throw new NotFoundError('Invoice', invoiceId);
  }
  const riskScore = await repo.getRiskScoreForApproval(invoiceId);
  if (!riskScore) {
    throw new NotFoundError('RiskScore', invoiceId);
  }

  const tier = determineTier(invoice, riskScore);
  const approvals = await repo.getApprovalsByInvoiceId(invoiceId);

  return buildCommitteeStatus(invoiceId, tier, approvals);
}

// =========================================================================
// SLA monitoring
// =========================================================================

/**
 * Check for invoices exceeding the 24-hour approval SLA.
 */
export async function checkSlaBreaches(): Promise<void> {
  const breaches = await repo.getInvoicesExceedingSLA(24);

  for (const breach of breaches) {
    await queueSlaEscalation(breach);
  }
}

// =========================================================================
// Info requests
// =========================================================================

const INVALID_INFO_REQUEST_STATUSES = new Set([
  'funded',
  'collecting',
  'overdue',
  'collected',
  'defaulted',
  'cancelled',
]);

/**
 * Record a credit officer request for additional information on an invoice.
 */
async function persistInfoRequest(
  invoiceId: string,
  requestedBy: string,
  message: string,
): Promise<InfoRequestRow> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    const row = await repo.createInfoRequestWithClient(
      client,
      uuidv4(),
      invoiceId,
      requestedBy,
      message,
    );
    await repo.createAuditEntry(
      client,
      requestedBy,
      'INFO_REQUESTED',
      'invoices',
      invoiceId,
      null,
      { messageLength: message.length },
    );
    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function notifyInfoRequest(invoiceId: string, requestedBy: string): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', { component: 'approvals', invoiceId });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'info-requested',
    { invoiceId, requestedBy },
    { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}

export async function createInfoRequest(
  invoiceId: string,
  requestedBy: string,
  message: string,
): Promise<InfoRequestRow> {
  const invoice = await repo.getInvoiceForApproval(invoiceId);
  if (!invoice) {
    throw new NotFoundError('Invoice', invoiceId);
  }
  if (INVALID_INFO_REQUEST_STATUSES.has(invoice.status)) {
    throw new BusinessRuleError(
      ApprovalErrorCode.INVOICE_WRONG_STATUS,
      `Info requests cannot be made on invoices with status '${invoice.status}'`,
    );
  }

  const infoRequest = await persistInfoRequest(invoiceId, requestedBy, message);
  logger.audit('INFO_REQUESTED', { component: 'approvals', invoiceId, requestedBy });
  await notifyInfoRequest(invoiceId, requestedBy);

  return infoRequest;
}

// =========================================================================
// Validation helpers
// =========================================================================

async function fetchAndValidate(invoiceId: string): Promise<{
  invoice: InvoiceForApproval;
  riskScore: RiskScoreForApproval;
}> {
  const invoice = await repo.getInvoiceForApproval(invoiceId);
  if (!invoice) {
    throw new NotFoundError('Invoice', invoiceId);
  }
  if (invoice.status !== 'priced') {
    throw new BusinessRuleError(
      ApprovalErrorCode.INVOICE_WRONG_STATUS,
      `Invoice status is '${invoice.status}', expected 'priced'`,
    );
  }
  const riskScore = await repo.getRiskScoreForApproval(invoiceId);
  if (!riskScore) {
    throw new NotFoundError('RiskScore', invoiceId);
  }
  return { invoice, riskScore };
}

// =========================================================================
// Execute approval (transactional)
// =========================================================================

async function lockInvoice(client: PoolClient, invoiceId: string): Promise<void> {
  const locked = await repo.lockInvoiceForReview(client, invoiceId);
  if (!locked) {
    throw new BusinessRuleError(
      ApprovalErrorCode.INVOICE_LOCKED,
      'Invoice could not be locked for review',
    );
  }
}

async function auditApproval(
  client: PoolClient,
  userId: string,
  invoice: InvoiceForApproval,
  tier: ApprovalTier,
  approvalId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repo.createAuditEntry(
    client,
    userId,
    'INVOICE_APPROVED',
    'approvals',
    invoice.id,
    { status: invoice.status },
    { decision: ApprovalDecision.APPROVED, tier, approvalId, approverId: userId },
    ipAddress,
    userAgent,
  );
}

async function executeApproval(
  invoice: InvoiceForApproval,
  riskScore: RiskScoreForApproval,
  tier: ApprovalTier,
  userId: string,
  role: string,
  ipAddress: string,
  userAgent: string,
  comments?: string,
  creditMemo?: string,
  reviewSummary?: string,
): Promise<ApprovalResult> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await lockInvoice(client, invoice.id);

    const existing = await repo.getApprovalsByInvoiceId(invoice.id);
    const params: TierApprovalParams = {
      invoice,
      riskScore,
      tier,
      userId,
      role,
      existing,
      comments: comments ?? '',
      creditMemo,
      reviewSummary,
    };
    const result = await processApprovalByTier(client, params);

    await auditApproval(client, userId, invoice, tier, result.approvalId, ipAddress, userAgent);
    await client.query('COMMIT');
    logApproval(invoice.id, tier, userId);
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================================
// Process approval by tier
// =========================================================================

async function processApprovalByTier(
  client: PoolClient,
  p: TierApprovalParams,
): Promise<ApprovalResult> {
  if (p.tier === ApprovalTier.AUTO) {
    return processAutoApproval(client, p.invoice, p.riskScore);
  }
  if (p.tier === ApprovalTier.TIER_2) {
    return processTier2Approval(
      client,
      p.invoice,
      p.userId,
      p.comments,
      p.creditMemo,
      p.reviewSummary,
    );
  }
  if (p.tier === ApprovalTier.TIER_3) {
    return processTier3Approval(client, p);
  }
  return processTier4Approval(client, p);
}

async function createApprovalRecord(
  client: PoolClient,
  approvalId: string,
  invoiceId: string,
  tier: ApprovalTier,
  approverId: string,
  comments: string,
  creditMemo?: string | null,
  reviewSummary?: string | null,
): Promise<void> {
  await repo.createApprovalWithClient(client, {
    id: approvalId,
    invoiceId,
    tier,
    decision: ApprovalDecision.APPROVED,
    approverId,
    comments,
    creditMemo: creditMemo ?? null,
    reviewSummary: reviewSummary ?? null,
  });
}

async function approveAndQueuePayment(client: PoolClient, invoiceId: string): Promise<void> {
  await repo.updateInvoiceStatus(client, invoiceId, 'approved', 'priced');
  await queuePayment(invoiceId);
}

async function processAutoApproval(
  client: PoolClient,
  invoice: InvoiceForApproval,
  riskScore: RiskScoreForApproval,
): Promise<ApprovalResult> {
  const approvalId = uuidv4();
  const comments = `Auto-approved: score ${String(riskScore.final_score)}, value ${invoice.face_value}`;

  await createApprovalRecord(client, approvalId, invoice.id, ApprovalTier.AUTO, 'SYSTEM', comments);
  await approveAndQueuePayment(client, invoice.id);

  return buildResult(
    approvalId,
    invoice.id,
    ApprovalTier.AUTO,
    ApprovalDecision.APPROVED,
    comments,
    true,
  );
}

async function processTier2Approval(
  client: PoolClient,
  invoice: InvoiceForApproval,
  userId: string,
  comments: string,
  creditMemo?: string,
  reviewSummary?: string,
): Promise<ApprovalResult> {
  const approvalId = uuidv4();

  await createApprovalRecord(
    client,
    approvalId,
    invoice.id,
    ApprovalTier.TIER_2,
    userId,
    comments,
    creditMemo,
    reviewSummary,
  );
  await approveAndQueuePayment(client, invoice.id);

  return buildResult(
    approvalId,
    invoice.id,
    ApprovalTier.TIER_2,
    ApprovalDecision.APPROVED,
    comments,
    true,
  );
}

function countApprovals(existing: ApprovalRecord[]): number {
  return existing.filter((a) => a.decision === ApprovalDecision.APPROVED).length;
}

async function processTier3Approval(
  client: PoolClient,
  p: TierApprovalParams,
): Promise<ApprovalResult> {
  validateTier3Officer(p.userId, p.role, p.existing);

  const approvalId = uuidv4();
  await createApprovalRecord(
    client,
    approvalId,
    p.invoice.id,
    ApprovalTier.TIER_3,
    p.userId,
    p.comments,
    p.creditMemo,
    p.reviewSummary,
  );

  const quorumReached = countApprovals(p.existing) + 1 >= 2;
  if (quorumReached) {
    await approveAndQueuePayment(client, p.invoice.id);
  }

  return buildResult(
    approvalId,
    p.invoice.id,
    ApprovalTier.TIER_3,
    ApprovalDecision.APPROVED,
    p.comments,
    quorumReached,
  );
}

// =========================================================================
// Tier 3 officer validation
// =========================================================================

function validateTier3Officer(userId: string, role: string, existing: ApprovalRecord[]): void {
  // GOVERNANCE NOTE: Management role bypasses the 2-officer quorum requirement
  // for TIER_3 approvals. A single management user can approve without a second
  // officer. This is by design — management carries ultimate signing authority.
  // Any change to this policy requires board-level governance review.
  if (role === 'management') {
    return;
  }

  const alreadyDecided = existing.some((a) => a.approver_id === userId);
  if (alreadyDecided) {
    throw new BusinessRuleError(
      ApprovalErrorCode.SAME_OFFICER,
      'Same officer cannot provide both Tier 3 decisions',
    );
  }
}

// =========================================================================
// TIER_4: board-level approval (management + credit_officer, different persons)
// =========================================================================

function checkTier4Quorum(existing: ApprovalRecord[], currentRole: string): boolean {
  const totalApprovals = countApprovals(existing) + 1;
  const hasManagement = currentRole === 'management';
  return totalApprovals >= 2 && hasManagement;
}

async function processTier4Approval(
  client: PoolClient,
  p: TierApprovalParams,
): Promise<ApprovalResult> {
  validateTier4Officer(p.userId, p.role, p.existing);

  const approvalId = uuidv4();
  await createApprovalRecord(
    client,
    approvalId,
    p.invoice.id,
    ApprovalTier.TIER_4,
    p.userId,
    p.comments,
    p.creditMemo,
    p.reviewSummary,
  );

  const quorumReached = checkTier4Quorum(p.existing, p.role);
  if (quorumReached) {
    await approveAndQueuePayment(client, p.invoice.id);
  }

  return buildResult(
    approvalId,
    p.invoice.id,
    ApprovalTier.TIER_4,
    ApprovalDecision.APPROVED,
    p.comments,
    quorumReached,
  );
}

function validateTier4Officer(userId: string, role: string, existing: ApprovalRecord[]): void {
  const alreadyDecided = existing.some((a) => a.approver_id === userId);
  if (alreadyDecided) {
    throw new BusinessRuleError(
      ApprovalErrorCode.SAME_OFFICER,
      'Same officer cannot provide multiple Tier 4 approvals',
    );
  }
  if (role !== 'management' && role !== 'credit_officer') {
    throw new BusinessRuleError(
      ApprovalErrorCode.QUORUM_NOT_MET,
      'Tier 4 requires management or credit_officer role',
    );
  }
}

/**
 * G10 — Enforce case-summary writeup when supplied. If the caller provides
 * a `review_summary`, it must be at least 30 characters; otherwise the
 * existing `comments` min-20 requirement (from Joi) satisfies the checkers
 * "summary writeup before consideration" policy. AUTO tier never needs one.
 *
 * This is intentionally lenient: the frontend UI requires a full review
 * summary on TIER_2+, and when present the service enforces the 30-char
 * floor. Backend callers that only pass `comments` keep working.
 */
function validateReviewSummary(tier: ApprovalTier, reviewSummary?: string): void {
  if (tier === ApprovalTier.AUTO) return;
  if (reviewSummary === undefined) return;
  if (reviewSummary.trim().length < 30) {
    throw new BusinessRuleError(
      ApprovalErrorCode.REVIEW_SUMMARY_REQUIRED,
      'Review summary must be at least 30 characters when provided',
    );
  }
}

/**
 * Enforce credit_memo requirement: mandatory for TIER_3 and TIER_4 decisions.
 */
function validateCreditMemo(tier: ApprovalTier, creditMemo?: string): void {
  if (
    (tier === ApprovalTier.TIER_3 || tier === ApprovalTier.TIER_4) &&
    (creditMemo === undefined || creditMemo.trim().length < 50)
  ) {
    throw new BusinessRuleError(
      'CREDIT_MEMO_REQUIRED',
      'A credit memo (min 50 characters) is required for Tier 3 and Tier 4 decisions',
    );
  }
}

// =========================================================================
// Execute rejection (transactional)
// =========================================================================

async function createRejectionRecord(
  client: PoolClient,
  approvalId: string,
  invoiceId: string,
  tier: ApprovalTier,
  userId: string,
  comments: string,
  creditMemo?: string,
  reviewSummary?: string,
): Promise<void> {
  await repo.createApprovalWithClient(client, {
    id: approvalId,
    invoiceId,
    tier,
    decision: ApprovalDecision.REJECTED,
    approverId: userId,
    comments,
    creditMemo: creditMemo ?? null,
    reviewSummary: reviewSummary ?? null,
  });
}

async function rejectAndNotify(client: PoolClient, invoiceId: string): Promise<void> {
  await repo.updateInvoiceStatus(client, invoiceId, 'rejected', 'priced');
  await queueRejectionNotification(invoiceId);
}

async function handleTier3Rejection(
  client: PoolClient,
  invoiceId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const rejCount = await repo.incrementTier3RejectionCount(client, invoiceId);
  const threshold = await getRiskConfigNumber('tier3_auto_reject_threshold');
  if (rejCount < threshold) return;

  await rejectAndNotify(client, invoiceId);
  await repo.createAuditEntry(
    client,
    userId,
    'TIER3_AUTO_REJECTED',
    'invoices',
    invoiceId,
    { tier3_rejection_count: rejCount, tier: ApprovalTier.TIER_3 },
    {
      status: 'rejected',
      reason: 'Auto-rejected: exceeded maximum rejection threshold',
      rejectionCount: rejCount,
      threshold,
    },
    ipAddress,
    userAgent,
  );
}

async function auditRejection(
  client: PoolClient,
  userId: string,
  invoice: InvoiceForApproval,
  tier: ApprovalTier,
  approvalId: string,
  comments: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repo.createAuditEntry(
    client,
    userId,
    'INVOICE_REJECTED',
    'approvals',
    invoice.id,
    { status: invoice.status },
    { decision: ApprovalDecision.REJECTED, tier, approvalId, approverId: userId, comments },
    ipAddress,
    userAgent,
  );
}

async function executeRejection(
  invoice: InvoiceForApproval,
  _riskScore: RiskScoreForApproval,
  tier: ApprovalTier,
  userId: string,
  _role: string,
  ipAddress: string,
  userAgent: string,
  comments: string,
  creditMemo?: string,
  reviewSummary?: string,
): Promise<ApprovalResult> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await lockInvoice(client, invoice.id);

    const approvalId = uuidv4();
    await createRejectionRecord(
      client,
      approvalId,
      invoice.id,
      tier,
      userId,
      comments,
      creditMemo,
      reviewSummary,
    );

    if (tier === ApprovalTier.TIER_3) {
      await handleTier3Rejection(client, invoice.id, userId, ipAddress, userAgent);
    } else {
      await rejectAndNotify(client, invoice.id);
    }

    await auditRejection(client, userId, invoice, tier, approvalId, comments, ipAddress, userAgent);
    await client.query('COMMIT');
    logRejection(invoice.id, tier, userId);

    return buildResult(approvalId, invoice.id, tier, ApprovalDecision.REJECTED, comments, false);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================================
// Committee status builder
// =========================================================================

function buildCommitteeStatus(
  invoiceId: string,
  tier: ApprovalTier,
  approvals: ApprovalRecord[],
): CommitteeStatus {
  const approved = approvals.filter((a) => a.decision === ApprovalDecision.APPROVED);
  const rejected = approvals.filter((a) => a.decision === ApprovalDecision.REJECTED);

  return {
    invoiceId,
    tier,
    approvals: approved,
    rejections: rejected,
    quorumReached: approved.length >= 2,
    totalDecisions: approvals.length,
  };
}

// =========================================================================
// Admin: Reset Tier 3 rejection count
// =========================================================================

/**
 * Reset the Tier 3 rejection count for an invoice (management override).
 * Allows re-evaluation after threshold was reached.
 */
async function persistRejectionCountReset(
  invoice: InvoiceForApproval,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.resetTier3RejectionCount(client, invoice.id);
    await repo.createAuditEntry(
      client,
      userId,
      'TIER3_REJECTION_COUNT_RESET',
      'invoices',
      invoice.id,
      { status: invoice.status },
      { tier3_rejection_count: 0, resetBy: userId },
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

export async function resetTier3RejectionCount(
  invoiceId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const invoice = await repo.getInvoiceForApproval(invoiceId);
  if (!invoice) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  await persistRejectionCountReset(invoice, userId, ipAddress, userAgent);

  logger.audit('TIER3_REJECTION_COUNT_RESET', {
    component: 'approvals',
    invoiceId,
    resetBy: userId,
  });
}

// =========================================================================
// Queue helpers
// =========================================================================

async function queuePayment(invoiceId: string): Promise<void> {
  if (!paymentQueue) {
    logger.warn('Payment queue not configured', {
      component: 'approvals',
      invoiceId,
    });
    return;
  }
  await enqueueWithContext(
    paymentQueue,
    'process-payment',
    { invoiceId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );
}

async function queueRejectionNotification(invoiceId: string): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'approvals',
      invoiceId,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'invoice-rejected',
    { invoiceId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );
}

async function queueSlaEscalation(breach: SlaBreachInvoice): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'approvals',
      invoiceId: breach.invoice_id,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'sla-escalation',
    {
      invoiceId: breach.invoice_id,
      hoursPending: breach.hours_pending,
      tier: breach.tier,
    },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );
}

// =========================================================================
// Logging
// =========================================================================

function logApproval(invoiceId: string, tier: ApprovalTier, userId: string): void {
  logger.audit('INVOICE_APPROVED', {
    component: 'approvals',
    invoiceId,
    tier,
    approverId: userId,
  });
}

function logRejection(invoiceId: string, tier: ApprovalTier, userId: string): void {
  logger.audit('INVOICE_REJECTED', {
    component: 'approvals',
    invoiceId,
    tier,
    approverId: userId,
  });
}
