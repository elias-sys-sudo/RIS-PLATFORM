import { Worker, Queue, type Job } from 'bullmq';
import { logger } from '../logger';
import { query } from '../database/pool';
import { withJobContext } from './queue-helpers';

// =========================================================================
// Types
// =========================================================================

type SecurityAlertType =
  | 'AML_FLAG'
  | 'SAR_FLAGGED'
  | 'ACCOUNT_LOCKED'
  | 'FAILED_AUTH_BURST'
  | 'AFTER_HOURS_PAYMENT'
  | 'IP_ANOMALY';

interface SecurityAlertPayload {
  type: SecurityAlertType;
  entityId: string;
  entityType: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

const ESCALATION_TYPES: ReadonlySet<SecurityAlertType> = new Set(['AML_FLAG', 'SAR_FLAGGED']);

const IP_DETAIL_TYPES: ReadonlySet<SecurityAlertType> = new Set([
  'ACCOUNT_LOCKED',
  'FAILED_AUTH_BURST',
]);

// =========================================================================
// Notification queue — injected at startup
// =========================================================================

let notificationQueue: Queue | null = null;

/** Inject the shared notification queue so alerts can notify users. */
export function setAlertNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

// =========================================================================
// Core processing
// =========================================================================

/** Process a security alert: audit log + notify compliance + escalate if needed. */
async function processSecurityAlert(payload: SecurityAlertPayload): Promise<void> {
  await auditSecurityAlert(payload);

  const complianceIds = await getComplianceOfficerIds();
  await notifyRecipients(complianceIds, payload);

  if (ESCALATION_TYPES.has(payload.type)) {
    const managementIds = await getManagementIds();
    await notifyRecipients(managementIds, payload);
  }

  logAlertDetails(payload);
}

// =========================================================================
// Helpers — each under 25 lines
// =========================================================================

/** Write the alert to audit_logs for compliance trail. */
async function auditSecurityAlert(payload: SecurityAlertPayload): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id, new_values, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      null,
      'SECURITY_ALERT_DISPATCHED',
      payload.entityType,
      payload.entityId,
      JSON.stringify({ alertType: payload.type, ...payload.metadata }),
      IP_DETAIL_TYPES.has(payload.type) ? String(payload.entityId) : null,
    ],
  );
}

/** Query active compliance officers. */
async function getComplianceOfficerIds(): Promise<string[]> {
  const result = await query<{ id: string }>(
    `SELECT id FROM users WHERE role = $1 AND is_active = $2`,
    ['compliance_officer', true],
  );
  return result.rows.map((r) => r.id);
}

/** Query active management users. */
async function getManagementIds(): Promise<string[]> {
  const result = await query<{ id: string }>(
    `SELECT id FROM users WHERE role = $1 AND is_active = $2`,
    ['management', true],
  );
  return result.rows.map((r) => r.id);
}

/** Queue a notification for each recipient. */
async function notifyRecipients(userIds: string[], payload: SecurityAlertPayload): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured for security alerts', {
      component: 'security-alerting',
      alertType: payload.type,
    });
    return;
  }

  const jobs = userIds.map((userId) =>
    notificationQueue!.add(
      'security-alert-notification',
      {
        channel: 'email',
        template: 'security_alert',
        recipientUserId: userId,
        data: {
          alertType: payload.type,
          entityId: payload.entityId,
          entityType: payload.entityType,
          timestamp: payload.timestamp,
        },
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
    ),
  );

  await Promise.all(jobs);
}

/** Log IP-related details for auth alerts; generic info for others. */
function logAlertDetails(payload: SecurityAlertPayload): void {
  if (IP_DETAIL_TYPES.has(payload.type)) {
    logger.audit('SECURITY_ALERT_DISPATCHED', {
      component: 'security-alerting',
      alertType: payload.type,
      ipAddress: payload.entityId,
    });
    return;
  }

  logger.audit('SECURITY_ALERT_DISPATCHED', {
    component: 'security-alerting',
    alertType: payload.type,
    entityId: payload.entityId,
  });
}

// =========================================================================
// Worker factory
// =========================================================================

/**
 * Create a BullMQ Worker for the 'security-alerts' queue.
 * Processes security alerts and dispatches notifications to compliance officers.
 * Call once during server startup; close on shutdown.
 */
export function createSecurityAlertingWorker(redisUrl: string): Worker<SecurityAlertPayload> {
  const worker = new Worker<SecurityAlertPayload>(
    'security-alerts',
    withJobContext<SecurityAlertPayload>(async (job: Job<SecurityAlertPayload>) => {
      await processSecurityAlert(job.data);
    }),
    {
      connection: { url: redisUrl },
      concurrency: 5,
    },
  );

  worker.on('completed', (job: Job<SecurityAlertPayload>) => {
    logger.info('Security alert processed', {
      component: 'security-alerting',
      jobId: job.id,
      type: job.data.type,
    });
  });

  worker.on('failed', (job, err: Error) => {
    logger.error('Security alert processing failed', {
      component: 'security-alerting',
      jobId: job?.id,
      errorMessage: err.message,
    });
  });

  return worker;
}
