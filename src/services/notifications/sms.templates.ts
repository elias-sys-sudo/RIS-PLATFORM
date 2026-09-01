import type {
  RenderedSms,
  PaymentReminderSmsData,
  PaymentConfirmationSmsData,
  EscalationNoticeSmsData,
} from './notifications.types';

// =========================================================================
// Constants
// =========================================================================

/** Maximum characters per SMS segment. */
const SMS_MAX_LENGTH = 160;

// =========================================================================
// Template: payment_reminder
// =========================================================================

/** Render payment reminder SMS. Truncates to 160 chars. */
export function renderPaymentReminder(data: PaymentReminderSmsData): RenderedSms {
  const message = truncate(
    `Dear ${data.name}, your payment of UGX ${data.amount} for invoice ${data.invoice_no} is ${data.days} days overdue. Pay via bank transfer to ${data.paybill}. Ref: ${data.ref}`,
  );
  return { message };
}

// =========================================================================
// Template: payment_confirmation
// =========================================================================

/** Render payment confirmation SMS. Truncates to 160 chars. */
export function renderPaymentConfirmation(data: PaymentConfirmationSmsData): RenderedSms {
  const message = truncate(
    `Payment of UGX ${data.amount} received. Ref: ${data.ref}. Balance: UGX ${data.balance}. Thank you.`,
  );
  return { message };
}

// =========================================================================
// Template: escalation_notice
// =========================================================================

/** Render escalation notice SMS. Truncates to 160 chars. */
export function renderEscalationNotice(data: EscalationNoticeSmsData): RenderedSms {
  const message = truncate(
    `URGENT: Invoice ${data.invoice_no} is ${data.days} days overdue. Amount: UGX ${data.amount}. Contact ${data.contact} to avoid further action.`,
  );
  return { message };
}

// =========================================================================
// Helpers
// =========================================================================

/** Truncate message to SMS segment limit, appending "..." if cut. */
function truncate(message: string): string {
  if (message.length <= SMS_MAX_LENGTH) {
    return message;
  }
  return message.slice(0, SMS_MAX_LENGTH - 3) + '...';
}
