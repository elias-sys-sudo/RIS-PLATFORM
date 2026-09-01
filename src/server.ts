import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import http from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createClient } from 'redis';
import { Queue } from 'bullmq';
import type { Worker } from 'bullmq';
import { logger } from './shared/logger';
import { checkConnection, closePool } from './shared/database/pool';
import {
  helmetMiddleware,
  createCorsMiddleware,
  generalRateLimiter,
  jsonBodyLimit,
  urlencodedBodyLimit,
} from './shared/middleware/security';
import { auditMiddleware } from './shared/middleware/audit.middleware';
import { xssSanitizeMiddleware } from './shared/middleware/xss-sanitize';
import { globalErrorHandler } from './shared/middleware/error-handler';
import { asyncHandler } from './shared/middleware/async-handler';
import { authRouter } from './services/auth/auth.routes';
import { onboardingRouter } from './services/onboarding/onboarding.routes';
import { invoicesRouter } from './services/invoices/invoices.routes';
import { verificationRouter } from './services/verification/verification.routes';
import {
  riskEngineRouter,
  createRiskScoringWorker,
} from './services/risk-engine/risk-engine.routes';
import { pricingRouter, createPricingWorker } from './services/pricing/pricing.routes';
import { approvalsRouter, createApprovalSlaWorker } from './services/approvals/approvals.routes';
import { approvalsFacadeRouter } from './services/approvals/approvals-facade.routes';
import {
  paymentsRouter,
  createPaymentWorker,
  createPaymentSlaWorker,
} from './services/payments/payments.routes';
import { orphansRouter } from './services/payments/payments-orphans.routes';
import { notificationsAdminRouter } from './services/notifications/notifications-admin.routes';
import {
  collectionsRouter,
  createCollectionReminderWorker,
} from './services/collections/collections.routes';
import {
  facilitiesRouter,
  createInterestAccrualWorker,
  createUtilisationCheckWorker,
} from './services/facilities/facilities.routes';
import { reportingRouter } from './services/reporting/reporting.routes';
import { dashboardRouter, paymentHistoryRouter } from './services/dashboard/dashboard.routes';
import { documentsRouter } from './services/documents/documents.routes';
import { collateralRouter } from './services/collateral/collateral.routes';
import { settingsRouter } from './services/settings/settings.routes';
import { buyersFacadeRouter } from './services/onboarding/buyers-facade.routes';
import { suppliersFacadeRouter } from './services/onboarding/suppliers-facade.routes';
import { adminRouter } from './services/admin/admin.routes';
import { assignmentsRouter } from './services/admin/assignments.routes';
import { amlClearanceRouter } from './services/compliance/aml-clearance.routes';
import { setNotificationQueue as setComplianceNotificationQueue } from './services/compliance/aml-clearance.service';
import settlementsRouter from './services/settlements/settlements.routes';
import { complaintsRouter } from './services/complaints/complaints.routes';
import { createSettlementWorker } from './services/settlements/settlements.service';
import { createCollateralExpiryWorker } from './services/collateral/collateral.service';
import { createNotificationWorker } from './shared/workers/notification.worker';
import {
  createSecurityAlertingWorker,
  setAlertNotificationQueue,
} from './shared/workers/security-alerting.worker';
import { createFacilityRepaymentWorker } from './shared/workers/facility-repayment.worker';
import { createCollectionMonitoringWorker } from './shared/workers/collection-monitoring.worker';
import { setNotificationQueue as setFacilitiesNotificationQueue } from './services/facilities/facilities.service';
import {
  setNotificationQueue as setCollectionsNotificationQueue,
  setFacilityRepaymentQueue,
  setSettlementQueue,
  createOverdueWorker,
  createDefaultWorker,
} from './services/collections/collections.service';
import {
  setRedisClient,
  setNotificationQueue as setAuthNotificationQueue,
  setSecurityAlertsQueue,
} from './services/auth/auth.service';
import {
  setRiskScoringQueue,
  setNotificationQueue as setVerificationNotificationQueue,
} from './services/verification/verification.service';
import { setNotificationQueue as setInvoicesNotificationQueue } from './services/invoices/invoices.service';
import {
  setPricingQueue,
  setNotificationQueue as setRiskEngineNotificationQueue,
} from './services/risk-engine/risk-engine.service';
import {
  setPaymentQueue,
  setNotificationQueue as setApprovalsNotificationQueue,
} from './services/approvals/approvals.service';
import {
  setNotificationQueue as setPaymentsNotificationQueue,
  setFacilityDrawdownQueue,
  setCollectionMonitoringQueue,
} from './services/payments/payments.service';
import { initPaymentProviders } from './services/payments/providers/registry';
import { setNotificationQueue as setOnboardingNotificationQueue } from './services/onboarding/onboarding.service';
import { setNotificationQueue as setCollateralNotificationQueue } from './services/collateral/collateral.service';
import { setNotificationQueue as setDocumentsNotificationQueue } from './services/documents/documents.service';
import { setNotificationQueue as setSettlementsNotificationQueue } from './services/settlements/settlements.service';
import { setNotificationQueue as setComplaintsNotificationQueue } from './services/complaints/complaints.service';
import { setRedisClient as setDashboardRedisClient } from './services/dashboard/dashboard.service';

const SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Validate that all required environment variables are set.
 * Throws a clear error on startup if any are missing.
 */
function validateEnv(): void {
  const required: string[] = [
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
    'SENDGRID_API_KEY',
    'SENDGRID_FROM_EMAIL',
    'AT_API_KEY',
    'AT_USERNAME',
    'AT_SENDER_ID',
    'AML_FLAG_THRESHOLD_UGX',
    'DUAL_AUTH_REQUIRED',
    'EFT_OUTPUT_DIR',
    'EFT_BANK_CODE',
  ];

  const missing = required.filter(
    (key) => process.env[key] === undefined || process.env[key] === '',
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env.local and fill in values.',
    );
  }

  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (jwtSecret.length < 64) {
    throw new Error('JWT_SECRET must be at least 64 hex characters (256 bits)');
  }

  const encKey = process.env.ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(encKey)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (256 bits)');
  }

  const corsOrigins = process.env.CORS_ALLOWED_ORIGINS ?? '';
  if (corsOrigins.trim() === '') {
    throw new Error('CORS_ALLOWED_ORIGINS must be set (comma-separated list of allowed origins)');
  }

  validateEmailProviderConfig();
}

/**
 * Email delivery gate — REQUIRED in NODE_ENV=production and NODE_ENV=staging.
 *
 * Provider-agnostic: works with any SMTP-compatible transactional provider
 * (Resend, Postmark, AWS SES out of sandbox, SendGrid, Mailgun, etc.). The
 * codebase historically used AWS SES, so the SMTP env vars still carry the
 * SES_ prefix — they're just SMTP credentials, the prefix is cosmetic.
 *
 * Two checks, both mandatory at startup so the server refuses to boot with
 * a misconfiguration that would silently break supplier registration:
 *
 *  (1) SMTP credentials present (host / port / user / pass)
 *  (2) EMAIL_PROVIDER_VERIFIED=true — operator attestation that the
 *      transactional provider is production-ready (verified domain, out of
 *      sandbox, DKIM aligned). Sandboxed providers silently reject delivery
 *      to non-allowlisted recipients, which is exactly how this incident
 *      surfaced when SES was still in sandbox.
 *
 * Operator checklist before flipping EMAIL_PROVIDER_VERIFIED=true:
 *   - Domain is verified at the provider (DKIM CNAMEs / TXT live, SPF aligned)
 *   - Provider is OUT of sandbox / development mode (e.g. AWS SES production
 *     access granted, Resend domain Verified, Postmark sending approved)
 *   - At least one smoke-test email landed in Gmail Inbox (not Spam)
 *
 * Development mode is unaffected — devs can boot without SMTP creds.
 */
function validateEmailProviderConfig(): void {
  const env = process.env.NODE_ENV ?? 'development';
  if (env !== 'production' && env !== 'staging') return;

  const smtpRequired = ['SES_SMTP_HOST', 'SES_SMTP_PORT', 'SES_SMTP_USER', 'SES_SMTP_PASS'];
  const smtpMissing = smtpRequired.filter(
    (k) => process.env[k] === undefined || process.env[k] === '',
  );
  if (smtpMissing.length > 0) {
    throw new Error(
      `Missing SMTP configuration: ${smtpMissing.join(', ')}. ` +
        `Required in NODE_ENV=${env}. See deploy/email-setup-runbook.md.`,
    );
  }

  if (process.env.EMAIL_PROVIDER_VERIFIED !== 'true') {
    throw new Error(
      `EMAIL_PROVIDER_VERIFIED must be set to "true" in NODE_ENV=${env}. ` +
        'This is an operator attestation that the transactional email provider ' +
        '(Resend / Postmark / SES / etc.) is production-ready: domain verified, ' +
        'out of sandbox, DKIM aligned, smoke-tested to a real inbox. ' +
        'Without this flag the server refuses to start because registration emails ' +
        'would silently fail for any recipient not pre-allowlisted in a sandbox provider.',
    );
  }
}

validateEnv();

const app = express();
const PORT = parseInt(process.env.PORT ?? '4000', 10);

let httpServer: http.Server | null = null;
let redisClient: ReturnType<typeof createClient> | null = null;
let riskScoringWorker: Worker | null = null;
let pricingWorker: Worker | null = null;
let approvalSlaWorker: Worker | null = null;
let paymentWorker: Worker | null = null;
let paymentSlaWorker: Worker | null = null;
let collectionReminderWorker: Worker | null = null;
let interestAccrualWorker: Worker | null = null;
let utilisationCheckWorker: Worker | null = null;
let notificationWorker: Worker | null = null;
let facilityRepaymentWorker: Worker | null = null;
let collectionMonitoringWorker: Worker | null = null;
let overdueWorker: Worker | null = null;
let defaultWorker: Worker | null = null;
let collateralExpiryWorker: Worker | null = null;
let settlementWorker: Worker | null = null;
let securityAlertingWorker: Worker | null = null;
let facilityRepaymentQueue: Queue | null = null;
let collectionMonitoringQueue: Queue | null = null;
let securityAlertsQueue: Queue | null = null;
let paymentSlaQueue: Queue | null = null;
let collectionReminderQueue: Queue | null = null;
let overdueQueue: Queue | null = null;
let defaultQueue: Queue | null = null;
let collateralExpiryQueue: Queue | null = null;
let riskQueue: Queue | null = null;
let pricingQueue: Queue | null = null;
let paymentQueue: Queue | null = null;
let notificationQueue: Queue | null = null;

async function createRedisClient(): Promise<ReturnType<typeof createClient>> {
  const client = createClient({
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  });

  client.on('error', (err: Error) => {
    logger.error('Redis client error', {
      component: 'redis',
      errorMessage: err.message,
    });
  });

  client.on('connect', () => {
    logger.info('Redis client connected', { component: 'redis' });
  });

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await client.connect();
      return client;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delayMs = attempt * 2000;
      logger.warn('Redis connection attempt failed, retrying', {
        component: 'redis',
        attempt,
        delayMs,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error('Redis connection failed after max attempts');
}

/**
 * Check if Redis connection is healthy.
 */
async function checkRedis(): Promise<boolean> {
  try {
    if (!redisClient) {
      return false;
    }
    const pong = await redisClient.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

// Trust the first proxy hop (Cloudflare Tunnel) so req.ip reflects
// CF-Connecting-IP / X-Forwarded-For instead of the edge socket address —
// otherwise rate-limiter keys collapse onto Cloudflare's edge IP and audit
// logs record the wrong client.
app.set('trust proxy', 1);

// --- Security middleware (applied first) ---
app.use(helmetMiddleware);
app.use(createCorsMiddleware());
app.use(generalRateLimiter);
app.use(jsonBodyLimit);
app.use(urlencodedBodyLimit);
app.use(cookieParser());

// --- XSS sanitization (before route handlers) ---
app.use(xssSanitizeMiddleware);

// --- Audit middleware ---
app.use(auditMiddleware);

// --- Routes ---
app.use('/auth', authRouter);
app.use('/onboarding', onboardingRouter);
app.use('/invoices', approvalsRouter);
app.use('/invoices', riskEngineRouter);
app.use('/invoices', pricingRouter);
app.use('/invoices', invoicesRouter);
app.use('/verify', verificationRouter);
app.use('/approvals', approvalsFacadeRouter);
app.use('/payments/history', paymentHistoryRouter);
app.use('/payments', paymentsRouter);
app.use('/collections', collectionsRouter);
app.use('/facilities', facilitiesRouter);
app.use('/reports', reportingRouter);
app.use('/dashboard', dashboardRouter);
app.use('/documents', documentsRouter);
app.use('/collateral', collateralRouter);
app.use('/settings', settingsRouter);
app.use('/buyers', buyersFacadeRouter);
app.use('/suppliers', suppliersFacadeRouter);
app.use('/admin/aml', amlClearanceRouter);
app.use('/admin/approvals', orphansRouter);
app.use('/admin/email', notificationsAdminRouter);
app.use('/admin', adminRouter);
app.use('/assignments', assignmentsRouter);
app.use('/settlements', settlementsRouter);
app.use('/complaints', complaintsRouter);

// --- Health endpoint (liveness + dependency-deep check, current behaviour) ---
// Returns 200 only when DB and Redis are both reachable; 503 otherwise.
// Kept for backward compatibility with existing monitors.
//
// For new monitoring infrastructure prefer `/ready` (same semantics, named
// per industry convention). A true Kubernetes-style liveness probe should
// only confirm the process is alive — that would mean returning 200 here
// unconditionally. Splitting that out is deferred: it would change behaviour
// existing monitors may depend on.
app.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const dbHealthy = await checkConnection();
    const redisHealthy = await checkRedis();

    const status = dbHealthy && redisHealthy ? 'ok' : 'degraded';
    const statusCode = status === 'ok' ? 200 : 503;

    res.status(statusCode).json({
      status,
      database: dbHealthy ? 'connected' : 'disconnected',
      redis: redisHealthy ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }),
);

// --- Readiness probe ---
// Returns 200 only when the process is ready to serve traffic — i.e. every
// downstream dependency (Postgres, Redis) is reachable. A 503 here tells a
// load balancer / Kubernetes readiness probe to stop sending traffic to this
// instance, but does NOT request a restart. Use this for horizontal-scaling
// rollouts and rolling deploys.
app.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const dbReady = await checkConnection();
    const redisReady = await checkRedis();
    const ready = dbReady && redisReady;

    res.status(ready ? 200 : 503).json({
      ready,
      checks: {
        database: dbReady ? 'connected' : 'disconnected',
        redis: redisReady ? 'connected' : 'disconnected',
      },
      timestamp: new Date().toISOString(),
    });
  }),
);

// --- Global error handler (applied last) ---
app.use(globalErrorHandler);

// --- Server startup ---
async function start(): Promise<void> {
  try {
    redisClient = await createRedisClient();
    setRedisClient(redisClient);
    setDashboardRedisClient(redisClient);

    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    riskQueue = new Queue('score-invoice', {
      connection: { url: redisUrl },
    });
    setRiskScoringQueue(riskQueue);
    riskScoringWorker = createRiskScoringWorker(redisUrl);

    pricingQueue = new Queue('price-invoice', {
      connection: { url: redisUrl },
    });
    setPricingQueue(pricingQueue);
    pricingWorker = createPricingWorker(redisUrl);

    // Approvals queues and workers
    paymentQueue = new Queue('process-payment', {
      connection: { url: redisUrl },
    });
    setPaymentQueue(paymentQueue);

    notificationQueue = new Queue('notifications', {
      connection: { url: redisUrl },
    });
    setApprovalsNotificationQueue(notificationQueue);
    setPaymentsNotificationQueue(notificationQueue);
    setRiskEngineNotificationQueue(notificationQueue);
    setVerificationNotificationQueue(notificationQueue);
    setInvoicesNotificationQueue(notificationQueue);
    setAuthNotificationQueue(notificationQueue);
    setOnboardingNotificationQueue(notificationQueue);
    setCollateralNotificationQueue(notificationQueue);
    setDocumentsNotificationQueue(notificationQueue);
    setSettlementsNotificationQueue(notificationQueue);
    setComplaintsNotificationQueue(notificationQueue);
    setComplianceNotificationQueue(notificationQueue);

    approvalSlaWorker = createApprovalSlaWorker(redisUrl);

    // Payments queues and workers
    const facilityDrawdownQueue = new Queue('facility-drawdown', {
      connection: { url: redisUrl },
    });
    setFacilityDrawdownQueue(facilityDrawdownQueue);

    // Register payment providers (dual-auth Layer 3).
    // MUST run before paymentWorker starts consuming `process-payment` jobs —
    // otherwise the worker resolves an empty registry and crashes mid-flow.
    initPaymentProviders(process.env);

    paymentWorker = createPaymentWorker(redisUrl);
    paymentSlaWorker = createPaymentSlaWorker(redisUrl);

    // Payment SLA repeatable job — every hour
    paymentSlaQueue = new Queue('payment-sla-check', {
      connection: { url: redisUrl },
    });
    await paymentSlaQueue.upsertJobScheduler(
      'payment-sla-hourly',
      { pattern: '0 * * * *' },
      { name: 'sla-check', data: { trigger: 'scheduled' } },
    );

    // Collections queues and workers
    setCollectionsNotificationQueue(notificationQueue);
    facilityRepaymentQueue = new Queue('facility-repayment', {
      connection: { url: redisUrl },
    });
    setFacilityRepaymentQueue(facilityRepaymentQueue);
    const settlementQueue = new Queue('settlement-initiate', {
      connection: { url: redisUrl },
    });
    setSettlementQueue(settlementQueue);
    collectionReminderWorker = createCollectionReminderWorker(redisUrl);

    // Collection reminder repeatable job — daily at 5:00 UTC (8:00 AM Uganda)
    collectionReminderQueue = new Queue('collection-reminders', {
      connection: { url: redisUrl },
    });
    await collectionReminderQueue.upsertJobScheduler(
      'collection-reminder-daily',
      { pattern: '0 5 * * *' },
      { name: 'daily-reminder', data: { trigger: 'scheduled' } },
    );

    // Overdue + escalation processing — daily at 05:30 UTC (8:30 AM Uganda)
    overdueQueue = new Queue('overdue-processing', {
      connection: { url: redisUrl },
    });
    await overdueQueue.upsertJobScheduler(
      'overdue-processing-daily',
      { pattern: '30 5 * * *' },
      { name: 'process-overdue', data: { trigger: 'scheduled' } },
    );
    overdueWorker = createOverdueWorker(redisUrl);

    // Auto-default processing — daily at 06:00 UTC (9:00 AM Uganda)
    defaultQueue = new Queue('default-processing', {
      connection: { url: redisUrl },
    });
    await defaultQueue.upsertJobScheduler(
      'default-processing-daily',
      { pattern: '0 6 * * *' },
      { name: 'process-defaults', data: { trigger: 'scheduled' } },
    );
    defaultWorker = createDefaultWorker(redisUrl);

    // Settlement worker — processes settlement initiation jobs
    settlementWorker = createSettlementWorker(redisUrl);

    // Collateral expiry check — daily at 06:30 UTC (9:30 AM Uganda)
    collateralExpiryQueue = new Queue('collateral-expiry-check', {
      connection: { url: redisUrl },
    });
    await collateralExpiryQueue.upsertJobScheduler(
      'collateral-expiry-daily',
      { pattern: '30 6 * * *' },
      { name: 'expiry-check', data: { trigger: 'scheduled' } },
    );
    collateralExpiryWorker = createCollateralExpiryWorker(redisUrl);

    // Facilities queues and workers
    setFacilitiesNotificationQueue(notificationQueue);
    interestAccrualWorker = createInterestAccrualWorker(redisUrl);
    utilisationCheckWorker = createUtilisationCheckWorker(redisUrl);

    // Notification worker — processes all notification job types
    notificationWorker = createNotificationWorker(redisUrl);

    // Facility repayment worker — triggered by collections on buyer payment
    facilityRepaymentWorker = createFacilityRepaymentWorker(redisUrl);

    // Collection-monitoring queue + worker — funded → collecting transition (issue #35).
    // Payments enqueues onto this queue after a funded webhook commits;
    // the worker (collections module) inserts the collections row and
    // updates invoice status from 'funded' to 'collecting'.
    collectionMonitoringQueue = new Queue('collection-monitoring', {
      connection: { url: redisUrl },
    });
    setCollectionMonitoringQueue(collectionMonitoringQueue);
    collectionMonitoringWorker = createCollectionMonitoringWorker(redisUrl);

    // Security alerting queue and worker — dispatches alerts to compliance officers
    securityAlertsQueue = new Queue('security-alerts', {
      connection: { url: redisUrl },
    });
    setAlertNotificationQueue(notificationQueue);
    setSecurityAlertsQueue(securityAlertsQueue);
    securityAlertingWorker = createSecurityAlertingWorker(redisUrl);

    const dbConnected = await checkConnection();
    if (!dbConnected) {
      logger.error('Database connection failed on startup', {
        component: 'server',
      });
      process.exit(1);
    }

    httpServer = app.listen(PORT, () => {
      logger.info(`RIS Platform server running on port ${String(PORT)}`, {
        component: 'server',
        nodeEnv: process.env.NODE_ENV ?? 'development',
      });
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Failed to start server', {
      component: 'server',
      errorMessage,
    });
    process.exit(1);
  }
}

// --- Graceful shutdown ---
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`Received ${signal} — shutting down gracefully`, {
    component: 'server',
  });

  const forceExitTimer = setTimeout(() => {
    logger.error('Shutdown timed out — forcing exit', {
      component: 'server',
    });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    // 1. Stop accepting new HTTP connections, wait for in-flight requests
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      logger.info('HTTP server closed — no in-flight requests remain', {
        component: 'server',
      });
    }

    // 2. Drain Bull workers (finish current jobs, stop picking new ones)
    const workerClosePromises: Promise<void>[] = [];
    if (pricingWorker) {
      workerClosePromises.push(
        pricingWorker.close().then(() => {
          logger.info('Pricing worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (riskScoringWorker) {
      workerClosePromises.push(
        riskScoringWorker.close().then(() => {
          logger.info('Risk scoring worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (approvalSlaWorker) {
      workerClosePromises.push(
        approvalSlaWorker.close().then(() => {
          logger.info('Approval SLA worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (paymentWorker) {
      workerClosePromises.push(
        paymentWorker.close().then(() => {
          logger.info('Payment worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (paymentSlaWorker) {
      workerClosePromises.push(
        paymentSlaWorker.close().then(() => {
          logger.info('Payment SLA worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (collectionReminderWorker) {
      workerClosePromises.push(
        collectionReminderWorker.close().then(() => {
          logger.info('Collection reminder worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (interestAccrualWorker) {
      workerClosePromises.push(
        interestAccrualWorker.close().then(() => {
          logger.info('Interest accrual worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (utilisationCheckWorker) {
      workerClosePromises.push(
        utilisationCheckWorker.close().then(() => {
          logger.info('Utilisation check worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (notificationWorker) {
      workerClosePromises.push(
        notificationWorker.close().then(() => {
          logger.info('Notification worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (facilityRepaymentWorker) {
      workerClosePromises.push(
        facilityRepaymentWorker.close().then(() => {
          logger.info('Facility repayment worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (collectionMonitoringWorker) {
      workerClosePromises.push(
        collectionMonitoringWorker.close().then(() => {
          logger.info('Collection monitoring worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (overdueWorker) {
      workerClosePromises.push(
        overdueWorker.close().then(() => {
          logger.info('Overdue processing worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (defaultWorker) {
      workerClosePromises.push(
        defaultWorker.close().then(() => {
          logger.info('Default processing worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (collateralExpiryWorker) {
      workerClosePromises.push(
        collateralExpiryWorker.close().then(() => {
          logger.info('Collateral expiry worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (settlementWorker) {
      workerClosePromises.push(
        settlementWorker.close().then(() => {
          logger.info('Settlement worker drained', {
            component: 'server',
          });
        }),
      );
    }
    if (securityAlertingWorker) {
      workerClosePromises.push(
        securityAlertingWorker.close().then(() => {
          logger.info('Security alerting worker drained', {
            component: 'server',
          });
        }),
      );
    }
    await Promise.all(workerClosePromises);

    // 3. Close Bull queues (each holds its own Redis connection)
    const queueClosePromises: Promise<void>[] = [];
    if (riskQueue) {
      queueClosePromises.push(riskQueue.close());
    }
    if (pricingQueue) {
      queueClosePromises.push(pricingQueue.close());
    }
    if (paymentQueue) {
      queueClosePromises.push(paymentQueue.close());
    }
    if (notificationQueue) {
      queueClosePromises.push(notificationQueue.close());
    }
    if (facilityRepaymentQueue) {
      queueClosePromises.push(facilityRepaymentQueue.close());
    }
    if (collectionMonitoringQueue) {
      queueClosePromises.push(collectionMonitoringQueue.close());
    }
    if (paymentSlaQueue) {
      queueClosePromises.push(paymentSlaQueue.close());
    }
    if (collectionReminderQueue) {
      queueClosePromises.push(collectionReminderQueue.close());
    }
    if (overdueQueue) {
      queueClosePromises.push(overdueQueue.close());
    }
    if (defaultQueue) {
      queueClosePromises.push(defaultQueue.close());
    }
    if (collateralExpiryQueue) {
      queueClosePromises.push(collateralExpiryQueue.close());
    }
    if (securityAlertsQueue) {
      queueClosePromises.push(securityAlertsQueue.close());
    }
    await Promise.all(queueClosePromises);
    logger.info('Bull queues closed', { component: 'server' });

    // 4. Close Redis client (sessions/cache)
    if (redisClient) {
      await redisClient.quit();
      logger.info('Redis connection closed', { component: 'server' });
    }

    // 5. Close database pool last (workers/queues may have used it)
    await closePool();

    logger.info('Graceful shutdown complete', { component: 'server' });
    process.exit(0);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Error during shutdown', {
      component: 'server',
      errorMessage,
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

// Skip auto-start when imported by integration tests — they call startForTest()
// explicitly, which connects Redis and injects it into services without BullMQ
// workers or HTTP listener (supertest drives the app without a bound port).
if (process.env.NODE_ENV !== 'test') {
  void start();
}

/**
 * Minimal startup for integration tests.
 * Connects Redis and injects it into the two services that require it
 * (auth session store, dashboard). Skips BullMQ workers and HTTP listener.
 */
export async function startForTest(): Promise<void> {
  const rc = await createRedisClient();
  setRedisClient(rc);
  setDashboardRedisClient(rc);
}

export { app, redisClient };
