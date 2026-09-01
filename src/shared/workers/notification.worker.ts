import { Worker, type Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import { withJobContext } from './queue-helpers';
import {
  initialiseNotificationService,
  processNotification,
  handleNotificationTerminalFailure,
  hydrateLegacyJobPayload,
} from '../../services/notifications/notifications.service';
import type {
  NotificationJobPayload,
  NotificationChannel,
  NotificationTemplate,
} from '../../services/notifications/notifications.types';

// =========================================================================
// Supported notification job types (for legacy compatibility)
// =========================================================================

const KNOWN_JOB_TYPES: ReadonlySet<string> = new Set([
  // Auth
  'send-email',
  // Invoices
  'send-buyer-confirmation',
  'notify-compliance-aml',
  // Verification
  'send-buyer-confirmation-email',
  'send-confirmation-reminder',
  'notify-credit-officer-overdue',
  // Risk engine
  'invoice-rejected',
  // Approvals
  'sla-escalation',
  // Payments
  'payment-funded',
  'payment-sla-escalation',
  // Collections
  'overdue-notification',
  'escalation-notification',
  'supplier-payment-notification',
  'invoice-reminder',
  'collection-job-failure',
  // Facilities
  'facility-utilisation-alert',
  'facility-maturity-alert',
  // Onboarding / KYC
  'new-kyc-document-uploaded',
]);

// =========================================================================
// Legacy job normalisation
// =========================================================================

/**
 * Convert a legacy BullMQ job into a NotificationJobPayload.
 * Legacy jobs from other modules may not have the full payload shape,
 * so we normalise them here.
 */
function normaliseJobPayload(job: Job<Record<string, unknown>>): NotificationJobPayload {
  const data = job.data;

  if (hasFullPayload(data)) {
    return data as unknown as NotificationJobPayload;
  }

  return buildNormalisedPayload(job, data);
}

function hasFullPayload(data: Record<string, unknown>): boolean {
  return (
    typeof data.channel === 'string' &&
    typeof data.template === 'string' &&
    typeof data.recipient === 'string'
  );
}

function buildNormalisedPayload(
  job: Job<Record<string, unknown>>,
  data: Record<string, unknown>,
): NotificationJobPayload {
  return {
    id: String(job.id ?? uuidv4()),
    channel: inferChannel(data),
    template: inferTemplate(job.name, data),
    recipient:
      typeof data.to === 'string'
        ? data.to
        : typeof data.recipient === 'string'
          ? data.recipient
          : '',
    data,
    priority: 'normal',
    attempts: job.attemptsMade,
    max_attempts: 3,
    created_at: new Date().toISOString(),
  };
}

function inferChannel(data: Record<string, unknown>): NotificationChannel {
  if (data.channel === 'sms') return 'sms';
  if (
    (data.phone !== undefined && data.phone !== null) ||
    (data.phoneNumber !== undefined && data.phoneNumber !== null)
  )
    return 'sms';
  return 'email';
}

function inferTemplate(jobName: string, data: Record<string, unknown>): NotificationTemplate {
  if (data.template !== undefined && data.template !== null)
    return data.template as NotificationTemplate;

  const templateMap: Record<string, NotificationTemplate> = {
    'send-email': 'password_reset',
    'payment-funded': 'payment_received',
    'overdue-notification': 'payment_reminder',
    'escalation-notification': 'escalation_notice',
  };

  return templateMap[jobName] ?? 'welcome';
}

// =========================================================================
// Job handler
// =========================================================================

/**
 * Process a BullMQ notification job via the notification service.
 * Routes to the correct provider (SendGrid/AT) based on channel.
 */
async function handleNotificationJob(job: Job<Record<string, unknown>>): Promise<void> {
  const jobName = job.name;

  if (!KNOWN_JOB_TYPES.has(jobName)) {
    logger.warn('Unknown notification job type', {
      component: 'notifications',
      jobName,
      jobId: job.id,
    });
  }

  const hydrated = await hydrateLegacyJobPayload(
    jobName,
    String(job.id ?? ''),
    job.data,
    job.attemptsMade,
  );
  const payload = hydrated ?? normaliseJobPayload(job);
  const result = await processNotification(payload);

  if (!result.success) {
    throw new Error(result.error ?? 'Notification send failed');
  }
}

// =========================================================================
// Worker factory
// =========================================================================

/**
 * Create a BullMQ Worker for the 'notifications' queue.
 * Initialises notification providers and processes all job types.
 * Call once during server startup; close on shutdown.
 */
export function createNotificationWorker(redisUrl: string): Worker<Record<string, unknown>> {
  initialiseNotificationService();

  const worker = new Worker<Record<string, unknown>>(
    'notifications',
    withJobContext<Record<string, unknown>>(async (job: Job<Record<string, unknown>>) => {
      await handleNotificationJob(job);
    }),
    {
      connection: { url: redisUrl },
      concurrency: 5,
    },
  );

  worker.on('completed', (job: Job<Record<string, unknown>>) => {
    logger.info('Notification job completed', {
      component: 'notifications',
      jobId: job.id,
      jobName: job.name,
    });
  });

  worker.on('failed', (job, err: Error) => {
    const maxAttempts = job?.opts?.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? 0;
    const isTerminal = attemptsMade >= maxAttempts;

    logger.error('Notification job failed', {
      component: 'notifications',
      jobId: job?.id,
      jobName: job?.name,
      errorMessage: err.message,
      attemptsMade,
      maxAttempts,
      terminal: isTerminal,
    });

    if (!isTerminal || !job?.id) return;

    const info = buildFailureInfo(job, err, attemptsMade);
    handleNotificationTerminalFailure(info).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : 'unknown';
      logger.error('Terminal notification handler failed', {
        component: 'notifications',
        jobId: job?.id,
        errorMessage: message,
      });
    });
  });

  return worker;
}

/**
 * Pull only the fields the audit needs off the BullMQ Job + Error.
 * Keeps the worker dumb and lets the service own the typed shape.
 * Never persists the recipient email — it's passed for userId lookup
 * inside the service and dropped before the audit row is written.
 */
function buildFailureInfo(
  job: Job<Record<string, unknown>>,
  err: Error,
  attemptsMade: number,
): {
  jobId: string;
  jobName: string;
  template: string;
  channel: string;
  recipientEmail: string | null;
  errorCode: string;
  attemptsMade: number;
} {
  const data = job.data;
  const template = typeof data.template === 'string' ? data.template : job.name;
  const channel = typeof data.channel === 'string' ? data.channel : 'email';
  const recipient = typeof data.recipient === 'string' ? data.recipient : null;
  const codeField = (err as { code?: unknown }).code;
  const errorCode = typeof codeField === 'string' ? codeField : 'NOTIFICATION_WORKER_EXHAUSTED';
  return {
    jobId: String(job.id ?? ''),
    jobName: job.name,
    template,
    channel,
    recipientEmail: recipient,
    errorCode,
    attemptsMade,
  };
}
