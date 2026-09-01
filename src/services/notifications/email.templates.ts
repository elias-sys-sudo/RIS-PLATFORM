import type {
  RenderedEmail,
  PasswordResetData,
  InvoiceCreatedData,
  PaymentReceivedData,
  CollectionEscalationData,
  WelcomeData,
  DocumentCommentAddedData,
  NewDocumentUploadedData,
  FinancingTimelineDueData,
  KycApprovedData,
  KycRejectedData,
  SettlementCompleteData,
  BuyerConfirmationData,
  ConfirmationReminderData,
  PaymentFundedData,
  PricingReadyData,
  PaymentFailedData,
  InfoRequestedData,
  InvoiceRejectedData,
  SlaEscalationData,
  AssessmentSlaReminderData,
  AssessmentSlaOverdueData,
  InvoiceDisputeData,
  BuyerConfirmationOverdueData,
  OverdueNotificationData,
  EscalationNotificationData,
  InvoiceReminderData,
  BuyerPaymentEscalationData,
  InvoiceDefaultedData,
  SupplierPaymentNotificationData,
  EscalationDocumentSentData,
  ComplaintFiledData,
  ComplaintResolvedData,
  ComplaintEscalatedData,
  AmlClearedData,
  AmlReviewRequiredData,
  FacilityUtilisationAlertData,
  FacilityMaturityAlertData,
  CollateralExpiryWarningData,
  DocumentExpiryWarningData,
  SupplierFeedbackData,
  BuyerRequestSubmittedData,
  BuyerRequestReviewedData,
  InactiveAccountWarningData,
  EmailVerificationData,
  NewDeviceLoginData,
} from './notifications.types';

// =========================================================================
// Shared layout
// =========================================================================

const BRAND_COLOR = '#1a5276';
const BRAND_NAME = 'RIS Platform';

/**
 * Wrap body HTML in a responsive, inline-CSS email layout.
 * Keeps templates DRY while staying mobile-friendly.
 */
function wrapLayout(title: string, bodyHtml: string): string {
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1.0">',
    `<title>${title}</title></head>`,
    '<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">',
    '<tr><td align="center" style="padding:20px 10px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0"',
    ' style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;">',
    `<tr><td style="background:${BRAND_COLOR};padding:24px;border-radius:8px 8px 0 0;">`,
    `<h1 style="color:#ffffff;margin:0;font-size:22px;">${BRAND_NAME}</h1>`,
    '</td></tr>',
    `<tr><td style="padding:32px 24px;">${bodyHtml}</td></tr>`,
    '<tr><td style="padding:16px 24px;border-top:1px solid #eee;',
    'font-size:12px;color:#888;text-align:center;">',
    `&copy; ${new Date().getFullYear()} Rapha Integrated Solutions, Uganda. All rights reserved.`,
    '</td></tr></table></td></tr></table></body></html>',
  ].join('');
}

// =========================================================================
// Template: password_reset
// =========================================================================

/** Render password reset email with reset URL, expiry, and user name. */
export function renderPasswordReset(data: PasswordResetData): RenderedEmail {
  const expiry = data.expiry_minutes || 60;
  const name = data.user_name || 'User';
  const subject = 'RIS Platform — Password Reset';

  const body = buildPasswordResetBody(name, data.token_url, expiry);
  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${name},`,
    '',
    'We received a request to reset your password.',
    `Reset your password: ${data.token_url}`,
    `This link expires in ${expiry} minutes.`,
    '',
    'If you did not request this, please ignore this email.',
    '',
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

function buildPasswordResetBody(name: string, tokenUrl: string, expiry: number): string {
  return [
    `<p style="margin:0 0 16px;color:#333;">Dear ${name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    'We received a request to reset your password.</p>',
    '<p style="margin:0 0 24px;text-align:center;">',
    `<a href="${tokenUrl}" style="display:inline-block;padding:12px 32px;`,
    `background:${BRAND_COLOR};color:#fff;text-decoration:none;`,
    'border-radius:4px;font-weight:bold;">Reset Password</a></p>',
    `<p style="margin:0 0 16px;color:#666;font-size:14px;">`,
    `This link expires in ${expiry} minutes.</p>`,
    '<p style="margin:0;color:#666;font-size:14px;">',
    'If you did not request this, please ignore this email.</p>',
  ].join('');
}

// =========================================================================
// Template: invoice_created
// =========================================================================

/** Render invoice created email with invoice details. */
export function renderInvoiceCreated(data: InvoiceCreatedData): RenderedEmail {
  const subject = `Invoice ${data.invoice_number} Created — UGX ${data.amount}`;

  const body = buildInvoiceCreatedBody(data);
  const html = wrapLayout(subject, body);

  const text = [
    `Invoice ${data.invoice_number} has been created.`,
    '',
    `Amount: UGX ${data.amount}`,
    `Buyer: ${data.buyer_name}`,
    `Due Date: ${data.due_date}`,
    '',
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

function buildInvoiceCreatedBody(data: InvoiceCreatedData): string {
  return [
    '<p style="margin:0 0 16px;color:#333;">',
    `Invoice <strong>${data.invoice_number}</strong> has been created.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Amount', `UGX ${data.amount}`),
    buildRow('Buyer', data.buyer_name),
    buildRow('Due Date', data.due_date),
    '</table>',
  ].join('');
}

// =========================================================================
// Template: payment_received
// =========================================================================

/** Render payment received email with payment details. */
export function renderPaymentReceived(data: PaymentReceivedData): RenderedEmail {
  const subject = `Payment Received — UGX ${data.amount}`;

  const body = buildPaymentReceivedBody(data);
  const html = wrapLayout(subject, body);

  const text = [
    `Payment of UGX ${data.amount} has been received.`,
    '',
    `Reference: ${data.reference}`,
    `Remaining Balance: UGX ${data.remaining_balance}`,
    '',
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

function buildPaymentReceivedBody(data: PaymentReceivedData): string {
  return [
    '<p style="margin:0 0 16px;color:#333;">',
    `Payment of <strong>UGX ${data.amount}</strong> has been received.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Reference', data.reference),
    buildRow('Remaining Balance', `UGX ${data.remaining_balance}`),
    '</table>',
    '<p style="margin:0;color:#333;">Thank you for your payment.</p>',
  ].join('');
}

// =========================================================================
// Template: collection_escalation
// =========================================================================

/** Render collection escalation email with overdue details. */
export function renderCollectionEscalation(data: CollectionEscalationData): RenderedEmail {
  const subject = `URGENT: Collection Escalation — Level ${data.escalation_level}`;

  const body = buildEscalationBody(data);
  const html = wrapLayout(subject, body);

  const text = [
    `Collection Escalation — Level ${data.escalation_level}`,
    '',
    `Amount Overdue: UGX ${data.amount_overdue}`,
    `Days Overdue: ${data.days_overdue}`,
    `Next Action: ${data.next_action}`,
    '',
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

function buildEscalationBody(data: CollectionEscalationData): string {
  return [
    '<p style="margin:0 0 16px;color:#c0392b;font-weight:bold;">',
    `Collection Escalation — Level ${data.escalation_level}</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Amount Overdue', `UGX ${data.amount_overdue}`),
    buildRow('Days Overdue', String(data.days_overdue)),
    buildRow('Next Action', data.next_action),
    '</table>',
  ].join('');
}

// =========================================================================
// Template: welcome
// =========================================================================

/** Render welcome email with user name and login URL. */
export function renderWelcome(data: WelcomeData): RenderedEmail {
  const subject = `Welcome to ${BRAND_NAME}`;

  const body = buildWelcomeBody(data);
  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.user_name},`,
    '',
    `Welcome to ${BRAND_NAME}!`,
    `Log in to get started: ${data.login_url}`,
    '',
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

function buildWelcomeBody(data: WelcomeData): string {
  return [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.user_name},</p>`,
    `<p style="margin:0 0 16px;color:#333;">Welcome to ${BRAND_NAME}!</p>`,
    '<p style="margin:0 0 24px;text-align:center;">',
    `<a href="${data.login_url}" style="display:inline-block;padding:12px 32px;`,
    `background:${BRAND_COLOR};color:#fff;text-decoration:none;`,
    'border-radius:4px;font-weight:bold;">Log In</a></p>',
  ].join('');
}

// =========================================================================
// Template: document_comment_added
// =========================================================================

/** Render email notifying a supplier that a reviewer has commented on their document. */
export function renderDocumentCommentAdded(data: DocumentCommentAddedData): RenderedEmail {
  const subject = `${BRAND_NAME} — Reviewer comment on your ${data.document_type} document`;

  const body = [
    '<p style="margin:0 0 16px;color:#333;">',
    'A reviewer has added a comment to one of your uploaded documents.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Document Type', data.document_type),
    buildRow('Comment Preview', data.comment_snippet),
    '</table>',
    '<p style="margin:0 0 24px;text-align:center;">',
    `<a href="${data.login_url}" style="display:inline-block;padding:12px 32px;`,
    `background:${BRAND_COLOR};color:#fff;text-decoration:none;`,
    'border-radius:4px;font-weight:bold;">Log In to View Comment</a></p>',
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    'A reviewer has commented on your document.',
    `Document Type: ${data.document_type}`,
    `Preview: ${data.comment_snippet}`,
    `Log in to respond: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: new_document_uploaded
// =========================================================================

/** Render email notifying staff that a supplier has uploaded a new document. */
export function renderNewDocumentUploaded(data: NewDocumentUploadedData): RenderedEmail {
  const subject = `${BRAND_NAME} — New document uploaded: ${data.document_type}`;

  const body = [
    '<p style="margin:0 0 16px;color:#333;">',
    'A supplier has uploaded a new document for review.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Document Type', data.document_type),
    '</table>',
    '<p style="margin:0 0 24px;text-align:center;">',
    `<a href="${data.login_url}" style="display:inline-block;padding:12px 32px;`,
    `background:${BRAND_COLOR};color:#fff;text-decoration:none;`,
    'border-radius:4px;font-weight:bold;">Review Document</a></p>',
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `A supplier has uploaded a ${data.document_type} document.`,
    `Review it here: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: financing_timeline_due
// =========================================================================

/** Render email notifying a supplier that their invoice funding is due soon. */
export function renderFinancingTimelineDue(data: FinancingTimelineDueData): RenderedEmail {
  const subject = `${BRAND_NAME} — Funding timeline due: Invoice ${data.invoice_number}`;

  const body = [
    '<p style="margin:0 0 16px;color:#333;">',
    'Your invoice funding period is approaching its due date.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Amount', `UGX ${data.amount}`),
    buildRow('Due Date', data.due_date),
    '</table>',
    '<p style="margin:0 0 24px;text-align:center;">',
    `<a href="${data.login_url}" style="display:inline-block;padding:12px 32px;`,
    `background:${BRAND_COLOR};color:#fff;text-decoration:none;`,
    'border-radius:4px;font-weight:bold;">View Invoice</a></p>',
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Invoice ${data.invoice_number} is due on ${data.due_date}.`,
    `Amount: UGX ${data.amount}`,
    `View details: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Table row helper
// =========================================================================

function buildRow(label: string, value: string): string {
  return [
    '<tr>',
    `<td style="padding:8px 0;color:#666;font-size:14px;">${label}</td>`,
    `<td style="padding:8px 0;color:#333;font-weight:bold;text-align:right;">`,
    `${value}</td></tr>`,
  ].join('');
}

// =========================================================================
// Template: kyc_approved
// =========================================================================

/** Render KYC approved notification to supplier. */
export function renderKycApproved(data: KycApprovedData): RenderedEmail {
  const subject = `${BRAND_NAME} — KYC Approved`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.user_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">Your KYC verification has been <strong>approved</strong>. ',
    'You can now submit invoices for financing.</p>',
    '<p style="margin:0 0 24px;text-align:center;">',
    `<a href="${data.login_url}" style="display:inline-block;padding:12px 32px;`,
    `background:${BRAND_COLOR};color:#fff;text-decoration:none;`,
    'border-radius:4px;font-weight:bold;">Log In</a></p>',
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.user_name},`,
    '',
    'Your KYC verification has been approved.',
    'You can now submit invoices for financing.',
    `Log in: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: kyc_rejected
// =========================================================================

/** Render KYC rejected notification to supplier. */
export function renderKycRejected(data: KycRejectedData): RenderedEmail {
  const subject = `${BRAND_NAME} — KYC Review: Action Required`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.user_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">Your KYC verification was not approved. ',
    'Please review the feedback below and re-submit your documents.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Reason', data.rejection_reason),
    '</table>',
    '<p style="margin:0 0 24px;text-align:center;">',
    `<a href="${data.login_url}" style="display:inline-block;padding:12px 32px;`,
    `background:${BRAND_COLOR};color:#fff;text-decoration:none;`,
    'border-radius:4px;font-weight:bold;">Re-submit Documents</a></p>',
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.user_name},`,
    '',
    'Your KYC verification was not approved.',
    `Reason: ${data.rejection_reason}`,
    'Please re-submit your documents.',
    `Log in: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Settlement Complete
// =========================================================================

export function renderSettlementComplete(data: SettlementCompleteData): RenderedEmail {
  const subject = `Settlement Complete — ${data.invoice_number}`;

  const body = [
    '<h2 style="margin:0 0 16px;color:#333;">Settlement Complete</h2>',
    `<p style="margin:0 0 16px;">The financing cycle for invoice <strong>${data.invoice_number}</strong> `,
    'has been fully settled and closed.</p>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ',
    'style="margin:0 0 24px;">',
    buildRow('Invoice', data.invoice_number),
    buildRow('Settlement ID', data.settlement_id),
    buildRow('Net Profit', `UGX ${data.net_profit}`),
    '</table>',
    '<p style="margin:0 0 24px;text-align:center;">',
    `<a href="${data.login_url}" style="display:inline-block;padding:12px 32px;`,
    `background:${BRAND_COLOR};color:#fff;text-decoration:none;`,
    'border-radius:4px;font-weight:bold;">View Settlement</a></p>',
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Settlement complete for invoice ${data.invoice_number}.`,
    `Net Profit: UGX ${data.net_profit}`,
    `View details: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Shared CTA button helper
// =========================================================================

function buildCta(href: string, label: string): string {
  return [
    '<p style="margin:0 0 24px;text-align:center;">',
    `<a href="${href}" style="display:inline-block;padding:12px 32px;`,
    `background:${BRAND_COLOR};color:#fff;text-decoration:none;`,
    `border-radius:4px;font-weight:bold;">${label}</a></p>`,
  ].join('');
}

function buildAlertCta(href: string, label: string): string {
  return [
    '<p style="margin:0 0 24px;text-align:center;">',
    `<a href="${href}" style="display:inline-block;padding:12px 32px;`,
    'background:#c0392b;color:#fff;text-decoration:none;',
    `border-radius:4px;font-weight:bold;">${label}</a></p>`,
  ].join('');
}

// =========================================================================
// Template: buyer_confirmation — magic link (most important email)
// =========================================================================

/** Render buyer confirmation magic-link email. */
export function renderBuyerConfirmation(data: BuyerConfirmationData): RenderedEmail {
  const subject = `Action Required — Confirm Invoice ${data.invoice_number} from ${data.supplier_name}`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.buyer_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `<strong>${data.supplier_name}</strong> has submitted invoice `,
    `<strong>${data.invoice_number}</strong> for early payment financing through ${BRAND_NAME}. `,
    'Please confirm that the amount and due date below are correct.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Supplier', data.supplier_name),
    buildRow('Amount', `UGX ${data.amount}`),
    buildRow('Due Date', data.due_date),
    '</table>',
    buildCta(data.confirmation_url, 'Confirm or Dispute Invoice'),
    '<p style="margin:0 0 8px;color:#666;font-size:14px;">',
    `This secure link expires in ${data.expiry_hours} hours.</p>`,
    '<p style="margin:0;color:#666;font-size:14px;">',
    'If you do not recognise this invoice, please click the link above and select "Dispute".</p>',
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.buyer_name},`,
    '',
    `${data.supplier_name} has submitted invoice ${data.invoice_number} for financing.`,
    `Amount: UGX ${data.amount}`,
    `Due Date: ${data.due_date}`,
    '',
    `Confirm or dispute: ${data.confirmation_url}`,
    `Link expires in ${data.expiry_hours} hours.`,
    '',
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: confirmation_reminder
// =========================================================================

/** Reminder to buyer to click confirmation link before deadline. */
export function renderConfirmationReminder(data: ConfirmationReminderData): RenderedEmail {
  const subject = `Reminder — Confirm Invoice ${data.invoice_number} before ${data.deadline}`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.buyer_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `This is a friendly reminder that invoice <strong>${data.invoice_number}</strong> `,
    `from <strong>${data.supplier_name}</strong> is still awaiting your confirmation.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Supplier', data.supplier_name),
    buildRow('Amount', `UGX ${data.amount}`),
    buildRow('Deadline', data.deadline),
    '</table>',
    buildCta(data.confirmation_url, 'Confirm Invoice Now'),
    '<p style="margin:0;color:#666;font-size:14px;">',
    'Reply if you need help confirming this invoice.</p>',
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.buyer_name},`,
    '',
    `Invoice ${data.invoice_number} from ${data.supplier_name} is awaiting your confirmation.`,
    `Amount: UGX ${data.amount}`,
    `Deadline: ${data.deadline}`,
    '',
    `Confirm now: ${data.confirmation_url}`,
    '',
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: payment_funded
// =========================================================================

/** Confirms invoice funded — disbursement initiated to supplier. */
export function renderPaymentFunded(data: PaymentFundedData): RenderedEmail {
  const subject = `Funded — Invoice ${data.invoice_number} — UGX ${data.amount_disbursed}`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.supplier_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `Good news — your invoice <strong>${data.invoice_number}</strong> has been funded `,
    'and the disbursement is on its way.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Amount Disbursed', `UGX ${data.amount_disbursed}`),
    buildRow('Payment Reference', data.reference),
    buildRow('Expected Arrival', data.expected_arrival),
    '</table>',
    buildCta(data.login_url, 'View Disbursement'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.supplier_name},`,
    '',
    `Invoice ${data.invoice_number} has been funded.`,
    `Amount Disbursed: UGX ${data.amount_disbursed}`,
    `Reference: ${data.reference}`,
    `Expected Arrival: ${data.expected_arrival}`,
    '',
    `View details: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: pricing_ready
// =========================================================================

/** Invoice has been priced — supplier must accept or dispute. */
export function renderPricingReady(data: PricingReadyData): RenderedEmail {
  const subject = `Pricing Ready — Invoice ${data.invoice_number}`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.supplier_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `We have completed pricing for invoice <strong>${data.invoice_number}</strong>. `,
    'Please review the offer below and accept or dispute the terms.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Face Value', `UGX ${data.face_value}`),
    buildRow('Advance Amount', `UGX ${data.advance_amount}`),
    buildRow('Discount', `UGX ${data.discount_amount}`),
    buildRow('Offer Expires', data.expiry),
    '</table>',
    buildCta(data.login_url, 'Review Pricing Offer'),
    '<p style="margin:0;color:#666;font-size:14px;">',
    'If you do not respond before the offer expires, the invoice will return to draft.</p>',
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.supplier_name},`,
    '',
    `Pricing is ready for invoice ${data.invoice_number}.`,
    `Face Value: UGX ${data.face_value}`,
    `Advance: UGX ${data.advance_amount}`,
    `Discount: UGX ${data.discount_amount}`,
    `Offer expires: ${data.expiry}`,
    '',
    `Review and respond: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: payment_failed
// =========================================================================

/** Payment provider returned an error during disbursement (finance_manager). */
export function renderPaymentFailed(data: PaymentFailedData): RenderedEmail {
  const subject = `ACTION REQUIRED — Payment Failed — Invoice ${data.invoice_number}`;

  const body = [
    '<p style="margin:0 0 16px;color:#c0392b;font-weight:bold;">',
    'Payment provider returned an error during disbursement.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Amount', `UGX ${data.amount}`),
    buildRow('Provider', data.provider),
    buildRow('Attempts', String(data.attempts)),
    buildRow('Error', data.error_message),
    '</table>',
    '<p style="margin:0 0 16px;color:#333;">',
    'The invoice has been marked as failed and will not retry automatically. ',
    'Please investigate and reissue once resolved.</p>',
    buildAlertCta(data.login_url, 'Investigate Failure'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Payment failed for invoice ${data.invoice_number}.`,
    `Amount: UGX ${data.amount}`,
    `Provider: ${data.provider}`,
    `Attempts: ${data.attempts}`,
    `Error: ${data.error_message}`,
    '',
    `Investigate: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: info_requested
// =========================================================================

/** Credit officer requesting more information about an invoice. */
export function renderInfoRequested(data: InfoRequestedData): RenderedEmail {
  const subject = `Information Requested — Invoice ${data.invoice_number}`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.supplier_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `Our credit officer <strong>${data.officer_name}</strong> has requested additional `,
    `information regarding invoice <strong>${data.invoice_number}</strong>.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Requested Information', data.requested_info),
    buildRow('Reviewing Officer', data.officer_name),
    buildRow('Response Deadline', data.deadline),
    '</table>',
    buildCta(data.login_url, 'Provide Information'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.supplier_name},`,
    '',
    `Additional information is needed for invoice ${data.invoice_number}.`,
    `Requested: ${data.requested_info}`,
    `Officer: ${data.officer_name}`,
    `Deadline: ${data.deadline}`,
    '',
    `Respond here: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: invoice_rejected
// =========================================================================

/** Invoice rejected by credit officer or risk engine. */
export function renderInvoiceRejected(data: InvoiceRejectedData): RenderedEmail {
  const subject = `Invoice ${data.invoice_number} — Decision: Not Approved`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.supplier_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `After review, invoice <strong>${data.invoice_number}</strong> has not been approved `,
    'for financing at this time.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Reviewed By', data.rejected_by),
    buildRow('Reason', data.rejection_reason),
    '</table>',
    '<p style="margin:0 0 16px;color:#333;">',
    'You are welcome to address the feedback above and submit a revised invoice.</p>',
    buildCta(data.login_url, 'View Decision'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.supplier_name},`,
    '',
    `Invoice ${data.invoice_number} was not approved.`,
    `Reviewed by: ${data.rejected_by}`,
    `Reason: ${data.rejection_reason}`,
    '',
    `View decision: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: sla_escalation
// =========================================================================

/** Invoice assessment SLA breached — credit officer + management. */
export function renderSlaEscalation(data: SlaEscalationData): RenderedEmail {
  const subject = `SLA BREACH — Invoice ${data.invoice_number} — ${data.hours_overdue}h overdue`;

  const body = [
    '<p style="margin:0 0 16px;color:#c0392b;font-weight:bold;">',
    `Assessment SLA breached for invoice ${data.invoice_number}.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Supplier', data.supplier_name),
    buildRow('Assigned Officer', data.assigned_officer),
    buildRow('Hours Overdue', String(data.hours_overdue)),
    buildRow('SLA Deadline', data.sla_deadline),
    '</table>',
    buildAlertCta(data.login_url, 'Open Assessment'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `SLA breach — invoice ${data.invoice_number}.`,
    `Supplier: ${data.supplier_name}`,
    `Officer: ${data.assigned_officer}`,
    `Hours Overdue: ${data.hours_overdue}`,
    `SLA Deadline: ${data.sla_deadline}`,
    '',
    `Open: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: assessment_sla_reminder (Day 3)
// =========================================================================

/** Day 3 warning — assessment SLA approaching. */
export function renderAssessmentSlaReminder(data: AssessmentSlaReminderData): RenderedEmail {
  const subject = `Assessment Reminder — Invoice ${data.invoice_number} (Day ${data.days_in_queue})`;

  const body = [
    '<p style="margin:0 0 16px;color:#333;">',
    `Invoice <strong>${data.invoice_number}</strong> has been awaiting assessment for `,
    `${data.days_in_queue} day(s). Please review before the SLA deadline.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Supplier', data.supplier_name),
    buildRow('Days in Queue', String(data.days_in_queue)),
    buildRow('SLA Deadline', data.sla_deadline),
    '</table>',
    buildCta(data.login_url, 'Open Assessment'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Invoice ${data.invoice_number} — day ${data.days_in_queue} in queue.`,
    `Supplier: ${data.supplier_name}`,
    `SLA Deadline: ${data.sla_deadline}`,
    '',
    `Open: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: assessment_sla_overdue (Day 7)
// =========================================================================

/** Day 7 — assessment SLA breached. */
export function renderAssessmentSlaOverdue(data: AssessmentSlaOverdueData): RenderedEmail {
  const subject = `OVERDUE — Assessment for Invoice ${data.invoice_number}`;

  const body = [
    '<p style="margin:0 0 16px;color:#c0392b;font-weight:bold;">',
    `Assessment overdue — invoice ${data.invoice_number} has been in queue `,
    `for ${data.days_in_queue} days.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Supplier', data.supplier_name),
    buildRow('Assigned Officer', data.assigned_officer),
    buildRow('Days in Queue', String(data.days_in_queue)),
    '</table>',
    '<p style="margin:0 0 16px;color:#333;">',
    'Management has been copied on this notice. Please action immediately.</p>',
    buildAlertCta(data.login_url, 'Action Now'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Assessment OVERDUE — invoice ${data.invoice_number}.`,
    `Supplier: ${data.supplier_name}`,
    `Officer: ${data.assigned_officer}`,
    `Days in Queue: ${data.days_in_queue}`,
    '',
    `Action: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: invoice_dispute
// =========================================================================

/** Buyer filed a dispute against an invoice. */
export function renderInvoiceDispute(data: InvoiceDisputeData): RenderedEmail {
  const subject = `Dispute Filed — Invoice ${data.invoice_number}`;

  const body = [
    '<p style="margin:0 0 16px;color:#c0392b;font-weight:bold;">',
    'A buyer has filed a dispute against an invoice.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Supplier', data.supplier_name),
    buildRow('Buyer', data.buyer_name),
    buildRow('Filed At', data.filed_at),
    buildRow('Reason', data.dispute_reason),
    '</table>',
    buildAlertCta(data.login_url, 'Review Dispute'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dispute filed on invoice ${data.invoice_number}.`,
    `Supplier: ${data.supplier_name}`,
    `Buyer: ${data.buyer_name}`,
    `Filed: ${data.filed_at}`,
    `Reason: ${data.dispute_reason}`,
    '',
    `Review: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: buyer_confirmation_overdue
// =========================================================================

/** Buyer hasn't confirmed an invoice within the window — credit_officer notice. */
export function renderBuyerConfirmationOverdue(data: BuyerConfirmationOverdueData): RenderedEmail {
  const subject = `Buyer Confirmation Overdue — Invoice ${data.invoice_number}`;

  const body = [
    '<p style="margin:0 0 16px;color:#333;">',
    `The buyer has not confirmed invoice <strong>${data.invoice_number}</strong> within `,
    'the expected window.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Supplier', data.supplier_name),
    buildRow('Buyer', data.buyer_name),
    buildRow('Hours Overdue', String(data.hours_overdue)),
    '</table>',
    buildCta(data.login_url, 'Open Invoice'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Buyer confirmation overdue — invoice ${data.invoice_number}.`,
    `Supplier: ${data.supplier_name}`,
    `Buyer: ${data.buyer_name}`,
    `Hours Overdue: ${data.hours_overdue}`,
    '',
    `Open: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: overdue_notification (gentle first reminder to buyer)
// =========================================================================

/** Gentle first overdue reminder to buyer. */
export function renderOverdueNotification(data: OverdueNotificationData): RenderedEmail {
  const subject = `Friendly Reminder — Invoice ${data.invoice_number} is overdue`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.buyer_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `Our records show that invoice <strong>${data.invoice_number}</strong> is now `,
    `${data.days_overdue} day(s) past its due date. If payment has already been made, `,
    'please disregard this notice.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Amount Due', `UGX ${data.amount_due}`),
    buildRow('Days Overdue', String(data.days_overdue)),
    buildRow('Payment Instructions', data.payment_instructions),
    '</table>',
    '<p style="margin:0;color:#666;font-size:14px;">',
    `Reply or contact us at ${data.contact_email} if you need help.</p>`,
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.buyer_name},`,
    '',
    `Invoice ${data.invoice_number} is ${data.days_overdue} day(s) overdue.`,
    `Amount Due: UGX ${data.amount_due}`,
    `Payment Instructions: ${data.payment_instructions}`,
    '',
    `Need help? ${data.contact_email}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: escalation_notification (internal tier triggered)
// =========================================================================

/** Internal escalation tier triggered — buyer + management. */
export function renderEscalationNotification(data: EscalationNotificationData): RenderedEmail {
  const subject = `Escalation Level ${data.escalation_level} — Invoice ${data.invoice_number}`;

  const body = [
    '<p style="margin:0 0 16px;color:#c0392b;font-weight:bold;">',
    `Collection Escalation — Level ${data.escalation_level}</p>`,
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.buyer_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `Invoice <strong>${data.invoice_number}</strong> is now ${data.days_overdue} day(s) `,
    'overdue. This matter has been escalated internally.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Amount Due', `UGX ${data.amount_due}`),
    buildRow('Days Overdue', String(data.days_overdue)),
    buildRow('Escalation Level', data.escalation_level),
    buildRow('Next Action', data.next_action),
    '</table>',
    '<p style="margin:0;color:#666;font-size:14px;">',
    `Contact ${data.contact_email} immediately to discuss settlement.</p>`,
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Escalation Level ${data.escalation_level} — invoice ${data.invoice_number}.`,
    `Dear ${data.buyer_name},`,
    `Amount Due: UGX ${data.amount_due}`,
    `Days Overdue: ${data.days_overdue}`,
    `Next Action: ${data.next_action}`,
    '',
    `Contact: ${data.contact_email}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: invoice_reminder (scheduled payment reminder)
// =========================================================================

/** Scheduled payment reminder to buyer. */
export function renderInvoiceReminder(data: InvoiceReminderData): RenderedEmail {
  const subject = `Payment Reminder — Invoice ${data.invoice_number} due ${data.due_date}`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.buyer_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `This is a scheduled reminder that invoice <strong>${data.invoice_number}</strong> `,
    `is due on <strong>${data.due_date}</strong>.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Amount Due', `UGX ${data.amount_due}`),
    buildRow('Due Date', data.due_date),
    buildRow('Payment Instructions', data.payment_instructions),
    '</table>',
    '<p style="margin:0;color:#666;font-size:14px;">',
    'Reply if you need help arranging payment.</p>',
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.buyer_name},`,
    '',
    `Invoice ${data.invoice_number} is due on ${data.due_date}.`,
    `Amount: UGX ${data.amount_due}`,
    `Payment Instructions: ${data.payment_instructions}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: buyer_payment_escalation (firmer tone)
// =========================================================================

/** Firmer-toned escalation — payment significantly overdue. */
export function renderBuyerPaymentEscalation(data: BuyerPaymentEscalationData): RenderedEmail {
  const subject = `URGENT — Invoice ${data.invoice_number} ${data.days_overdue} days past due`;

  const body = [
    '<p style="margin:0 0 16px;color:#c0392b;font-weight:bold;">',
    'This invoice is significantly overdue and requires your immediate attention.</p>',
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.buyer_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `Invoice <strong>${data.invoice_number}</strong> remains unpaid `,
    `${data.days_overdue} day(s) after its due date. We must hear from you immediately to `,
    'avoid further action.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Amount Due', `UGX ${data.amount_due}`),
    buildRow('Days Overdue', String(data.days_overdue)),
    buildRow('Next Consequence', data.consequence),
    '</table>',
    '<p style="margin:0;color:#333;font-weight:bold;">',
    `Contact ${data.contact_email} today.</p>`,
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `URGENT — Invoice ${data.invoice_number} is ${data.days_overdue} days overdue.`,
    `Dear ${data.buyer_name},`,
    `Amount Due: UGX ${data.amount_due}`,
    `Next Consequence: ${data.consequence}`,
    '',
    `Contact immediately: ${data.contact_email}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: invoice_defaulted
// =========================================================================

/** Invoice has moved to defaulted status — buyer + management. */
export function renderInvoiceDefaulted(data: InvoiceDefaultedData): RenderedEmail {
  const subject = `NOTICE OF DEFAULT — Invoice ${data.invoice_number}`;

  const body = [
    '<p style="margin:0 0 16px;color:#c0392b;font-weight:bold;">',
    'Notice of Default</p>',
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.buyer_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `Invoice <strong>${data.invoice_number}</strong> has been formally classified `,
    'as defaulted. Continued non-payment will result in the next legal action shown below.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Amount Outstanding', `UGX ${data.amount_outstanding}`),
    buildRow('Days Overdue', String(data.days_overdue)),
    buildRow('Next Legal Action', data.next_legal_action),
    '</table>',
    '<p style="margin:0;color:#333;font-weight:bold;">',
    `Contact ${data.contact_email} to discuss settlement options.</p>`,
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `NOTICE OF DEFAULT — invoice ${data.invoice_number}.`,
    `Dear ${data.buyer_name},`,
    `Amount Outstanding: UGX ${data.amount_outstanding}`,
    `Days Overdue: ${data.days_overdue}`,
    `Next Legal Action: ${data.next_legal_action}`,
    '',
    `Contact: ${data.contact_email}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: supplier_payment_notification (collection complete)
// =========================================================================

/** Buyer paid — collection complete notification to supplier. */
export function renderSupplierPaymentNotification(
  data: SupplierPaymentNotificationData,
): RenderedEmail {
  const subject = `Collection Complete — Invoice ${data.invoice_number}`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.supplier_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `The buyer has settled invoice <strong>${data.invoice_number}</strong> in full. `,
    'The collection cycle is now closed.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Amount Collected', `UGX ${data.amount_collected}`),
    buildRow('Paid On', data.paid_on),
    '</table>',
    buildCta(data.login_url, 'View Statement'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.supplier_name},`,
    '',
    `Invoice ${data.invoice_number} has been collected.`,
    `Amount: UGX ${data.amount_collected}`,
    `Paid On: ${data.paid_on}`,
    '',
    `View: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: escalation_document_sent
// =========================================================================

/** Demand letter / legal escalation document sent to buyer. */
export function renderEscalationDocumentSent(data: EscalationDocumentSentData): RenderedEmail {
  const subject = `${data.document_type} Issued — Invoice ${data.invoice_number}`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.buyer_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `A formal <strong>${data.document_type}</strong> has been issued in respect of invoice `,
    `<strong>${data.invoice_number}</strong>. Please respond before the deadline below.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Document Type', data.document_type),
    buildRow('Amount Outstanding', `UGX ${data.amount_outstanding}`),
    buildRow('Response Deadline', data.response_deadline),
    '</table>',
    '<p style="margin:0;color:#333;font-weight:bold;">',
    `Reply to ${data.contact_email} to acknowledge receipt and arrange settlement.</p>`,
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `${data.document_type} issued — invoice ${data.invoice_number}.`,
    `Dear ${data.buyer_name},`,
    `Amount Outstanding: UGX ${data.amount_outstanding}`,
    `Response Deadline: ${data.response_deadline}`,
    '',
    `Reply: ${data.contact_email}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: complaint_filed
// =========================================================================

/** New complaint logged — compliance_officer + management. */
export function renderComplaintFiled(data: ComplaintFiledData): RenderedEmail {
  const subject = `New Complaint Filed — ${data.complaint_id}`;

  const body = [
    '<p style="margin:0 0 16px;color:#333;">',
    `A new complaint has been logged in the system.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Complaint ID', data.complaint_id),
    buildRow('Complainant', data.complainant_name),
    buildRow('Category', data.category),
    buildRow('Filed At', data.filed_at),
    buildRow('Summary', data.summary),
    '</table>',
    buildCta(data.login_url, 'Open Complaint'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `New complaint filed — ${data.complaint_id}.`,
    `Complainant: ${data.complainant_name}`,
    `Category: ${data.category}`,
    `Filed: ${data.filed_at}`,
    `Summary: ${data.summary}`,
    '',
    `Open: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: complaint_resolved
// =========================================================================

/** Complaint marked resolved with resolution notes. */
export function renderComplaintResolved(data: ComplaintResolvedData): RenderedEmail {
  const subject = `Complaint Resolved — ${data.complaint_id}`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.complainant_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `Your complaint <strong>${data.complaint_id}</strong> has been resolved. `,
    'A summary of the resolution is below.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Complaint ID', data.complaint_id),
    buildRow('Resolved By', data.resolved_by),
    buildRow('Resolved At', data.resolved_at),
    buildRow('Resolution', data.resolution_summary),
    '</table>',
    buildCta(data.login_url, 'View Resolution'),
    '<p style="margin:0;color:#666;font-size:14px;">',
    'Reply if you have any further questions about this resolution.</p>',
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.complainant_name},`,
    '',
    `Complaint ${data.complaint_id} has been resolved.`,
    `Resolved By: ${data.resolved_by}`,
    `Resolved At: ${data.resolved_at}`,
    `Resolution: ${data.resolution_summary}`,
    '',
    `View: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: complaint_escalated
// =========================================================================

/** Complaint escalated to higher tier — management. */
export function renderComplaintEscalated(data: ComplaintEscalatedData): RenderedEmail {
  const subject = `Complaint Escalated — ${data.complaint_id}`;

  const body = [
    '<p style="margin:0 0 16px;color:#c0392b;font-weight:bold;">',
    'A complaint has been escalated and requires your attention.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Complaint ID', data.complaint_id),
    buildRow('Complainant', data.complainant_name),
    buildRow('Escalated To', data.escalated_to),
    buildRow('Reason', data.escalation_reason),
    '</table>',
    buildAlertCta(data.login_url, 'Review Escalation'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Complaint escalated — ${data.complaint_id}.`,
    `Complainant: ${data.complainant_name}`,
    `Escalated To: ${data.escalated_to}`,
    `Reason: ${data.escalation_reason}`,
    '',
    `Review: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: aml_cleared
// =========================================================================

/** Compliance officer cleared AML hold on an invoice — finance_manager. */
export function renderAmlCleared(data: AmlClearedData): RenderedEmail {
  const subject = `AML Cleared — Invoice ${data.invoice_number}`;

  const body = [
    '<p style="margin:0 0 16px;color:#333;">',
    `The AML hold on invoice <strong>${data.invoice_number}</strong> has been cleared. `,
    'Payment processing may now proceed.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Supplier', data.supplier_name),
    buildRow('Cleared By', data.cleared_by),
    buildRow('Cleared At', data.cleared_at),
    buildRow('Notes', data.notes),
    '</table>',
    buildCta(data.login_url, 'Continue Processing'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `AML cleared — invoice ${data.invoice_number}.`,
    `Supplier: ${data.supplier_name}`,
    `Cleared By: ${data.cleared_by} at ${data.cleared_at}`,
    `Notes: ${data.notes}`,
    '',
    `Continue: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: aml_review_required
// =========================================================================

/** New invoice exceeds AML threshold — compliance review required. */
export function renderAmlReviewRequired(data: AmlReviewRequiredData): RenderedEmail {
  const subject = `AML Review Required — Invoice ${data.invoice_number}`;

  const body = [
    '<p style="margin:0 0 16px;color:#c0392b;font-weight:bold;">',
    'AML threshold exceeded — compliance review required before payment.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Invoice Number', data.invoice_number),
    buildRow('Supplier', data.supplier_name),
    buildRow('Face Value', `UGX ${data.face_value}`),
    buildRow('Threshold', `UGX ${data.threshold}`),
    '</table>',
    buildAlertCta(data.login_url, 'Begin AML Review'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `AML review required — invoice ${data.invoice_number}.`,
    `Supplier: ${data.supplier_name}`,
    `Face Value: UGX ${data.face_value}`,
    `Threshold: UGX ${data.threshold}`,
    '',
    `Review: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: facility_utilisation_alert
// =========================================================================

/** Bank facility utilisation crossed threshold. */
export function renderFacilityUtilisationAlert(data: FacilityUtilisationAlertData): RenderedEmail {
  const subject = `Facility Utilisation Alert — ${data.facility_name} at ${data.utilisation_pct}%`;

  const body = [
    '<p style="margin:0 0 16px;color:#c0392b;font-weight:bold;">',
    `Facility utilisation has crossed the ${data.threshold_pct}% threshold.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Facility', data.facility_name),
    buildRow('Utilisation', `${data.utilisation_pct}%`),
    buildRow('Threshold', `${data.threshold_pct}%`),
    buildRow('Utilised', `UGX ${data.utilised_amount}`),
    buildRow('Total Limit', `UGX ${data.total_limit}`),
    '</table>',
    buildAlertCta(data.login_url, 'Review Facility'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Facility ${data.facility_name} utilisation: ${data.utilisation_pct}%`,
    `Threshold: ${data.threshold_pct}%`,
    `Utilised: UGX ${data.utilised_amount} of UGX ${data.total_limit}`,
    '',
    `Review: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: facility_maturity_alert
// =========================================================================

/** Bank facility approaching maturity. */
export function renderFacilityMaturityAlert(data: FacilityMaturityAlertData): RenderedEmail {
  const subject = `Facility Maturity — ${data.facility_name} matures in ${data.days_to_maturity} days`;

  const body = [
    '<p style="margin:0 0 16px;color:#333;">',
    `Facility <strong>${data.facility_name}</strong> is approaching its maturity date. `,
    'Renewal or repayment planning should begin now.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Facility', data.facility_name),
    buildRow('Maturity Date', data.maturity_date),
    buildRow('Days to Maturity', String(data.days_to_maturity)),
    buildRow('Outstanding Balance', `UGX ${data.outstanding_balance}`),
    '</table>',
    buildCta(data.login_url, 'Open Facility'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Facility ${data.facility_name} matures in ${data.days_to_maturity} days.`,
    `Maturity Date: ${data.maturity_date}`,
    `Outstanding: UGX ${data.outstanding_balance}`,
    '',
    `Open: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: collateral_expiry_warning
// =========================================================================

/** Pledged collateral approaching expiry. */
export function renderCollateralExpiryWarning(data: CollateralExpiryWarningData): RenderedEmail {
  const subject = `Collateral Expiring — ${data.collateral_type} (${data.collateral_reference})`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.supplier_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `Your pledged <strong>${data.collateral_type}</strong> collateral is approaching its `,
    `expiry date. Please renew or replace before <strong>${data.expiry_date}</strong> to `,
    'continue accessing financing.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Collateral Type', data.collateral_type),
    buildRow('Reference', data.collateral_reference),
    buildRow('Expiry Date', data.expiry_date),
    buildRow('Days to Expiry', String(data.days_to_expiry)),
    '</table>',
    buildCta(data.login_url, 'Update Collateral'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.supplier_name},`,
    '',
    `Your ${data.collateral_type} collateral (${data.collateral_reference}) expires on ${data.expiry_date}.`,
    `Days to expiry: ${data.days_to_expiry}`,
    '',
    `Update: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: document_expiry_warning
// =========================================================================

/** KYC document approaching expiry. */
export function renderDocumentExpiryWarning(data: DocumentExpiryWarningData): RenderedEmail {
  const subject = `${data.document_type} Expiring — Renewal Required`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.supplier_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `Your <strong>${data.document_type}</strong> is approaching its expiry date. `,
    'Please upload a renewed copy to avoid any interruption to your account.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Document Type', data.document_type),
    buildRow('Expiry Date', data.expiry_date),
    buildRow('Days to Expiry', String(data.days_to_expiry)),
    '</table>',
    buildCta(data.login_url, 'Upload Renewal'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.supplier_name},`,
    '',
    `Your ${data.document_type} expires on ${data.expiry_date} (${data.days_to_expiry} days).`,
    'Please upload a renewed copy.',
    '',
    `Upload: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: supplier_feedback
// =========================================================================

/** New supplier feedback submitted — management. */
export function renderSupplierFeedback(data: SupplierFeedbackData): RenderedEmail {
  const subject = `Supplier Feedback — ${data.supplier_name} (${data.rating})`;

  const body = [
    '<p style="margin:0 0 16px;color:#333;">',
    `New feedback has been submitted by <strong>${data.supplier_name}</strong>.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Supplier', data.supplier_name),
    buildRow('Category', data.feedback_category),
    buildRow('Rating', data.rating),
    buildRow('Submitted At', data.submitted_at),
    buildRow('Comments', data.comments),
    '</table>',
    buildCta(data.login_url, 'View Feedback'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Supplier feedback — ${data.supplier_name}.`,
    `Category: ${data.feedback_category}`,
    `Rating: ${data.rating}`,
    `Submitted: ${data.submitted_at}`,
    `Comments: ${data.comments}`,
    '',
    `View: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: buyer_request_submitted
// =========================================================================

/** Supplier submitted a buyer onboarding request — management. */
export function renderBuyerRequestSubmitted(data: BuyerRequestSubmittedData): RenderedEmail {
  const subject = `New Buyer Request — ${data.buyer_name}`;

  const body = [
    '<p style="margin:0 0 16px;color:#333;">',
    `Supplier <strong>${data.supplier_name}</strong> has submitted a buyer onboarding `,
    'request for review.</p>',
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Supplier', data.supplier_name),
    buildRow('Buyer', data.buyer_name),
    buildRow('Buyer Contact', data.buyer_contact),
    buildRow('Submitted At', data.submitted_at),
    '</table>',
    buildCta(data.login_url, 'Review Request'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `New buyer request — ${data.buyer_name}.`,
    `Submitted by: ${data.supplier_name}`,
    `Buyer Contact: ${data.buyer_contact}`,
    `At: ${data.submitted_at}`,
    '',
    `Review: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: buyer_request_reviewed
// =========================================================================

/** Buyer onboarding request approved or rejected — supplier. */
export function renderBuyerRequestReviewed(data: BuyerRequestReviewedData): RenderedEmail {
  const subject = `Buyer Request ${data.decision} — ${data.buyer_name}`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.supplier_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `Your buyer onboarding request for <strong>${data.buyer_name}</strong> has been `,
    `<strong>${data.decision}</strong>.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Buyer', data.buyer_name),
    buildRow('Decision', data.decision),
    buildRow('Reviewer Notes', data.reviewer_notes),
    '</table>',
    buildCta(data.login_url, 'View Details'),
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.supplier_name},`,
    '',
    `Buyer request for ${data.buyer_name} — ${data.decision}.`,
    `Notes: ${data.reviewer_notes}`,
    '',
    `View: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: inactive_account_warning
// =========================================================================

/** Account inactive 90+ days; will be locked. */
export function renderInactiveAccountWarning(data: InactiveAccountWarningData): RenderedEmail {
  const subject = `${BRAND_NAME} — Account Inactive: Action Required`;

  const body = [
    `<p style="margin:0 0 16px;color:#333;">Dear ${data.user_name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `Your account has been inactive for ${data.days_inactive} days. For security, we will `,
    `lock the account on <strong>${data.lock_date}</strong> unless you sign in before then.</p>`,
    '<table role="presentation" style="width:100%;margin:0 0 16px;">',
    buildRow('Days Inactive', String(data.days_inactive)),
    buildRow('Lock Date', data.lock_date),
    '</table>',
    buildCta(data.login_url, 'Log In Now'),
    '<p style="margin:0;color:#666;font-size:14px;">',
    'Reply if you need help regaining access.</p>',
  ].join('');

  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${data.user_name},`,
    '',
    `Your account has been inactive for ${data.days_inactive} days.`,
    `It will be locked on ${data.lock_date} unless you sign in.`,
    '',
    `Log in: ${data.login_url}`,
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

// =========================================================================
// Template: email_verification
//
// Magic-link email sent the moment a supplier completes registration. The
// recipient clicks the link → backend marks users.email_verified=true →
// the supplier can log in. Until then, login is rejected with AuthError.
//
// Mirrors renderPasswordReset's shape (token-bearing magic link).
// =========================================================================

/** Render the supplier email verification magic-link email. */
export function renderEmailVerification(data: EmailVerificationData): RenderedEmail {
  const expiry = data.expiry_hours || 24;
  const name = data.user_name || 'Supplier';
  const subject = `${BRAND_NAME} — Verify your email address`;

  const body = buildEmailVerificationBody(name, data.verification_url, expiry);
  const html = wrapLayout(subject, body);

  const text = [
    `Dear ${name},`,
    '',
    `Welcome to ${BRAND_NAME}. To activate your supplier account and start`,
    'submitting invoices for early payment, please verify your email address.',
    '',
    `Click here to verify: ${data.verification_url}`,
    `This link expires in ${expiry} hours.`,
    '',
    'If you did not register for an account, please ignore this email.',
    '',
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

function buildEmailVerificationBody(name: string, verificationUrl: string, expiry: number): string {
  return [
    `<p style="margin:0 0 16px;color:#333;">Dear ${name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `Welcome to ${BRAND_NAME}. To activate your supplier account and start `,
    'submitting invoices for early payment, please verify your email address.</p>',
    '<p style="margin:0 0 24px;text-align:center;">',
    `<a href="${verificationUrl}" style="display:inline-block;padding:12px 32px;`,
    `background:${BRAND_COLOR};color:#fff;text-decoration:none;`,
    'border-radius:4px;font-weight:bold;">Verify Email Address</a></p>',
    `<p style="margin:0 0 16px;color:#666;font-size:14px;">`,
    `This link expires in ${expiry} hours.</p>`,
    '<p style="margin:0;color:#666;font-size:14px;">',
    'If you did not register for a RIS account, please ignore this email — ',
    'no account will be created.</p>',
  ].join('');
}

// =========================================================================
// new_device_login — REQ-AUTH-007
//
// Sent after a successful login from a user_agent not seen in last 30 days.
// Best-effort: queue dispatch failure does not block login (handled in
// auth.service.notifyIfNewDevice).
// =========================================================================

/** Render the "we noticed a new device" alert email. */
export function renderNewDeviceLogin(data: NewDeviceLoginData): RenderedEmail {
  const name = data.user_name || 'there';
  const ua = (data.user_agent || 'unknown device').slice(0, 80);
  const subject = `${BRAND_NAME} — New device sign-in`;

  const body = buildNewDeviceLoginBody(name, ua, data);
  const html = wrapLayout(subject, body);

  const text = [
    `Hello ${name},`,
    '',
    `We noticed a new device signing in to your ${BRAND_NAME} account.`,
    '',
    `When: ${data.login_timestamp}`,
    `From IP: ${data.ip_address}`,
    `Device: ${ua}`,
    '',
    'If this was you, no action is needed.',
    'If this was NOT you, change your password immediately:',
    data.reset_url,
    '',
    `— ${BRAND_NAME}`,
  ].join('\n');

  return { subject, html, text };
}

function buildNewDeviceLoginBody(name: string, ua: string, data: NewDeviceLoginData): string {
  return [
    `<p style="margin:0 0 16px;color:#333;">Hello ${name},</p>`,
    '<p style="margin:0 0 16px;color:#333;">',
    `We noticed a new device signing in to your ${BRAND_NAME} account.</p>`,
    `<table style="margin:0 0 24px;font-size:14px;color:#444;border-collapse:collapse;">`,
    `<tr><td style="padding:4px 12px 4px 0;color:#666;">When</td>`,
    `<td style="padding:4px 0;">${data.login_timestamp}</td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#666;">From IP</td>`,
    `<td style="padding:4px 0;">${data.ip_address}</td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#666;">Device</td>`,
    `<td style="padding:4px 0;">${ua}</td></tr></table>`,
    '<p style="margin:0 0 16px;color:#333;">If this was you, no action is needed.</p>',
    '<p style="margin:0 0 16px;color:#333;">If this was NOT you, change your password immediately:</p>',
    '<p style="margin:0 0 24px;text-align:center;">',
    `<a href="${data.reset_url}" style="display:inline-block;padding:12px 32px;`,
    `background:${BRAND_COLOR};color:#fff;text-decoration:none;`,
    'border-radius:4px;font-weight:bold;">Reset password</a></p>',
  ].join('');
}
