import { logger } from '../../shared/logger';
import { pool, beginWithRls } from '../../shared/database/pool';
import { decrypt } from '../../shared/crypto';
import { sendEmail, initialiseEmailProvider, isEmailConfigured } from './email.provider';
import { sendSms, initialiseSmsProvider, isSmsConfigured } from './sms.provider';
import * as repo from './notifications.repository';
import { findUserByEmail } from '../auth/auth.repository';
import { findBuyerEncryptedContact } from '../verification/verification.repository';
import type {
  NotificationChannel,
  NotificationJobPayload,
  SendResult,
  CircuitBreakerState,
  NotificationHealthStatus,
  EmailTemplate,
  SmsTemplate,
} from './notifications.types';

// =========================================================================
// Circuit breaker configuration
// =========================================================================

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_PAUSE_MS = 60_000;

const circuitBreakers: Record<NotificationChannel, CircuitBreakerState> = {
  email: { consecutiveFailures: 0, pausedUntil: null },
  sms: { consecutiveFailures: 0, pausedUntil: null },
};

// =========================================================================
// Processed job tracking (idempotency)
// =========================================================================

const processedJobs = new Set<string>();
const MAX_PROCESSED_CACHE = 10_000;

// =========================================================================
// Initialisation
// =========================================================================

/** Initialise all notification providers. Call once at startup. */
export function initialiseNotificationService(): void {
  initialiseEmailProvider();
  initialiseSmsProvider();
  logger.info('Notification service initialised', {
    component: 'notifications',
  });
}

// =========================================================================
// Circuit breaker logic
// =========================================================================

/** Check if a channel's circuit breaker is currently open (paused). */
export function isCircuitOpen(channel: NotificationChannel): boolean {
  const state = circuitBreakers[channel];
  if (state.pausedUntil === null) return false;
  if (Date.now() >= state.pausedUntil) {
    resetCircuitBreaker(channel);
    return false;
  }
  return true;
}

/** Record a successful send — resets consecutive failure count. */
function recordSuccess(channel: NotificationChannel): void {
  circuitBreakers[channel].consecutiveFailures = 0;
}

/** Record a failed send — may trip the circuit breaker. */
function recordFailure(channel: NotificationChannel): void {
  const state = circuitBreakers[channel];
  state.consecutiveFailures += 1;

  if (state.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    state.pausedUntil = Date.now() + CIRCUIT_BREAKER_PAUSE_MS;
    logger.error('Circuit breaker tripped — channel paused', {
      component: 'notifications',
      channel,
      pauseSeconds: CIRCUIT_BREAKER_PAUSE_MS / 1000,
    });
  }
}

/** Reset a channel's circuit breaker state. */
export function resetCircuitBreaker(channel: NotificationChannel): void {
  circuitBreakers[channel] = { consecutiveFailures: 0, pausedUntil: null };
}

// =========================================================================
// Job processing
// =========================================================================

/** Process a single notification job. Returns the send result. */
export async function processNotification(job: NotificationJobPayload): Promise<SendResult> {
  if (processedJobs.has(job.id)) {
    return buildSkipResult(job.channel, 'Duplicate job — already processed');
  }

  if (isCircuitOpen(job.channel)) {
    return buildSkipResult(job.channel, 'Circuit breaker open — channel paused');
  }

  const result = await dispatchToProvider(job);
  updateCircuitBreaker(job.channel, result.success);
  trackProcessedJob(job.id);
  logSendAttempt(job, result);

  return result;
}

/** Route a job to the correct provider based on channel. */
async function dispatchToProvider(job: NotificationJobPayload): Promise<SendResult> {
  switch (job.channel) {
    case 'email':
      return sendEmail(job.recipient, job.template as EmailTemplate, job.data);
    case 'sms':
      return sendSms(job.recipient, job.template as SmsTemplate, job.data);
    default: {
      const _exhaustive: never = job.channel;
      const start = Date.now();
      return {
        success: false,
        provider: String(_exhaustive),
        error: `Unknown channel: ${String(_exhaustive)}`,
        durationMs: Date.now() - start,
      };
    }
  }
}

function updateCircuitBreaker(channel: NotificationChannel, success: boolean): void {
  if (success) {
    recordSuccess(channel);
  } else {
    recordFailure(channel);
  }
}

function trackProcessedJob(jobId: string): void {
  if (processedJobs.size >= MAX_PROCESSED_CACHE) {
    const first = processedJobs.values().next().value as string;
    processedJobs.delete(first);
  }
  processedJobs.add(jobId);
}

// =========================================================================
// Logging
// =========================================================================

function logSendAttempt(job: NotificationJobPayload, result: SendResult): void {
  const meta = {
    component: 'notifications',
    jobId: job.id,
    channel: job.channel,
    template: job.template,
    provider: result.provider,
    success: result.success,
    durationMs: result.durationMs,
    messageId: result.messageId,
  };

  if (result.success) {
    logger.info('Notification sent', meta);
  } else {
    logger.error('Notification failed', { ...meta, error: result.error });
  }
}

// =========================================================================
// Health check
// =========================================================================

/** Return the health status of the notification service. */
export function getHealthStatus(): NotificationHealthStatus {
  return {
    healthy: isEmailConfigured() || isSmsConfigured(),
    email: {
      configured: isEmailConfigured(),
      circuitOpen: isCircuitOpen('email'),
    },
    sms: {
      configured: isSmsConfigured(),
      circuitOpen: isCircuitOpen('sms'),
    },
  };
}

// =========================================================================
// Helpers
// =========================================================================

function buildSkipResult(channel: string, reason: string): SendResult {
  return {
    success: false,
    provider: channel,
    error: reason,
    durationMs: 0,
  };
}

/** Reset internal state — only for testing. */
export function resetForTesting(): void {
  processedJobs.clear();
  resetCircuitBreaker('email');
  resetCircuitBreaker('sms');
}

// =========================================================================
// Worker terminal-failure handler — root CLAUDE.md non-negotiable #12
//
// Called by the BullMQ notifications worker after `attempts` retries are
// exhausted. Writes an audit row so silent SES failures (sandbox rejection,
// DKIM mismatch, throttling) become operator-visible instead of dying in
// stderr. PII-free metadata: jobId / jobName / template / channel / errorCode
// — never the recipient email or phone.
// =========================================================================

export interface NotificationFailureInfo {
  jobId: string;
  jobName: string;
  template: string;
  channel: string;
  /** Recipient email; used ONLY to resolve the user UUID. Never persisted. */
  recipientEmail: string | null;
  errorCode: string;
  attemptsMade: number;
}

export async function handleNotificationTerminalFailure(
  info: NotificationFailureInfo,
): Promise<void> {
  const action = pickAuditAction(info.template);
  const recipientUserId = await resolveRecipientUserId(info);
  await writeTerminalFailureAudit(action, info, recipientUserId);
  logger.audit(action, {
    component: 'notifications',
    jobId: info.jobId,
    template: info.template,
    errorCode: info.errorCode,
  });
}

function pickAuditAction(template: string): string {
  if (template === 'email_verification') return 'EMAIL_VERIFICATION_DELIVERY_FAILED';
  return 'NOTIFICATION_DELIVERY_FAILED';
}

/**
 * Resolve the recipient's user UUID from the email on the failed job.
 * Returns null if no user matches — the audit still lands, just without
 * a JOIN target. Lookup uses the existing auth repo to avoid duplicate
 * SQL for the users table.
 */
async function resolveRecipientUserId(info: NotificationFailureInfo): Promise<string | null> {
  if (info.channel !== 'email' || info.recipientEmail === null) return null;
  try {
    const user = await findUserByEmail(info.recipientEmail);
    return user?.id ?? null;
  } catch (err: unknown) {
    logger.warn('Failed to resolve recipient user during terminal-failure audit', {
      component: 'notifications',
      jobId: info.jobId,
      errorMessage: err instanceof Error ? err.message : 'Unknown',
    });
    return null;
  }
}

async function writeTerminalFailureAudit(
  action: string,
  info: NotificationFailureInfo,
  recipientUserId: string | null,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await repo.createAuditEntryWithClient(
      client,
      null,
      action,
      'notifications',
      info.jobId,
      { status: 'retrying' },
      {
        jobName: info.jobName,
        template: info.template,
        channel: info.channel,
        errorCode: info.errorCode,
        attemptsMade: info.attemptsMade,
        retriesExhausted: true,
        recipientUserId,
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

/**
 * Read-through to the repository for the operator triage endpoint.
 * Lookback expressed in hours so the route can pass a sane window
 * (default 72h) without re-implementing time math.
 */
export async function listFailedVerifications(
  lookbackHours: number,
): Promise<repo.FailedVerificationRow[]> {
  return repo.findRecentFailedVerifications(lookbackHours);
}

// =========================================================================
// Legacy job hydration — bridges {invoiceId, buyerId, token} → full payload
//
// Verification module enqueues PII-free job payloads (Rule 3 — no PII in
// Redis). The worker must hydrate them at execution time by reading IDs
// from the payload and resolving DB rows + decrypting PII here. Returns
// null when the jobName is not handled so the worker can fall back to the
// generic normaliser (KNOWN_JOB_TYPES still routes everything else).
// =========================================================================

interface BuyerConfirmationContext {
  invoiceNumber: string;
  faceValue: string;
  dueDate: string;
  supplierName: string;
  buyerName: string;
  buyerEmail: string;
}

export async function hydrateLegacyJobPayload(
  jobName: string,
  jobId: string,
  data: Record<string, unknown>,
  attemptsMade: number,
): Promise<NotificationJobPayload | null> {
  if (!isBuyerConfirmationJob(jobName)) return null;

  const invoiceId = typeof data.invoiceId === 'string' ? data.invoiceId : '';
  const buyerId = typeof data.buyerId === 'string' ? data.buyerId : '';
  const rawToken = typeof data.token === 'string' ? data.token : '';
  if (invoiceId === '' || buyerId === '' || rawToken === '') {
    logger.warn('Buyer-confirmation job missing required IDs', {
      component: 'notifications',
      jobId,
      jobName,
    });
    return null;
  }

  const ctx = await loadBuyerConfirmationContext(invoiceId, buyerId, jobId, jobName);
  if (ctx === null) return null;

  return buildBuyerConfirmationPayload(jobName, jobId, attemptsMade, rawToken, ctx);
}

function isBuyerConfirmationJob(jobName: string): boolean {
  return (
    jobName === 'send-buyer-confirmation-email' ||
    jobName === 'send-buyer-confirmation' ||
    jobName === 'send-confirmation-reminder'
  );
}

async function loadBuyerConfirmationContext(
  invoiceId: string,
  buyerId: string,
  jobId: string,
  jobName: string,
): Promise<BuyerConfirmationContext | null> {
  const invoice = await fetchInvoiceWithSupplier(invoiceId);
  const buyer = await findBuyerEncryptedContact(buyerId);
  if (invoice === null || buyer === null) {
    logger.warn('Buyer-confirmation hydration missed invoice or buyer', {
      component: 'notifications',
      jobId,
      jobName,
      invoiceId,
      buyerId,
      invoiceFound: invoice !== null,
      buyerFound: buyer !== null,
    });
    return null;
  }

  const buyerEmail = safeDecryptToString(buyer.contact_email_encrypted);
  if (buyerEmail === '') {
    logger.warn('Buyer email could not be decrypted', {
      component: 'notifications',
      jobId,
      jobName,
      invoiceId,
      buyerId,
    });
    return null;
  }

  return {
    invoiceNumber: invoice.invoice_number,
    faceValue: invoice.face_value,
    dueDate: invoice.due_date,
    supplierName: resolveSupplierName(
      invoice.supplier_company_name_encrypted,
      invoice.supplier_company_name,
    ),
    buyerName: buyer.company_name,
    buyerEmail,
  };
}

interface InvoiceSupplierRow {
  invoice_number: string;
  face_value: string;
  due_date: string;
  supplier_company_name: string | null;
  supplier_company_name_encrypted: string | null;
}

async function fetchInvoiceWithSupplier(invoiceId: string): Promise<InvoiceSupplierRow | null> {
  const result = await pool.query<InvoiceSupplierRow>(
    `SELECT i.invoice_number,
            i.face_value::text AS face_value,
            i.due_date::text   AS due_date,
            s.company_name           AS supplier_company_name,
            s.company_name_encrypted AS supplier_company_name_encrypted
       FROM invoices i
       JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

function resolveSupplierName(encrypted: string | null, plaintext: string | null): string {
  const decrypted = safeDecryptToString(encrypted);
  if (decrypted !== '') return decrypted;
  return plaintext ?? '';
}

function safeDecryptToString(value: string | null): string {
  if (value === null || value === '') return '';
  try {
    return decrypt(value);
  } catch {
    return '';
  }
}

function buildBuyerConfirmationPayload(
  jobName: string,
  jobId: string,
  attemptsMade: number,
  rawToken: string,
  ctx: BuyerConfirmationContext,
): NotificationJobPayload {
  const isReminder = jobName === 'send-confirmation-reminder';
  const template: EmailTemplate = isReminder ? 'confirmation_reminder' : 'buyer_confirmation';
  const confirmationUrl = buildConfirmationUrl(rawToken);
  const amount = formatUgxAmount(ctx.faceValue);
  const data: Record<string, unknown> = {
    buyer_name: ctx.buyerName,
    supplier_name: ctx.supplierName,
    invoice_number: ctx.invoiceNumber,
    amount,
    due_date: ctx.dueDate,
    confirmation_url: confirmationUrl,
    expiry_hours: 48,
  };
  if (isReminder) data.deadline = ctx.dueDate;
  return {
    id: jobId,
    channel: 'email',
    template,
    recipient: ctx.buyerEmail,
    data,
    priority: 'high',
    attempts: attemptsMade,
    max_attempts: 3,
    created_at: new Date().toISOString(),
  };
}

function buildConfirmationUrl(rawToken: string): string {
  const base = process.env.FRONTEND_URL ?? 'https://staging.raphaintegrated.com';
  return `${base}/verify/${rawToken}`;
}

function formatUgxAmount(faceValue: string): string {
  try {
    return BigInt(faceValue).toLocaleString('en-US');
  } catch {
    return faceValue;
  }
}
