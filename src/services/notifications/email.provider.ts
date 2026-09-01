// =============================================================================
// Email provider — AWS SES via SMTP (nodemailer)
//
// Previous implementation used the SendGrid SDK directly. Migrated to AWS SES
// SMTP + nodemailer because:
//   1. SES is effectively free at our scale (62k/mo from EC2/Lightsail)
//   2. Same AWS account as Lightsail/Route53 — single vendor, one bill
//   3. SMTP is a stable transport, lets us swap providers later without
//      another rewrite (any SMTP-compatible service drops in)
//
// Public API (initialiseEmailProvider, isEmailConfigured, renderEmailTemplate,
// sendEmail, SendResult shape) is preserved — notifications.service.ts and the
// existing circuit breaker continue to work unchanged.
// =============================================================================
import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from '../../shared/logger';
import type { RenderedEmail, SendResult, EmailTemplate } from './notifications.types';

/**
 * Minimal shape of nodemailer's SentMessageInfo we actually use.
 * Avoids leaking `any` through the eslint strict-rules gate when reading
 * fields off the SMTP response.
 */
interface SmtpInfo {
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
}
import {
  // Existing 11 (do not touch — caller signatures rely on these)
  renderPasswordReset,
  renderInvoiceCreated,
  renderPaymentReceived,
  renderCollectionEscalation,
  renderWelcome,
  renderDocumentCommentAdded,
  renderNewDocumentUploaded,
  renderFinancingTimelineDue,
  renderKycApproved,
  renderKycRejected,
  renderSettlementComplete,
  // New 32 added in parallel work
  renderBuyerConfirmation,
  renderConfirmationReminder,
  renderPaymentFunded,
  renderPricingReady,
  renderPaymentFailed,
  renderInfoRequested,
  renderInvoiceRejected,
  renderSlaEscalation,
  renderAssessmentSlaReminder,
  renderAssessmentSlaOverdue,
  renderInvoiceDispute,
  renderBuyerConfirmationOverdue,
  renderOverdueNotification,
  renderEscalationNotification,
  renderInvoiceReminder,
  renderBuyerPaymentEscalation,
  renderInvoiceDefaulted,
  renderSupplierPaymentNotification,
  renderEscalationDocumentSent,
  renderComplaintFiled,
  renderComplaintResolved,
  renderComplaintEscalated,
  renderAmlCleared,
  renderAmlReviewRequired,
  renderFacilityUtilisationAlert,
  renderFacilityMaturityAlert,
  renderCollateralExpiryWarning,
  renderDocumentExpiryWarning,
  renderSupplierFeedback,
  renderBuyerRequestSubmitted,
  renderBuyerRequestReviewed,
  renderInactiveAccountWarning,
  renderEmailVerification,
  renderNewDeviceLogin,
} from './email.templates';

// =========================================================================
// Safe extraction helpers for Record<string, unknown>
// =========================================================================

/** Extract string from unknown value. */
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** Extract number from unknown value. */
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}

// =========================================================================
// From-address routing
//
// Each template maps to a sender alias. The aliases (confirm@, payments@,
// kyc@, support@, collections@, plus role-based inbound credit@, finance@,
// compliance@, legal@, directors@) are configured at GoDaddy as email
// forwards. The values here are read from env vars so ops can rebrand
// without a code change.
//
// Fallback chain: opts.from (explicit override) → FROM_BY_TEMPLATE[template]
// → SES_FROM_DEFAULT. The default is also used for templates not listed
// (which should never happen — exhaustive switch enforces every template
// gets a renderer, and this map covers every template too).
// =========================================================================

const FROM_DEFAULT = process.env.SES_FROM_DEFAULT ?? 'noreply@raphaintegrated.com';
const FROM_CONFIRM = process.env.SES_FROM_CONFIRM ?? 'confirm@raphaintegrated.com';
const FROM_PAYMENTS = process.env.SES_FROM_PAYMENTS ?? 'payments@raphaintegrated.com';
const FROM_KYC = process.env.SES_FROM_KYC ?? 'kyc@raphaintegrated.com';
const FROM_COLLECTIONS = process.env.SES_FROM_COLLECTIONS ?? 'collections@raphaintegrated.com';
const FROM_SUPPORT = process.env.SES_FROM_SUPPORT ?? 'support@raphaintegrated.com';

const FROM_BY_TEMPLATE: Record<EmailTemplate, string> = {
  // Supplier email verification at registration (magic link)
  email_verification: FROM_CONFIRM,

  // Buyer-facing confirmation flow
  buyer_confirmation: FROM_CONFIRM,
  confirmation_reminder: FROM_CONFIRM,
  buyer_confirmation_overdue: FROM_CONFIRM,

  // Payments / invoice money
  invoice_created: FROM_PAYMENTS,
  payment_received: FROM_PAYMENTS,
  payment_funded: FROM_PAYMENTS,
  pricing_ready: FROM_PAYMENTS,
  payment_failed: FROM_PAYMENTS,
  settlement_complete: FROM_PAYMENTS,
  supplier_payment_notification: FROM_PAYMENTS,
  financing_timeline_due: FROM_PAYMENTS,

  // KYC + onboarding
  kyc_approved: FROM_KYC,
  kyc_rejected: FROM_KYC,
  welcome: FROM_KYC,
  document_comment_added: FROM_KYC,
  new_document_uploaded: FROM_KYC,
  document_expiry_warning: FROM_KYC,
  supplier_feedback: FROM_KYC,
  buyer_request_submitted: FROM_KYC,
  buyer_request_reviewed: FROM_KYC,

  // Collections (firmer voice, dedicated sender)
  overdue_notification: FROM_COLLECTIONS,
  escalation_notification: FROM_COLLECTIONS,
  invoice_reminder: FROM_COLLECTIONS,
  buyer_payment_escalation: FROM_COLLECTIONS,
  invoice_defaulted: FROM_COLLECTIONS,
  escalation_document_sent: FROM_COLLECTIONS,
  collection_escalation: FROM_COLLECTIONS,

  // Generic / staff-facing / catch-all
  password_reset: FROM_SUPPORT,
  new_device_login: FROM_SUPPORT,
  inactive_account_warning: FROM_SUPPORT,
  info_requested: FROM_SUPPORT,
  invoice_rejected: FROM_SUPPORT,
  sla_escalation: FROM_SUPPORT,
  assessment_sla_reminder: FROM_SUPPORT,
  assessment_sla_overdue: FROM_SUPPORT,
  invoice_dispute: FROM_SUPPORT,
  complaint_filed: FROM_SUPPORT,
  complaint_resolved: FROM_SUPPORT,
  complaint_escalated: FROM_SUPPORT,
  aml_cleared: FROM_SUPPORT,
  aml_review_required: FROM_SUPPORT,
  facility_utilisation_alert: FROM_SUPPORT,
  facility_maturity_alert: FROM_SUPPORT,
  collateral_expiry_warning: FROM_SUPPORT,
};

/** Wrap a bare email address in RFC 5322 display-name form. */
function formatFromAddress(email: string): string {
  return `RIS Platform <${email}>`;
}

// =========================================================================
// Configuration / transport
// =========================================================================

let configured = false;
let transporter: Transporter | null = null;

/**
 * Initialise the SES SMTP transporter. Call once at startup
 * (via initialiseNotificationService — do not call directly).
 *
 * Required env vars:
 *   SES_SMTP_HOST   e.g. email-smtp.eu-central-1.amazonaws.com
 *   SES_SMTP_PORT   587 (STARTTLS) or 465 (implicit TLS)
 *   SES_SMTP_USER   SES-derived SMTP username (NOT IAM access key)
 *   SES_SMTP_PASS   SES-derived SMTP password (NOT IAM secret)
 *
 * If any are missing: logs a warning, leaves configured=false, sends become
 * no-ops returning failed SendResults. The notification service's circuit
 * breaker handles this gracefully — server still boots and all other
 * features keep working.
 */
export function initialiseEmailProvider(): void {
  const host = process.env.SES_SMTP_HOST;
  const portRaw = process.env.SES_SMTP_PORT;
  const user = process.env.SES_SMTP_USER;
  const pass = process.env.SES_SMTP_PASS;

  if (
    host === undefined ||
    host === '' ||
    user === undefined ||
    user === '' ||
    pass === undefined ||
    pass === ''
  ) {
    logger.warn('SES SMTP credentials not set — email sending disabled', {
      component: 'email-provider',
      hasHost: host !== undefined && host !== '',
      hasUser: user !== undefined && user !== '',
      hasPass: pass !== undefined && pass !== '',
    });
    return;
  }

  const port = portRaw !== undefined && portRaw !== '' ? Number(portRaw) : 587;
  if (Number.isNaN(port)) {
    logger.warn('SES_SMTP_PORT is not a number — email sending disabled', {
      component: 'email-provider',
      received: portRaw,
    });
    return;
  }

  const rateLimit = num(
    process.env.SES_SMTP_RATE_LIMIT === undefined
      ? undefined
      : Number(process.env.SES_SMTP_RATE_LIMIT),
    12,
  );
  const maxConnections = num(
    process.env.SES_SMTP_MAX_CONNECTIONS === undefined
      ? undefined
      : Number(process.env.SES_SMTP_MAX_CONNECTIONS),
    5,
  );

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // implicit TLS on 465, STARTTLS on 587
    requireTLS: port !== 465, // force STARTTLS on 587 — refuse plaintext
    auth: { user, pass },
    pool: true,
    maxConnections,
    maxMessages: 100,
    rateLimit, // messages/sec — under SES sandbox cap of 14/s
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: 'TLSv1.2' },
  });

  configured = true;
  logger.info('Email provider initialised (SES SMTP)', {
    component: 'email-provider',
    host,
    port,
    rateLimit,
    maxConnections,
  });
}

/** Check if the email provider is configured. */
export function isEmailConfigured(): boolean {
  return configured;
}

// =========================================================================
// Template router
// =========================================================================

/** Render an email template by name with the given data. */
export function renderEmailTemplate(
  template: EmailTemplate,
  data: Record<string, unknown>,
): RenderedEmail {
  switch (template) {
    case 'password_reset':
      return renderPasswordReset({
        token_url: str(data.token_url),
        expiry_minutes: num(data.expiry_minutes, 60),
        user_name: str(data.user_name, 'User'),
      });
    case 'invoice_created':
      return renderInvoiceCreated({
        invoice_number: str(data.invoice_number),
        amount: str(data.amount, '0'),
        buyer_name: str(data.buyer_name),
        due_date: str(data.due_date),
      });
    case 'payment_received':
      return renderPaymentReceived({
        amount: str(data.amount, '0'),
        reference: str(data.reference),
        remaining_balance: str(data.remaining_balance, '0'),
      });
    case 'collection_escalation':
      return renderCollectionEscalation({
        escalation_level: str(data.escalation_level),
        amount_overdue: str(data.amount_overdue, '0'),
        days_overdue: num(data.days_overdue),
        next_action: str(data.next_action),
      });
    case 'welcome':
      return renderWelcome({
        user_name: str(data.user_name, 'User'),
        login_url: str(data.login_url),
      });
    case 'document_comment_added':
      return renderDocumentCommentAdded({
        document_type: str(data.document_type),
        comment_snippet: str(data.comment_snippet),
        login_url: str(data.login_url),
      });
    case 'new_document_uploaded':
      return renderNewDocumentUploaded({
        document_type: str(data.document_type),
        login_url: str(data.login_url),
      });
    case 'financing_timeline_due':
      return renderFinancingTimelineDue({
        invoice_number: str(data.invoice_number),
        amount: str(data.amount, '0'),
        due_date: str(data.due_date),
        login_url: str(data.login_url),
      });
    case 'kyc_approved':
      return renderKycApproved({
        user_name: str(data.user_name, 'User'),
        login_url: str(data.login_url),
      });
    case 'kyc_rejected':
      return renderKycRejected({
        user_name: str(data.user_name, 'User'),
        rejection_reason: str(data.rejection_reason, 'Please contact support.'),
        login_url: str(data.login_url),
      });
    case 'settlement_complete':
      return renderSettlementComplete({
        invoice_number: str(data.invoice_number),
        net_profit: str(data.net_profit),
        settlement_id: str(data.settlement_id),
        login_url: str(data.login_url),
      });
    // ── New 32 (mirrors the data interfaces in notifications.types.ts) ────
    case 'buyer_confirmation':
      return renderBuyerConfirmation(data as never);
    case 'confirmation_reminder':
      return renderConfirmationReminder(data as never);
    case 'payment_funded':
      return renderPaymentFunded(data as never);
    case 'pricing_ready':
      return renderPricingReady(data as never);
    case 'payment_failed':
      return renderPaymentFailed(data as never);
    case 'info_requested':
      return renderInfoRequested(data as never);
    case 'invoice_rejected':
      return renderInvoiceRejected(data as never);
    case 'sla_escalation':
      return renderSlaEscalation(data as never);
    case 'assessment_sla_reminder':
      return renderAssessmentSlaReminder(data as never);
    case 'assessment_sla_overdue':
      return renderAssessmentSlaOverdue(data as never);
    case 'invoice_dispute':
      return renderInvoiceDispute(data as never);
    case 'buyer_confirmation_overdue':
      return renderBuyerConfirmationOverdue(data as never);
    case 'overdue_notification':
      return renderOverdueNotification(data as never);
    case 'escalation_notification':
      return renderEscalationNotification(data as never);
    case 'invoice_reminder':
      return renderInvoiceReminder(data as never);
    case 'buyer_payment_escalation':
      return renderBuyerPaymentEscalation(data as never);
    case 'invoice_defaulted':
      return renderInvoiceDefaulted(data as never);
    case 'supplier_payment_notification':
      return renderSupplierPaymentNotification(data as never);
    case 'escalation_document_sent':
      return renderEscalationDocumentSent(data as never);
    case 'complaint_filed':
      return renderComplaintFiled(data as never);
    case 'complaint_resolved':
      return renderComplaintResolved(data as never);
    case 'complaint_escalated':
      return renderComplaintEscalated(data as never);
    case 'aml_cleared':
      return renderAmlCleared(data as never);
    case 'aml_review_required':
      return renderAmlReviewRequired(data as never);
    case 'facility_utilisation_alert':
      return renderFacilityUtilisationAlert(data as never);
    case 'facility_maturity_alert':
      return renderFacilityMaturityAlert(data as never);
    case 'collateral_expiry_warning':
      return renderCollateralExpiryWarning(data as never);
    case 'document_expiry_warning':
      return renderDocumentExpiryWarning(data as never);
    case 'supplier_feedback':
      return renderSupplierFeedback(data as never);
    case 'buyer_request_submitted':
      return renderBuyerRequestSubmitted(data as never);
    case 'buyer_request_reviewed':
      return renderBuyerRequestReviewed(data as never);
    case 'inactive_account_warning':
      return renderInactiveAccountWarning(data as never);
    case 'email_verification':
      return renderEmailVerification({
        verification_url: str(data.verification_url),
        expiry_hours: num(data.expiry_hours, 24),
        user_name: str(data.user_name, 'Supplier'),
      });
    case 'new_device_login':
      return renderNewDeviceLogin({
        user_name: str(data.user_name, 'there'),
        ip_address: str(data.ip_address, 'unknown'),
        user_agent: str(data.user_agent, 'unknown device'),
        login_timestamp: str(data.login_timestamp, new Date().toISOString()),
        reset_url: str(data.reset_url),
      });
    default: {
      const _exhaustive: never = template;
      throw new Error(`Unknown email template: ${String(_exhaustive)}`);
    }
  }
}

// =========================================================================
// Send email
// =========================================================================

/** Resolve the From address for a given template. */
function resolveFrom(template: EmailTemplate, override?: string): string {
  if (override !== undefined && override !== '') return override;
  return FROM_BY_TEMPLATE[template] ?? FROM_DEFAULT;
}

/**
 * Send an email via AWS SES SMTP. Returns a SendResult with timing.
 *
 * The optional 4th argument is an escape hatch for one-off cases that need a
 * different From or a ReplyTo header (e.g. compliance officer reviewing a
 * complaint may want replies routed back to their own inbox). Most callers
 * should just pass three args and let FROM_BY_TEMPLATE pick the sender.
 */
export async function sendEmail(
  to: string,
  template: EmailTemplate,
  data: Record<string, unknown>,
  opts: { from?: string; replyTo?: string } = {},
): Promise<SendResult> {
  const start = Date.now();

  if (!configured || transporter === null) {
    return buildFailResult(start, 'Email provider not configured');
  }

  const fromBare = resolveFrom(template, opts.from);
  const from = formatFromAddress(fromBare);

  let rendered: RenderedEmail;
  try {
    rendered = renderEmailTemplate(template, data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown template error';
    return buildFailResult(start, `render: ${message}`);
  }

  try {
    const info = (await transporter.sendMail({
      to,
      from,
      replyTo: opts.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })) as SmtpInfo;

    const rejected = Array.isArray(info.rejected) ? info.rejected : [];
    if (rejected.length > 0) {
      return buildFailResult(start, `recipient rejected: ${rejected.join(', ')}`);
    }

    const rawMessageId = typeof info.messageId === 'string' ? info.messageId : undefined;
    // nodemailer wraps messageId in angle brackets — strip for cleaner logs
    const messageId = rawMessageId !== undefined ? rawMessageId.replace(/^<|>$/g, '') : undefined;
    return buildSuccessResult(start, messageId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown send error';
    return buildFailResult(start, message);
  }
}

/**
 * Smoke test — sends a tiny hardcoded email through the live transport.
 * Useful for verifying SES credentials + DNS + DKIM in <2s without
 * touching the queue.
 *
 * Production safety: refuses to run if NODE_ENV === 'production' to avoid
 * accidental spam during deploys.
 */
export async function sendSmokeTestEmail(to: string): Promise<SendResult> {
  if (process.env.NODE_ENV === 'production') {
    return buildFailResult(Date.now(), 'smoke test disabled in production');
  }

  const start = Date.now();
  if (!configured || transporter === null) {
    return buildFailResult(start, 'Email provider not configured');
  }

  const fromBare = process.env.SES_FROM_DEFAULT ?? 'noreply@raphaintegrated.com';
  const from = formatFromAddress(fromBare);
  const timestamp = new Date().toISOString();

  try {
    const info = (await transporter.sendMail({
      to,
      from,
      subject: `RIS Platform — SES SMTP smoke test (${timestamp})`,
      text: `If you can read this, AWS SES + nodemailer + your DNS records all work.\n\nSent: ${timestamp}\nFrom: ${fromBare}\nTransport: AWS SES SMTP (eu-central-1)\n\n— RIS Platform`,
      html: `<p>If you can read this, <strong>AWS SES + nodemailer + your DNS records all work</strong>.</p><p>Sent: ${timestamp}<br>From: ${fromBare}<br>Transport: AWS SES SMTP (eu-central-1)</p><p style="color:#666;font-size:12px;">— RIS Platform</p>`,
    })) as SmtpInfo;

    const rawMessageId = typeof info.messageId === 'string' ? info.messageId : undefined;
    const messageId = rawMessageId !== undefined ? rawMessageId.replace(/^<|>$/g, '') : undefined;
    return buildSuccessResult(start, messageId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown smoke error';
    return buildFailResult(start, message);
  }
}

// =========================================================================
// Result builders
// =========================================================================

function buildSuccessResult(start: number, messageId?: string): SendResult {
  return {
    success: true,
    provider: 'ses',
    messageId: messageId !== undefined ? messageId : undefined,
    durationMs: Date.now() - start,
  };
}

function buildFailResult(start: number, error: string): SendResult {
  return {
    success: false,
    provider: 'ses',
    error,
    durationMs: Date.now() - start,
  };
}
