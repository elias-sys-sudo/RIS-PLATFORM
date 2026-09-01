import { v4 as uuidv4 } from 'uuid';
import type { Queue } from 'bullmq';
import type { PoolClient } from 'pg';
import { pool, beginWithRls } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { BusinessRuleError, NotFoundError, PaymentError } from '../../shared/errors';
import { enqueueWithContext } from '../../shared/workers/queue-helpers';
import * as repo from './payments.repository';
import { checkCoverageRatio } from '../collateral/collateral.service';
import { getActiveFacilities } from '../facilities/facilities.repository';
import { PaymentStatus, PaymentProvider, PaymentErrorCode } from './payments.types';
import type {
  PaymentRecord,
  EnrichedPaymentRecord,
  IPaymentProvider,
  PaymentProviderResult,
} from './payments.types';

// =========================================================================
// Provider registry
// =========================================================================

const providers = new Map<PaymentProvider, IPaymentProvider>();

/**
 * Register a payment provider adapter.
 */
export function registerProvider(provider: IPaymentProvider): void {
  providers.set(provider.name, provider);
}

// =========================================================================
// Queue references
// =========================================================================

let notificationQueue: Queue | null = null;
let facilityDrawdownQueue: Queue | null = null;
let collectionMonitoringQueue: Queue | null = null;

/**
 * Set the notification queue for supplier alerts.
 */
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

/**
 * Set the facility drawdown queue for auto-drawdown after funding.
 */
export function setFacilityDrawdownQueue(queue: Queue): void {
  facilityDrawdownQueue = queue;
}

/**
 * Set the collection-monitoring queue. Payments enqueues onto this queue
 * after a funded webhook commits, so the collections module can transition
 * the invoice from funded → collecting (issue #35).
 */
export function setCollectionMonitoringQueue(queue: Queue): void {
  collectionMonitoringQueue = queue;
}

// =========================================================================
// AML gate threshold (100M UGX default, configurable via env)
// =========================================================================

const AML_FLAG_THRESHOLD_UGX = BigInt(process.env.AML_FLAG_THRESHOLD_UGX ?? '100000000');

// =========================================================================
// Step 1: Initiate payment on approval
// =========================================================================

/**
 * Check the payment kill switch. Throws if payments are suspended.
 */
async function checkKillSwitch(): Promise<void> {
  const value = await repo.getSystemSetting('payment_kill_switch');
  if (value === 'true') {
    throw new BusinessRuleError(
      PaymentErrorCode.PAYMENTS_HALTED,
      'All payments are currently suspended by management',
    );
  }
}

/**
 * REQ-PAYMENT-010 — public read of the kill switch state. Used by the
 * GET /payments/kill-switch endpoint so management/finance/auditor can
 * see the current toggle without inspecting the database directly.
 */
export async function isKillSwitchActive(): Promise<boolean> {
  return (await repo.getSystemSetting('payment_kill_switch')) === 'true';
}

/**
 * REQ-PAYMENT-010 — activate the kill switch and halt currently-executing
 * payments in one transaction. Audits per-payment so the cascade is
 * traceable, then logs the activation itself. management-only at the route.
 */
export async function activateKillSwitch(
  userId: string,
  reason: string,
  ipAddress: string,
  userAgent: string,
): Promise<{ activated: boolean; suspendedPaymentIds: string[] }> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.setSystemSettingWithClient(client, 'payment_kill_switch', 'true');
    const suspendedIds = await repo.failExecutingPaymentsWithClient(
      client,
      'Suspended by payment kill switch',
    );
    for (const paymentId of suspendedIds) {
      await repo.createAuditEntryWithClient(
        client,
        userId,
        'PAYMENT_FAILED',
        'payments',
        paymentId,
        { status: 'executing' },
        { status: 'failed', reason: 'kill_switch_activation' },
        ipAddress,
        userAgent,
      );
    }
    await repo.createAuditEntryWithClient(
      client,
      userId,
      'KILL_SWITCH_ACTIVATED',
      'system_settings',
      'payment_kill_switch',
      { active: false },
      { active: true, reason, suspendedCount: suspendedIds.length },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
    logger.audit('KILL_SWITCH_ACTIVATED', {
      component: 'payments',
      userId,
      suspendedCount: suspendedIds.length,
    });
    return { activated: true, suspendedPaymentIds: suspendedIds };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * REQ-PAYMENT-010 — deactivate the kill switch. Does NOT auto-resume the
 * failed payments — finance_manager retries each one manually so dual-auth
 * is enforced on every resumption.
 */
export async function deactivateKillSwitch(
  userId: string,
  reason: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.setSystemSettingWithClient(client, 'payment_kill_switch', 'false');
    await repo.createAuditEntryWithClient(
      client,
      userId,
      'KILL_SWITCH_DEACTIVATED',
      'system_settings',
      'payment_kill_switch',
      { active: true },
      { active: false, reason },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
    logger.audit('KILL_SWITCH_DEACTIVATED', { component: 'payments', userId });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Create a payment record from an approved invoice.
 * Uses supplier's preferred_payment_method as provider.
 */
export async function initiatePayment(invoiceId: string): Promise<PaymentRecord> {
  await checkKillSwitch();

  const invoice = await validateInvoiceForPayment(invoiceId);
  await checkFacilityAvailability(invoice.advance_amount);

  const existing = await repo.getPaymentByInvoiceId(invoiceId);
  if (existing) {
    return existing;
  }

  const paymentId = uuidv4();
  const idempotencyKey = uuidv4();
  const provider = mapProvider(invoice.preferred_payment_method);

  await createPaymentTxn(paymentId, invoiceId, invoice, provider, idempotencyKey);

  return fetchCreatedPayment(paymentId);
}

/**
 * Validate invoice eligibility: status, AML, and collateral coverage.
 */
async function validateInvoiceForPayment(invoiceId: string): Promise<{
  advance_amount: string;
  face_value: string;
  status: string;
  preferred_payment_method: string;
  aml_flagged: boolean;
  aml_cleared_at: string | null;
}> {
  const invoice = await repo.getInvoiceForPayment(invoiceId);
  if (!invoice) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  guardInvoiceApproved(invoice);
  guardAmlCleared(invoice);
  await guardCollateralSufficient(invoiceId, invoice.advance_amount);

  return invoice;
}

function guardInvoiceApproved(invoice: { status: string }): void {
  if (invoice.status !== 'approved') {
    throw new BusinessRuleError(
      PaymentErrorCode.INVOICE_WRONG_STATUS,
      `Invoice status is '${invoice.status}', expected 'approved'`,
    );
  }
}

/**
 * Block disbursement when an over-threshold invoice is AML-flagged AND has
 * not yet been cleared by a compliance officer. An invoice that was flagged
 * but later cleared (aml_cleared_at IS NOT NULL) passes this guard.
 */
function guardAmlCleared(invoice: {
  face_value: string;
  aml_flagged: boolean;
  aml_cleared_at: string | null;
}): void {
  const overThreshold = BigInt(invoice.face_value) >= AML_FLAG_THRESHOLD_UGX;
  const requiresClearance = overThreshold && invoice.aml_flagged;
  const isCleared = invoice.aml_cleared_at !== null;
  if (requiresClearance && !isCleared) {
    throw new BusinessRuleError(
      PaymentErrorCode.AML_FLAG_REQUIRED,
      'Invoice requires compliance clearance before payment',
    );
  }
}

async function guardCollateralSufficient(invoiceId: string, advanceAmount: string): Promise<void> {
  const coverage = await checkCoverageRatio(invoiceId, advanceAmount);
  if (!coverage.sufficient) {
    throw new BusinessRuleError(
      PaymentErrorCode.COLLATERAL_INSUFFICIENT,
      `Collateral coverage ratio ${coverage.ratio.toFixed(2)} is below minimum 0.50`,
    );
  }
}

/**
 * Create payment record + transition invoice approved → pending_first_auth
 * inside a single transaction. The status update is guarded by
 * WHERE id=$1 AND status='approved', so a concurrent transition by a
 * second worker is a no-op (logs warn post-commit; payment row still
 * committed so the finance_manager queue picks it up).
 */
async function createPaymentTxn(
  paymentId: string,
  invoiceId: string,
  invoice: { advance_amount: string; status: string },
  provider: PaymentProvider,
  idempotencyKey: string,
): Promise<void> {
  const client = await pool.connect();
  let transitioned: Record<string, unknown> | null = null;
  try {
    await beginWithRls(client);
    transitioned = await insertPaymentAndAuditWithClient(
      client,
      paymentId,
      invoiceId,
      invoice,
      provider,
      idempotencyKey,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (!transitioned) {
    logger.warn('Invoice already past approved status — possible duplicate payment row', {
      component: 'payments',
      invoiceId,
      paymentId,
    });
  }
  logger.audit('PAYMENT_CREATED', { component: 'payments', paymentId, invoiceId });
}

/**
 * Insert payment row, transition invoice status, and write the audit entry —
 * all on the supplied client so they share the createPaymentTxn transaction.
 */
async function insertPaymentAndAuditWithClient(
  client: PoolClient,
  paymentId: string,
  invoiceId: string,
  invoice: { advance_amount: string; status: string },
  provider: PaymentProvider,
  idempotencyKey: string,
): Promise<Record<string, unknown> | null> {
  await repo.createPaymentWithClient(client, {
    id: paymentId,
    invoiceId,
    amount: invoice.advance_amount,
    provider,
    idempotencyKey,
  });
  const transitioned = await repo.updateInvoiceStatusWithClient(
    client,
    invoiceId,
    PaymentStatus.PENDING_FIRST_AUTH,
    'approved',
  );
  await repo.createAuditEntryWithClient(
    client,
    null,
    'PAYMENT_CREATED',
    'payments',
    paymentId,
    { invoiceStatus: invoice.status, paymentStatus: null },
    {
      invoiceStatus: PaymentStatus.PENDING_FIRST_AUTH,
      paymentStatus: PaymentStatus.PENDING_FIRST_AUTH,
      provider,
    },
  );
  return transitioned;
}

/**
 * Fetch the just-created payment record, throwing if missing.
 */
async function fetchCreatedPayment(paymentId: string): Promise<PaymentRecord> {
  const created = await repo.getPaymentById(paymentId);
  if (!created) {
    throw new PaymentError('Payment creation failed', { paymentId });
  }
  return created;
}

/**
 * Loud terminal-failure handler called by the BullMQ process-payment worker
 * after `attempts` retries are exhausted. The invoice is still in 'approved'
 * status with no payment row — root CLAUDE.md non-negotiable #12 requires
 * audit + finance_manager notification on exhausted external-API retries,
 * so the missed payment surfaces to a human instead of dying in stderr.
 *
 * PII-free: invoiceId + errorCode only — never the supplier name, buyer
 * name, or any provider response body.
 */
export async function handleTerminalWorkerFailure(
  invoiceId: string,
  errorCode: string,
): Promise<void> {
  await writeTerminalFailureAudit(invoiceId, errorCode);
  logger.audit('PAYMENT_INITIATION_FAILED', {
    component: 'payments',
    invoiceId,
    errorCode,
  });
  await notifyWorkerExhaustion(invoiceId);
}

async function writeTerminalFailureAudit(invoiceId: string, errorCode: string): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.createAuditEntryWithClient(
      client,
      null,
      'PAYMENT_INITIATION_FAILED',
      'invoices',
      invoiceId,
      { status: 'approved' },
      { errorCode, retriesExhausted: true },
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function notifyWorkerExhaustion(invoiceId: string): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured — terminal failure not surfaced', {
      component: 'payments',
      invoiceId,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'payment_failed',
    {
      invoiceId,
      type: 'finance_manager_notify',
      reason: 'worker_retries_exhausted',
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}

// =========================================================================
// Step 2: First authorisation
// =========================================================================

/**
 * Record first dual-auth by a finance_manager.
 * Checks 2FA recency and flags after-hours operations.
 * Uses FOR UPDATE NOWAIT to prevent concurrent authorisation races.
 */
export async function authoriseFirstAuth(
  paymentId: string,
  userId: string,
  ipAddress?: string,
  userAgent?: string,
  comment?: string | null,
): Promise<PaymentRecord> {
  await check2faRecency(userId);
  await checkBusinessHours(userId, paymentId, ipAddress, userAgent);

  const updated = await recordFirstAuthTxn(
    paymentId,
    userId,
    ipAddress,
    userAgent,
    comment ?? null,
  );

  logger.audit('PAYMENT_FIRST_AUTH', { component: 'payments', paymentId, userId });
  return updated;
}

/**
 * Lock payment, validate status, record first auth inside a transaction.
 */
async function recordFirstAuthTxn(
  paymentId: string,
  userId: string,
  ipAddress: string | undefined,
  userAgent: string | undefined,
  comment: string | null,
): Promise<PaymentRecord> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    const payment = await lockPaymentOrThrow(client, paymentId);
    validatePaymentStatus(payment, PaymentStatus.PENDING_FIRST_AUTH);

    const updated = await repo.recordFirstAuthWithClient(client, paymentId, userId);
    if (!updated) {
      throw new PaymentError('First auth update failed', { paymentId });
    }

    await repo.createAuditEntryWithClient(
      client,
      userId,
      'PAYMENT_FIRST_AUTH',
      'payments',
      paymentId,
      { status: PaymentStatus.PENDING_FIRST_AUTH },
      { status: PaymentStatus.PENDING_SECOND_AUTH, authUser: userId, comment },
      ipAddress ?? null,
      userAgent ?? null,
    );

    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================================
// Step 3: Second authorisation
// =========================================================================

/**
 * Record second dual-auth by a different finance_manager.
 * Enforces dual_auth_user_1 != dual_auth_user_2.
 * Checks 2FA recency and flags after-hours operations.
 * Uses FOR UPDATE NOWAIT to prevent concurrent authorisation races.
 * executePayment is called AFTER commit — it acquires its own transaction.
 */
export async function authoriseSecondAuth(
  paymentId: string,
  userId: string,
  ipAddress?: string,
  userAgent?: string,
  comment?: string | null,
): Promise<PaymentRecord> {
  await check2faRecency(userId);
  await checkBusinessHours(userId, paymentId, ipAddress, userAgent);

  const updated = await recordSecondAuthTxn(
    paymentId,
    userId,
    ipAddress,
    userAgent,
    comment ?? null,
  );

  logger.audit('PAYMENT_SECOND_AUTH', { component: 'payments', paymentId, userId });
  return updated;
}

/**
 * Lock payment, enforce dual-auth constraint, record second auth inside a transaction.
 */
async function recordSecondAuthTxn(
  paymentId: string,
  userId: string,
  ipAddress: string | undefined,
  userAgent: string | undefined,
  comment: string | null,
): Promise<PaymentRecord> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    const payment = await lockPaymentOrThrow(client, paymentId);
    validatePaymentStatus(payment, PaymentStatus.PENDING_SECOND_AUTH);
    guardDifferentAuthoriser(payment, userId);

    const result = await repo.recordSecondAuthWithClient(client, paymentId, userId);
    if (!result) {
      throw new PaymentError('Second auth update failed', { paymentId });
    }

    await repo.createAuditEntryWithClient(
      client,
      userId,
      'PAYMENT_SECOND_AUTH',
      'payments',
      paymentId,
      { status: PaymentStatus.PENDING_SECOND_AUTH },
      { status: PaymentStatus.EXECUTING, authUser: userId, comment },
      ipAddress ?? null,
      userAgent ?? null,
    );

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Enforce that the second authoriser differs from the first.
 */
function guardDifferentAuthoriser(payment: PaymentRecord, userId: string): void {
  if (payment.dual_auth_user_1 === userId) {
    throw new BusinessRuleError(
      PaymentErrorCode.SAME_AUTHORISER,
      'Same user cannot provide both authorisations',
    );
  }
}

// =========================================================================
// Step 4: Execute payment via provider
// =========================================================================

/**
 * Execute the payment through the appropriate provider.
 * Uses idempotency key to prevent duplicate payments.
 */
export async function executePayment(paymentId: string): Promise<PaymentProviderResult> {
  const payment = await loadExecutablePayment(paymentId);

  const idempotentResult = await checkIdempotency(payment);
  if (idempotentResult) {
    return idempotentResult;
  }

  const provider = resolveProvider(payment);
  return callProviderAndHandle(payment, provider);
}

/**
 * Load payment and guard that it is in EXECUTING status.
 */
async function loadExecutablePayment(paymentId: string): Promise<PaymentRecord> {
  const payment = await repo.getPaymentById(paymentId);
  if (!payment) {
    throw new NotFoundError('Payment', paymentId);
  }
  if (payment.status !== (PaymentStatus.EXECUTING as string)) {
    throw new BusinessRuleError(
      PaymentErrorCode.PAYMENT_WRONG_STATUS,
      `Payment status is '${payment.status}', expected '${PaymentStatus.EXECUTING}'`,
    );
  }
  return payment;
}

/**
 * Return existing funded result if idempotency key was already used.
 */
async function checkIdempotency(payment: PaymentRecord): Promise<PaymentProviderResult | null> {
  const existing = await repo.getByIdempotencyKey(payment.idempotency_key);
  if (existing && existing.status === (PaymentStatus.FUNDED as string)) {
    return {
      success: true,
      transactionReference: existing.transaction_reference ?? '',
      providerReference: existing.provider_reference ?? '',
    };
  }
  return null;
}

/**
 * Resolve the registered provider for a payment, throwing if missing.
 */
function resolveProvider(payment: PaymentRecord): IPaymentProvider {
  const provider = providers.get(payment.provider as PaymentProvider);
  if (!provider) {
    throw new PaymentError(`No provider registered for ${payment.provider}`, {
      paymentId: payment.id,
    });
  }
  return provider;
}

/**
 * Call the provider and route the result to the appropriate handler.
 */
async function callProviderAndHandle(
  payment: PaymentRecord,
  provider: IPaymentProvider,
): Promise<PaymentProviderResult> {
  try {
    const result = await provider.execute(payment, payment.idempotency_key);
    await routeProviderResult(payment, result);
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const failResult: PaymentProviderResult = {
      success: false,
      transactionReference: payment.idempotency_key,
      providerReference: '',
      failureReason: message,
    };
    await handleFailedPayment(payment, failResult);
    return failResult;
  }
}

/**
 * Route a provider result to the correct handler.
 */
async function routeProviderResult(
  payment: PaymentRecord,
  result: PaymentProviderResult,
): Promise<void> {
  if (result.success && result.pendingConfirmation) {
    await handlePendingConfirmation(payment, result);
  } else if (result.success) {
    await handleSuccessfulPayment(payment, result);
  } else {
    await handleFailedPayment(payment, result);
  }
}

// =========================================================================
// Step 5: SLA monitoring
// =========================================================================

/**
 * Check for payments approaching 72-hour SLA breach.
 * Triggers escalation to MD for payments within 6 hours of breach.
 */
export async function checkSlaBreaches(): Promise<void> {
  const breaches = await repo.getPaymentsPendingSLA();

  for (const breach of breaches) {
    await repo.createAuditEntry(
      null,
      'PAYMENT_SLA_BREACH',
      'payments',
      breach.id,
      { hoursPending: breach.hours_pending, status: breach.status },
      { escalatedTo: 'management', slaDeadlineHours: 72 },
    );

    logger.audit('PAYMENT_SLA_BREACH', {
      component: 'payments',
      paymentId: breach.id,
      invoiceId: breach.invoice_id,
      hoursPending: breach.hours_pending,
    });

    await queueSlaEscalation(breach.id, breach.invoice_id);
  }
}

// =========================================================================
// Read operations
// =========================================================================

/**
 * Get all payments in pending auth states — enriched with supplier/buyer/user names.
 */
export async function getPendingPayments(): Promise<EnrichedPaymentRecord[]> {
  return repo.getEnrichedPaymentsByStatuses([
    PaymentStatus.PENDING_FIRST_AUTH,
    PaymentStatus.PENDING_SECOND_AUTH,
  ]);
}

/**
 * Get payment details by ID — enriched with supplier/buyer/user names.
 */
export async function getPaymentDetails(paymentId: string): Promise<EnrichedPaymentRecord> {
  const payment = await repo.getEnrichedPaymentById(paymentId);
  if (!payment) {
    throw new NotFoundError('Payment', paymentId);
  }
  return payment;
}

// =========================================================================
// Internal helpers
// =========================================================================

const PG_LOCK_NOT_AVAILABLE = '55P03';

async function lockPaymentOrThrow(client: PoolClient, paymentId: string): Promise<PaymentRecord> {
  try {
    const payment = await repo.getPaymentByIdForUpdate(client, paymentId);
    if (!payment) {
      throw new NotFoundError('Payment', paymentId);
    }
    return payment;
  } catch (err: unknown) {
    const pgCode = (err as { code?: string }).code;
    if (pgCode === PG_LOCK_NOT_AVAILABLE) {
      throw new BusinessRuleError(
        PaymentErrorCode.PAYMENT_WRONG_STATUS,
        'Payment is being processed by another authoriser',
      );
    }
    throw err;
  }
}

function validatePaymentStatus(payment: PaymentRecord, expected: PaymentStatus): void {
  if (payment.status !== (expected as string)) {
    throw new BusinessRuleError(
      PaymentErrorCode.PAYMENT_WRONG_STATUS,
      `Payment status is '${payment.status}', expected '${expected}'`,
    );
  }
}

async function handleSuccessfulPayment(
  payment: PaymentRecord,
  result: PaymentProviderResult,
): Promise<void> {
  await recordSuccessfulPaymentTxn(payment, result);
  await notifyPaymentFunded(payment);
}

/**
 * Mark payment as funded and advance invoice status inside a transaction.
 */
async function recordSuccessfulPaymentTxn(
  payment: PaymentRecord,
  result: PaymentProviderResult,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    await repo.updatePaymentResultWithClient(client, payment.id, result);
    await repo.updateInvoiceStatusWithClient(client, payment.invoice_id, 'funded', 'approved');

    await repo.createAuditEntryWithClient(
      client,
      null,
      'PAYMENT_FUNDED',
      'payments',
      payment.id,
      { status: payment.status },
      { status: PaymentStatus.FUNDED, transactionReference: result.transactionReference },
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Post-commit: log, notify supplier, queue facility drawdown,
 * and start collection monitoring (issue #35 — funded → collecting).
 */
async function notifyPaymentFunded(payment: PaymentRecord): Promise<void> {
  logger.audit('PAYMENT_FUNDED', {
    component: 'payments',
    paymentId: payment.id,
    invoiceId: payment.invoice_id,
  });

  await queueSupplierNotification(payment.id, payment.invoice_id);
  await queueFacilityDrawdown(payment.id, payment.invoice_id, payment.amount);
  await queueCollectionMonitoring(payment.id, payment.invoice_id);
}

/**
 * Enqueue a collection-monitoring job. Payload is ID-only — no PII.
 * Collections module owns the funded → collecting transition; payments
 * never writes 'collecting' directly to the invoice (status ownership).
 */
async function queueCollectionMonitoring(paymentId: string, invoiceId: string): Promise<void> {
  if (!collectionMonitoringQueue) {
    logger.warn('Collection monitoring queue not configured', {
      component: 'payments',
      paymentId,
      invoiceId,
    });
    return;
  }
  await enqueueWithContext(
    collectionMonitoringQueue,
    'collection-monitoring',
    { invoiceId, paymentId },
    { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}

async function handlePendingConfirmation(
  payment: PaymentRecord,
  result: PaymentProviderResult,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    await repo.recordPendingConfirmationWithClient(client, payment.id, result);

    await repo.createAuditEntryWithClient(
      client,
      null,
      'PAYMENT_PENDING_CONFIRMATION',
      'payments',
      payment.id,
      { status: payment.status },
      {
        status: PaymentStatus.EXECUTING,
        transactionReference: result.transactionReference,
        provider: payment.provider,
      },
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.audit('PAYMENT_PENDING_CONFIRMATION', {
    component: 'payments',
    paymentId: payment.id,
    invoiceId: payment.invoice_id,
  });
}

async function handleFailedPayment(
  payment: PaymentRecord,
  result: PaymentProviderResult,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    await repo.updatePaymentResultWithClient(client, payment.id, result);

    await repo.createAuditEntryWithClient(
      client,
      null,
      'PAYMENT_FAILED',
      'payments',
      payment.id,
      { status: payment.status },
      { status: PaymentStatus.FAILED },
      // failureReason intentionally excluded from audit — may contain PII from provider
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Called after COMMIT — no PII in audit metadata
  logger.audit('PAYMENT_FAILED', {
    component: 'payments',
    paymentId: payment.id,
  });

  // Notify finance_manager of payment failure
  if (notificationQueue) {
    await enqueueWithContext(
      notificationQueue,
      'payment_failed',
      {
        paymentId: payment.id,
        invoiceId: payment.invoice_id,
        type: 'finance_manager_notify',
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
    );
  }
}

/**
 * Map a supplier's preferred_payment_method string to a PaymentProvider.
 *
 * Mobile-money methods (MTN_MOMO, AIRTEL) are no longer supported. Legacy
 * supplier rows that still carry those values are funded via EFT (bank ACH)
 * — the same fallback used for unknown method strings, so old data does not
 * block disbursement.
 */
function mapProvider(_method: string): PaymentProvider {
  return PaymentProvider.EFT;
}

async function queueSupplierNotification(paymentId: string, invoiceId: string): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'payments',
      paymentId,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'payment-funded',
    { paymentId, invoiceId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    },
  );
}

async function checkFacilityAvailability(amount: string): Promise<void> {
  const facilities = await getActiveFacilities();
  if (facilities.length === 0) {
    throw new BusinessRuleError(
      PaymentErrorCode.FACILITY_INSUFFICIENT,
      'No active bank facility available for disbursement',
    );
  }
  const facility = facilities[0];
  const available = BigInt(facility.available_amount);
  const required = BigInt(amount);
  if (available < required) {
    throw new BusinessRuleError(
      PaymentErrorCode.FACILITY_INSUFFICIENT,
      'Insufficient facility balance for this disbursement',
    );
  }
}

async function queueFacilityDrawdown(
  paymentId: string,
  invoiceId: string,
  amount: string,
): Promise<void> {
  if (!facilityDrawdownQueue) {
    logger.warn('Facility drawdown queue not configured', {
      component: 'payments',
      paymentId,
    });
    return;
  }
  await enqueueWithContext(
    facilityDrawdownQueue,
    'facility-drawdown',
    { paymentId, invoiceId, principal: amount },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    },
  );
}

// =========================================================================
// 2FA re-verification
// =========================================================================

const TWO_FA_RECENCY_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Verify that the user has completed 2FA within the last 60 minutes.
 * Throws if 2FA has not been verified recently enough.
 */
async function check2faRecency(userId: string): Promise<void> {
  const lastVerified = await repo.getLast2faVerifiedAt(userId);

  if (lastVerified === null) {
    throw new BusinessRuleError(
      PaymentErrorCode.TWO_FA_REVERIFICATION_REQUIRED,
      '2FA verification required before payment authorisation',
    );
  }

  const elapsed = Date.now() - new Date(lastVerified).getTime();
  if (elapsed > TWO_FA_RECENCY_MS) {
    throw new BusinessRuleError(
      PaymentErrorCode.TWO_FA_REVERIFICATION_REQUIRED,
      '2FA verification expired — please re-verify',
    );
  }
}

// =========================================================================
// Business hours enforcement
// =========================================================================

/**
 * Check if payment authorisation is happening outside business hours.
 * Flags for review but does NOT block the operation.
 * Business hours: Mon-Fri 07:00-20:00 EAT (UTC+3).
 */
async function checkBusinessHours(
  userId: string,
  paymentId: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  const now = new Date();
  const eatHour = getEatHour(now);
  const eatDay = getEatDay(now);

  const isWeekend = eatDay === 0 || eatDay === 6;
  const isOutsideHours = eatHour < 7 || eatHour >= 20;

  if (isWeekend || isOutsideHours) {
    await repo.createAuditEntry(
      userId,
      'AFTER_HOURS_PAYMENT',
      'payments',
      paymentId,
      { eatHour, eatDay, isWeekend },
      { flaggedForReview: true },
      ipAddress ?? null,
      userAgent ?? null,
    );
  }
}

/**
 * Get current hour in East Africa Time (UTC+3).
 */
function getEatHour(date: Date): number {
  const utcHour = date.getUTCHours();
  return (utcHour + 3) % 24;
}

/**
 * Get current day of week in East Africa Time (UTC+3).
 * 0 = Sunday, 6 = Saturday.
 */
function getEatDay(date: Date): number {
  const shifted = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return shifted.getUTCDay();
}

async function queueSlaEscalation(paymentId: string, invoiceId: string): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'payments',
      paymentId,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'payment-sla-escalation',
    {
      paymentId,
      invoiceId,
      escalatedTo: 'management',
    },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    },
  );
}
