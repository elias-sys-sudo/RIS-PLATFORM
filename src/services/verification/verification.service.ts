import crypto from 'crypto';
import { Queue } from 'bullmq';
import { BusinessRuleError, NotFoundError } from '../../shared/errors';
import { beginWithRls } from '../../shared/database/pool';
// decrypt import removed — PII must never be passed to Bull queue data.
// Workers must look up and decrypt PII themselves from buyerId.
import { logger } from '../../shared/logger';
import { enqueueWithContext } from '../../shared/workers/queue-helpers';
import * as repo from './verification.repository';
import { VerificationErrorCode } from './verification.types';
import { getEfrisProvider } from './efris.provider';
import type {
  BuyerConfirmationRequest,
  ConfirmationPageData,
  PendingConfirmationItem,
  InvoiceConfirmationRow,
  DisputeRecord,
  RaiseDisputeInput,
} from './verification.types';
import type { PaginationParams, PaginatedResult } from '../invoices/invoices.types';

const RIS_BANK_DETAILS =
  'Rapha Integrated Solutions | Bank: Stanbic Bank Uganda | ' +
  'Account: 9030XXXXXXXXX | Branch: Kampala Main | ' +
  'Swift: SBICUGKX | Reference: Invoice number';

let notificationQueue: Queue | null = null;
let riskScoringQueue: Queue | null = null;

/**
 * Set the Bull queue for buyer notifications and reminders.
 */
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

/**
 * Set the Bull queue for triggering risk scoring after confirmation.
 */
export function setRiskScoringQueue(queue: Queue): void {
  riskScoringQueue = queue;
}

// =========================================================================
// Token Generation
// =========================================================================

/**
 * Generate a secure confirmation token for an invoice.
 * Stores SHA-256 hash in DB (never the raw token).
 * Queues email to buyer with the raw token in the confirmation link.
 */
export async function generateConfirmationToken(
  invoiceId: string,
  buyerId: string,
  ipAddress: string,
  userAgent: string,
): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);

  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  // Wrap multi-table writes in a transaction
  const client = await repo.getClient();
  try {
    await beginWithRls(client);

    await repo.storeConfirmationTokenWithClient(
      client,
      invoiceId,
      tokenHash,
      expiresAt.toISOString(),
    );

    await repo.createAuditEntryWithClient(
      client,
      null,
      'CONFIRMATION_TOKEN_GENERATED',
      'invoices',
      invoiceId,
      null,
      { buyerId, tokenExpiresAt: expiresAt.toISOString() },
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

  await queueConfirmationEmail(invoiceId, buyerId, rawToken);

  logger.audit('CONFIRMATION_TOKEN_GENERATED', {
    component: 'verification',
    invoiceId,
  });

  return rawToken;
}

// =========================================================================
// Public: Confirmation Page
// =========================================================================

/**
 * Retrieve invoice details for the buyer confirmation page.
 * Validates the token: exists, not expired, not already used.
 */
export async function getConfirmationPageData(rawToken: string): Promise<ConfirmationPageData> {
  const invoice = await validateToken(rawToken);

  const pageRow = await repo.findInvoiceForConfirmationPage(invoice.id);

  if (pageRow === null) {
    throw new NotFoundError('Invoice', invoice.id);
  }

  return {
    invoice_number: pageRow.invoice_number,
    supplier_name: pageRow.supplier_name,
    buyer_name: pageRow.buyer_name,
    face_value: parseInt(pageRow.face_value, 10),
    due_date: pageRow.due_date,
    description: pageRow.description,
    ris_bank_details: RIS_BANK_DETAILS,
  };
}

// =========================================================================
// Public: Confirm Invoice
// =========================================================================

/**
 * Process buyer confirmation of an invoice.
 * All four confirmation fields must be true.
 * Updates invoice status to 'buyer_confirmed' and queues risk scoring.
 */
export async function confirmInvoice(
  rawToken: string,
  confirmation: BuyerConfirmationRequest,
  ip: string,
  userAgent: string,
): Promise<{ invoiceId: string }> {
  const invoice = await validateToken(rawToken);

  validateConfirmationFields(confirmation);

  // Authenticate the invoice against URA EFRIS BEFORE the confirmation
  // transaction runs. If EFRIS rejects, we never transition the invoice.
  await verifyEfris(invoice);

  await runConfirmationTx({
    invoiceId: invoice.id,
    auditAction: 'BUYER_CONFIRMED',
    auditMetadata: { status: 'buyer_confirmed', buyerIp: ip },
    actorUserId: null,
    ip,
    userAgent,
  });

  logger.audit('BUYER_CONFIRMED', {
    component: 'verification',
    invoiceId: invoice.id,
  });

  await queueRiskScoring(invoice.id);

  return { invoiceId: invoice.id };
}

/**
 * Shared confirmation transaction. Flips invoice status from `submitted` to
 * `buyer_confirmed` and writes an audit entry inside the same BEGIN/COMMIT.
 *
 * Single caller (`confirmInvoice`) — buyer clicks the magic-link URL with
 * a valid token. There is no staff bypass: production correctness requires
 * the real buyer to acknowledge the invoice.
 */
async function runConfirmationTx(params: {
  invoiceId: string;
  auditAction: string;
  auditMetadata: Record<string, unknown>;
  actorUserId: string | null;
  ip: string;
  userAgent: string;
}): Promise<void> {
  const client = await repo.getClient();
  try {
    await beginWithRls(client);

    const rowCount = await repo.confirmInvoiceWithClient(
      client,
      params.invoiceId,
      params.ip,
      params.userAgent,
    );

    if (rowCount === 0) {
      throw new BusinessRuleError(
        VerificationErrorCode.TOKEN_ALREADY_USED,
        'This invoice has already been confirmed',
      );
    }

    await repo.createAuditEntryWithClient(
      client,
      params.actorUserId,
      params.auditAction,
      'invoices',
      params.invoiceId,
      { status: 'submitted' },
      params.auditMetadata,
      params.ip,
      params.userAgent,
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
// Admin: Resend Confirmation
// =========================================================================

/**
 * Resend confirmation email for a submitted invoice.
 * Generates a new token, invalidating the previous one.
 */
export async function resendConfirmation(
  invoiceId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const invoice = await repo.findInvoiceById(invoiceId);

  if (invoice === null) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  validateInvoiceForResend(invoice);

  await generateConfirmationToken(invoiceId, invoice.buyer_id, ipAddress, userAgent);

  await repo.createAuditEntry(
    userId,
    'CONFIRMATION_RESENT',
    'invoices',
    invoiceId,
    null,
    { resentBy: userId },
    ipAddress,
    userAgent,
  );

  logger.audit('CONFIRMATION_RESENT', {
    component: 'verification',
    invoiceId,
  });
}

// =========================================================================
// Admin: Pending Confirmations List
// =========================================================================

/**
 * List invoices awaiting buyer confirmation with pagination.
 */
export async function listPendingConfirmations(
  pagination: PaginationParams,
): Promise<PaginatedResult<PendingConfirmationItem>> {
  const { rows, total } = await repo.findPendingConfirmations(pagination);

  const data: PendingConfirmationItem[] = rows.map((row) => ({
    id: row.id,
    invoice_number: row.invoice_number,
    supplier_name: row.supplier_name,
    buyer_name: row.buyer_name,
    face_value: parseInt(row.face_value, 10),
    due_date: row.due_date,
    submitted_at: row.submitted_at,
    hours_since_submission: parseFloat(parseFloat(row.hours_since_submission).toFixed(1)),
  }));

  return {
    data,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages: Math.ceil(total / pagination.limit),
  };
}

// =========================================================================
// Reminder Processing (Bull cron job)
// =========================================================================

/**
 * Process automated reminders for pending confirmations.
 * Called by an hourly Bull recurring job.
 * Sends reminders at T+2 days (48h) and T+5 days (120h), escalates at T+7 (168h).
 */
export async function processReminders(): Promise<void> {
  await processReminderWindow(48, 120, 'CONFIRMATION_REMINDER_T2');
  await processReminderWindow(120, 168, 'CONFIRMATION_REMINDER_T5');
  await processOverdueWindow();
}

// =========================================================================
// Public: Buyer raises dispute during confirmation
// =========================================================================

/**
 * Buyer raises a dispute against an invoice via the confirmation token.
 * Invoice stays in 'submitted' with a dispute record. Notifies credit_officer.
 */
export async function raiseDispute(
  rawToken: string,
  input: RaiseDisputeInput,
  ip: string,
  userAgent: string,
): Promise<DisputeRecord> {
  const invoice = await validateTokenForDispute(rawToken);

  const client = await repo.getClient();
  try {
    await beginWithRls(client);

    const dispute = await repo.createDisputeWithClient(
      client,
      invoice.id,
      invoice.buyer_id,
      input.reason,
      input.dispute_type ?? 'general',
    );

    await repo.createAuditEntryWithClient(
      client,
      null,
      'INVOICE_DISPUTED',
      'invoice_disputes',
      dispute.id,
      null,
      { invoiceId: invoice.id, disputeType: input.dispute_type ?? 'general' },
      ip,
      userAgent,
    );

    await client.query('COMMIT');

    logger.audit('INVOICE_DISPUTED', {
      component: 'verification',
      invoiceId: invoice.id,
      disputeId: dispute.id,
    });

    await queueDisputeNotification(invoice.id, dispute.id);

    return dispute;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function validateTokenForDispute(rawToken: string): Promise<InvoiceConfirmationRow> {
  const tokenHash = hashToken(rawToken);
  const invoice = await repo.findInvoiceByTokenHash(tokenHash);
  if (!invoice) {
    throw new NotFoundError('ConfirmationToken', 'provided');
  }
  if (invoice.status !== 'submitted') {
    throw new BusinessRuleError(
      VerificationErrorCode.INVOICE_NOT_SUBMITTED,
      'Invoice is not in submitted status',
    );
  }
  return invoice;
}

async function queueDisputeNotification(invoiceId: string, disputeId: string): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'verification',
      invoiceId,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'invoice-dispute',
    { invoiceId, disputeId, recipients: ['credit_officer'] },
    { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}

// =========================================================================
// Private helpers
// =========================================================================

/**
 * Call URA EFRIS to verify the invoice was genuinely issued and that the
 * face value stored in RIS matches what URA has on file. Must succeed
 * before a buyer confirmation can transition the invoice.
 */
async function verifyEfris(invoice: InvoiceConfirmationRow): Promise<void> {
  if (invoice.ura_efris_ref === null || invoice.ura_efris_ref === '') {
    throw new BusinessRuleError(
      VerificationErrorCode.EFRIS_NOT_VERIFIED,
      'Invoice has no URA EFRIS reference',
    );
  }

  const provider = getEfrisProvider();
  const result = await provider.verifyReference(invoice.ura_efris_ref, BigInt(invoice.face_value));

  if (!result.verified) {
    logger.warn('EFRIS verification rejected', {
      component: 'verification',
      invoiceId: invoice.id,
      provider: provider.name,
      reason: result.mismatchReason ?? 'unknown',
    });
    throw new BusinessRuleError(
      VerificationErrorCode.EFRIS_NOT_VERIFIED,
      `URA EFRIS verification failed: ${result.mismatchReason ?? 'unknown'}`,
    );
  }
}

/**
 * Hash a raw token using SHA-256.
 */
function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Validate a confirmation token: exists, not used, not expired.
 */
async function validateToken(rawToken: string): Promise<InvoiceConfirmationRow> {
  const tokenHash = hashToken(rawToken);
  const invoice = await repo.findInvoiceByTokenHash(tokenHash);

  if (invoice === null) {
    throw new NotFoundError('ConfirmationToken', 'provided');
  }

  if (invoice.buyer_confirmed_at !== null) {
    throw new BusinessRuleError(
      VerificationErrorCode.TOKEN_ALREADY_USED,
      'This invoice has already been confirmed',
    );
  }

  if (
    invoice.confirmation_token_expires_at === null ||
    invoice.confirmation_token_expires_at === undefined ||
    invoice.confirmation_token_expires_at === ''
  ) {
    throw new BusinessRuleError(
      VerificationErrorCode.TOKEN_EXPIRED,
      'Confirmation token has no expiry — please request a new link.',
    );
  }

  const expiresAt = new Date(invoice.confirmation_token_expires_at);

  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    throw new BusinessRuleError(
      VerificationErrorCode.TOKEN_EXPIRED,
      'Confirmation link has expired. Please contact the credit officer.',
    );
  }

  return invoice;
}

/**
 * Validate all four confirmation fields are true.
 */
function validateConfirmationFields(confirmation: BuyerConfirmationRequest): void {
  const missing: string[] = [];

  if (!confirmation.invoice_is_valid) {
    missing.push('invoice_is_valid');
  }
  if (!confirmation.amount_is_correct) {
    missing.push('amount_is_correct');
  }
  if (!confirmation.due_date_is_correct) {
    missing.push('due_date_is_correct');
  }
  if (!confirmation.agrees_to_pay_ris) {
    missing.push('agrees_to_pay_ris');
  }

  if (missing.length > 0) {
    throw new BusinessRuleError(
      VerificationErrorCode.CONFIRMATION_INCOMPLETE,
      'All confirmation fields must be true',
      { missing },
    );
  }
}

/**
 * Validate invoice is eligible for resending confirmation.
 */
function validateInvoiceForResend(invoice: InvoiceConfirmationRow): void {
  if (invoice.status !== 'submitted') {
    throw new BusinessRuleError(
      VerificationErrorCode.INVOICE_NOT_SUBMITTED,
      'Can only resend confirmation for submitted invoices',
    );
  }

  if (invoice.buyer_confirmed_at !== null) {
    throw new BusinessRuleError(
      VerificationErrorCode.TOKEN_ALREADY_USED,
      'Invoice has already been confirmed by the buyer',
    );
  }
}

/**
 * Queue buyer confirmation email via Bull.
 */
async function queueConfirmationEmail(
  invoiceId: string,
  buyerId: string,
  rawToken: string,
): Promise<void> {
  if (notificationQueue === null) {
    logger.warn('Notification queue not configured — skipping confirmation email', {
      component: 'verification',
      invoiceId,
    });
    return;
  }

  const buyer = await repo.findBuyerEncryptedContact(buyerId);

  if (buyer === null) {
    logger.warn('Buyer not found for confirmation email', {
      component: 'verification',
      invoiceId,
    });
    return;
  }

  await enqueueWithContext(
    notificationQueue,
    'send-buyer-confirmation-email',
    {
      invoiceId,
      buyerId,
      token: rawToken,
    },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    },
  );
}

/**
 * Queue risk scoring job after buyer confirmation.
 */
async function queueRiskScoring(invoiceId: string): Promise<void> {
  if (riskScoringQueue === null) {
    logger.warn('Risk scoring queue not configured — skipping', {
      component: 'verification',
      invoiceId,
    });
    return;
  }

  await enqueueWithContext(
    riskScoringQueue,
    'score-invoice',
    { invoiceId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    },
  );

  logger.audit('RISK_SCORING_QUEUED', {
    component: 'verification',
    invoiceId,
  });
}

/**
 * Process a single reminder time window.
 * Checks audit_logs to avoid duplicate reminders.
 */
async function processReminderWindow(
  minHours: number,
  maxHours: number,
  action: string,
): Promise<void> {
  const invoices = await repo.findInvoicesPendingReminder(minHours, maxHours);

  for (const invoice of invoices) {
    const alreadySent = await repo.hasReminderBeenSent(invoice.id, action);

    if (alreadySent) {
      continue;
    }

    if (notificationQueue !== null) {
      await enqueueWithContext(
        notificationQueue,
        'send-confirmation-reminder',
        {
          invoiceId: invoice.id,
          buyerId: invoice.buyer_id,
          reminderType: action,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30000 },
        },
      );
    }

    await repo.createAuditEntry(
      null,
      action,
      'invoices',
      invoice.id,
      null,
      { reminderType: action, hoursSinceSubmission: minHours },
      'system',
      'system',
    );

    logger.audit(action, {
      component: 'verification',
      invoiceId: invoice.id,
    });
  }
}

/**
 * Process overdue confirmations (T+7 days / 168h+ without response).
 * Creates CONFIRMATION_OVERDUE audit entries and notifies credit officers.
 */
async function processOverdueWindow(): Promise<void> {
  const invoices = await repo.findInvoicesPendingReminder(168, 720);

  for (const invoice of invoices) {
    const alreadyFlagged = await repo.hasReminderBeenSent(invoice.id, 'CONFIRMATION_OVERDUE');

    if (alreadyFlagged) {
      continue;
    }

    await repo.createAuditEntry(
      null,
      'CONFIRMATION_OVERDUE',
      'invoices',
      invoice.id,
      null,
      { invoiceNumber: invoice.invoice_number },
      'system',
      'system',
    );

    if (notificationQueue !== null) {
      await enqueueWithContext(
        notificationQueue,
        'notify-credit-officer-overdue',
        {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoice_number,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30000 },
        },
      );
    }

    logger.audit('CONFIRMATION_OVERDUE', {
      component: 'verification',
      invoiceId: invoice.id,
    });
  }
}
