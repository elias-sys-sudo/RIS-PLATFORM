import AfricasTalking from 'africastalking';
import { logger } from '../../shared/logger';
import type { RenderedSms, SendResult, SmsTemplate } from './notifications.types';
import {
  renderPaymentReminder,
  renderPaymentConfirmation,
  renderEscalationNotice,
} from './sms.templates';

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
// Configuration
// =========================================================================

interface AtSmsResponse {
  Message: string;
  Recipients?: {
    statusCode: number;
    number: string;
    status: string;
    cost: string;
    messageId: string;
  };
}

interface SmsClient {
  send: (options: { to: string[]; message: string; from: string }) => Promise<AtSmsResponse>;
}

let smsClient: SmsClient | null = null;
let configured = false;

/** Ugandan phone number pattern: +256 followed by 9 digits. */
const UG_PHONE_REGEX = /^\+256\d{9}$/;

/** Initialise Africa's Talking SMS client. Call once at startup. */
export function initialiseSmsProvider(): void {
  const apiKey = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME;

  if (apiKey === undefined || apiKey === '' || username === undefined || username === '') {
    logger.warn('AT_API_KEY or AT_USERNAME not set — SMS sending disabled', {
      component: 'sms-provider',
    });
    return;
  }

  const at = AfricasTalking({ apiKey, username });
  smsClient = at.SMS;
  configured = true;
  logger.info('SMS provider initialised', { component: 'sms-provider' });
}

/** Check if the SMS provider is configured. */
export function isSmsConfigured(): boolean {
  return configured;
}

// =========================================================================
// Phone validation
// =========================================================================

/** Validate that a phone number is Ugandan format (+256XXXXXXXXX). */
export function isValidUgandanPhone(phone: string): boolean {
  return UG_PHONE_REGEX.test(phone);
}

// =========================================================================
// Template router
// =========================================================================

/** Render an SMS template by name with the given data. */
export function renderSmsTemplate(
  template: SmsTemplate,
  data: Record<string, unknown>,
): RenderedSms {
  switch (template) {
    case 'payment_reminder':
      return renderPaymentReminder({
        name: str(data.name),
        amount: str(data.amount, '0'),
        invoice_no: str(data.invoice_no),
        days: num(data.days),
        paybill: str(data.paybill),
        ref: str(data.ref),
      });
    case 'payment_confirmation':
      return renderPaymentConfirmation({
        amount: str(data.amount, '0'),
        ref: str(data.ref),
        balance: str(data.balance, '0'),
      });
    case 'escalation_notice':
      return renderEscalationNotice({
        invoice_no: str(data.invoice_no),
        days: num(data.days),
        amount: str(data.amount, '0'),
        contact: str(data.contact),
      });
    default: {
      const _exhaustive: never = template;
      throw new Error(`Unknown SMS template: ${String(_exhaustive)}`);
    }
  }
}

// =========================================================================
// Send SMS
// =========================================================================

/** Send an SMS via Africa's Talking. Returns result with timing. */
export async function sendSms(
  to: string,
  template: SmsTemplate,
  data: Record<string, unknown>,
): Promise<SendResult> {
  const start = Date.now();

  if (!configured || !smsClient) {
    return buildFailResult(start, 'SMS provider not configured');
  }

  if (!isValidUgandanPhone(to)) {
    return buildFailResult(start, `Invalid Ugandan phone number: ${to}`);
  }

  const rendered = renderSmsTemplate(template, data);
  const senderId = process.env.AT_SENDER_ID ?? 'RIS';

  try {
    const response = await smsClient.send({
      to: [to],
      message: rendered.message,
      from: senderId,
    });

    return buildSuccessResult(start, extractMessageId(response));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return buildFailResult(start, message);
  }
}

// =========================================================================
// Helpers
// =========================================================================

function extractMessageId(response: AtSmsResponse): string | undefined {
  return response.Recipients?.messageId ?? undefined;
}

function buildSuccessResult(start: number, messageId?: string): SendResult {
  return {
    success: true,
    provider: 'africastalking',
    messageId,
    durationMs: Date.now() - start,
  };
}

function buildFailResult(start: number, error: string): SendResult {
  return {
    success: false,
    provider: 'africastalking',
    error,
    durationMs: Date.now() - start,
  };
}
