// Set env vars before imports
process.env.AT_API_KEY = 'test-at-key';
process.env.AT_USERNAME = 'ris-sandbox';
process.env.AT_SENDER_ID = 'RIS';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSmsSend = jest.fn();

jest.mock('africastalking', () => {
  return jest.fn().mockImplementation(() => ({
    SMS: {
      send: mockSmsSend,
    },
  }));
});

jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    audit: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { logger } from '../../../src/shared/logger';
import {
  initialiseSmsProvider,
  isSmsConfigured,
  sendSms,
  isValidUgandanPhone,
  renderSmsTemplate,
} from '../../../src/services/notifications/sms.provider';
import type { SmsTemplate } from '../../../src/services/notifications/notifications.types';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SmsProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // isValidUgandanPhone
  // =========================================================================

  describe('isValidUgandanPhone', () => {
    it('accepts valid Ugandan numbers', () => {
      expect(isValidUgandanPhone('+256700123456')).toBe(true);
      expect(isValidUgandanPhone('+256780000000')).toBe(true);
    });

    it('rejects invalid formats', () => {
      expect(isValidUgandanPhone('0700123456')).toBe(false);
      expect(isValidUgandanPhone('+254700123456')).toBe(false);
      expect(isValidUgandanPhone('+25670012345')).toBe(false);
      expect(isValidUgandanPhone('+2567001234567')).toBe(false);
      expect(isValidUgandanPhone('')).toBe(false);
    });
  });

  // =========================================================================
  // initialiseSmsProvider
  // =========================================================================

  describe('initialiseSmsProvider', () => {
    it('marks provider as configured when credentials are set', () => {
      process.env.AT_API_KEY = 'test-at-key';
      process.env.AT_USERNAME = 'ris-sandbox';
      initialiseSmsProvider();
      expect(isSmsConfigured()).toBe(true);
    });

    it('logs warning and does not configure when AT_API_KEY is empty string', () => {
      const originalKey = process.env.AT_API_KEY;
      process.env.AT_API_KEY = '';
      process.env.AT_USERNAME = 'ris-sandbox';

      initialiseSmsProvider();

      expect(logger.warn).toHaveBeenCalledWith(
        'AT_API_KEY or AT_USERNAME not set — SMS sending disabled',
        { component: 'sms-provider' },
      );

      process.env.AT_API_KEY = originalKey;
    });

    it('logs warning and does not configure when AT_API_KEY is undefined', () => {
      const originalKey = process.env.AT_API_KEY;
      delete process.env.AT_API_KEY;
      process.env.AT_USERNAME = 'ris-sandbox';

      initialiseSmsProvider();

      expect(logger.warn).toHaveBeenCalledWith(
        'AT_API_KEY or AT_USERNAME not set — SMS sending disabled',
        { component: 'sms-provider' },
      );

      process.env.AT_API_KEY = originalKey;
    });

    it('logs warning and does not configure when AT_USERNAME is empty string', () => {
      const originalUsername = process.env.AT_USERNAME;
      process.env.AT_API_KEY = 'test-at-key';
      process.env.AT_USERNAME = '';

      initialiseSmsProvider();

      expect(logger.warn).toHaveBeenCalledWith(
        'AT_API_KEY or AT_USERNAME not set — SMS sending disabled',
        { component: 'sms-provider' },
      );

      process.env.AT_USERNAME = originalUsername;
    });

    it('logs warning and does not configure when AT_USERNAME is undefined', () => {
      const originalUsername = process.env.AT_USERNAME;
      process.env.AT_API_KEY = 'test-at-key';
      delete process.env.AT_USERNAME;

      initialiseSmsProvider();

      expect(logger.warn).toHaveBeenCalledWith(
        'AT_API_KEY or AT_USERNAME not set — SMS sending disabled',
        { component: 'sms-provider' },
      );

      process.env.AT_USERNAME = originalUsername;
    });
  });

  // =========================================================================
  // renderSmsTemplate — str() and num() helper branches
  // =========================================================================

  describe('renderSmsTemplate — helper fallbacks', () => {
    it('str() uses fallback when value is not a string (number passed for name)', () => {
      // data.name is a number — str() should return '' (fallback)
      const result = renderSmsTemplate('payment_reminder', {
        name: 12345, // not a string
        amount: '1,000,000',
        invoice_no: 'INV-001',
        days: 10,
        paybill: '123456',
        ref: 'REF-001',
      });
      // name falls back to '' so "Dear ," appears
      expect(result.message).toContain('Dear ,');
    });

    it('num() uses fallback when value is not a number (string passed for days)', () => {
      // data.days is a string — num() should return 0 (fallback)
      const result = renderSmsTemplate('payment_reminder', {
        name: 'John',
        amount: '1,000,000',
        invoice_no: 'INV-001',
        days: 'overdue', // not a number
        paybill: '123456',
        ref: 'REF-001',
      });
      // Falls back to 0
      expect(result.message).toContain('0 days overdue');
    });

    it('str() uses fallback for amount when value is not a string', () => {
      const result = renderSmsTemplate('payment_confirmation', {
        amount: 99999, // number, not string
        ref: 'REF-002',
        balance: '500,000',
      });
      // Falls back to '0'
      expect(result.message).toContain('UGX 0');
    });

    it('num() uses fallback for escalation days when not a number', () => {
      const result = renderSmsTemplate('escalation_notice', {
        invoice_no: 'INV-003',
        days: 'many', // not a number
        amount: '5,000,000',
        contact: '+256700000000',
      });
      // Falls back to 0
      expect(result.message).toContain('0 days overdue');
    });
  });

  // =========================================================================
  // renderSmsTemplate — all templates
  // =========================================================================

  describe('renderSmsTemplate', () => {
    it('renders payment_reminder template', () => {
      const result = renderSmsTemplate('payment_reminder', {
        name: 'John',
        amount: '5,000,000',
        invoice_no: 'INV-001',
        days: 15,
        paybill: '123456',
        ref: 'REF-001',
      });
      expect(result.message).toContain('John');
      expect(result.message.length).toBeLessThanOrEqual(160);
    });

    it('renders payment_confirmation template', () => {
      const result = renderSmsTemplate('payment_confirmation', {
        amount: '3,000,000',
        ref: 'PAY-REF-001',
        balance: '2,000,000',
      });
      expect(result.message).toContain('3,000,000');
    });

    it('renders escalation_notice template', () => {
      const result = renderSmsTemplate('escalation_notice', {
        invoice_no: 'INV-002',
        days: 30,
        amount: '10,000,000',
        contact: '+256700123456',
      });
      expect(result.message).toContain('URGENT');
    });

    it('throws for an unknown template (exhaustive default branch)', () => {
      // Cast to bypass TypeScript's exhaustiveness check and exercise the default branch
      const unknown = 'completely_unknown_sms_template' as SmsTemplate;
      expect(() => renderSmsTemplate(unknown, {})).toThrow(
        'Unknown SMS template: completely_unknown_sms_template',
      );
    });
  });

  // =========================================================================
  // sendSms
  // =========================================================================

  describe('sendSms', () => {
    beforeEach(() => {
      // Ensure provider is configured for most tests
      process.env.AT_API_KEY = 'test-at-key';
      process.env.AT_USERNAME = 'ris-sandbox';
      process.env.AT_SENDER_ID = 'RIS';
      initialiseSmsProvider();
    });

    it("sends SMS via Africa's Talking and returns success", async () => {
      mockSmsSend.mockResolvedValue({
        Message: 'Sent to 1/1',
        Recipients: {
          messageId: 'AT-msg-001',
          status: 'fulfilled',
          statusCode: 101,
          number: '+256700123456',
          cost: 'UGX 1.00',
        },
      });

      const result = await sendSms('+256700123456', 'payment_confirmation', {
        amount: '1,000,000',
        ref: 'REF-001',
        balance: '500,000',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('africastalking');
      expect(result.messageId).toBe('AT-msg-001');
      expect(mockSmsSend).toHaveBeenCalledTimes(1);
    });

    it('returns success with undefined messageId when Recipients is absent', async () => {
      // Covers extractMessageId returning undefined when Recipients is undefined
      mockSmsSend.mockResolvedValue({
        Message: 'Sent to 1/1',
        // Recipients is absent
      });

      const result = await sendSms('+256700123456', 'payment_confirmation', {
        amount: '1,000,000',
        ref: 'REF-001',
        balance: '500,000',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();
    });

    it('rejects invalid phone numbers', async () => {
      const result = await sendSms('0700123456', 'payment_confirmation', {
        amount: '1,000,000',
        ref: 'REF-001',
        balance: '500,000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid Ugandan phone number');
      expect(mockSmsSend).not.toHaveBeenCalled();
    });

    it('returns failure when provider throws an Error instance', async () => {
      mockSmsSend.mockRejectedValue(new Error('Insufficient balance'));

      const result = await sendSms('+256700123456', 'payment_confirmation', {
        amount: '1,000,000',
        ref: 'REF-001',
        balance: '500,000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient balance');
    });

    it('returns failure with "Unknown error" when provider throws a non-Error value', async () => {
      // Covers `err instanceof Error ? err.message : 'Unknown error'` false branch
      mockSmsSend.mockRejectedValue('string-thrown-not-an-Error');

      const result = await sendSms('+256700123456', 'payment_confirmation', {
        amount: '1,000,000',
        ref: 'REF-001',
        balance: '500,000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('returns failure immediately when SMS provider is not configured', async () => {
      // Covers `if (!configured || !smsClient)` branch.
      // `configured` starts as `false` in a fresh module. Use isolateModules to get
      // a fresh copy where initialiseSmsProvider has never been called.
      await jest.isolateModulesAsync(async () => {
        // Remove credentials so the provider cannot be configured
        delete process.env.AT_API_KEY;
        delete process.env.AT_USERNAME;

        const freshModule =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../src/services/notifications/sms.provider') as typeof import('../../../src/services/notifications/sms.provider');

        const result = await freshModule.sendSms('+256700123456', 'payment_confirmation', {
          amount: '1,000,000',
          ref: 'REF-001',
          balance: '500,000',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('SMS provider not configured');
        expect(result.provider).toBe('africastalking');
        expect(mockSmsSend).not.toHaveBeenCalled();

        process.env.AT_API_KEY = 'test-at-key';
        process.env.AT_USERNAME = 'ris-sandbox';
      });
    });

    it('uses default sender ID "RIS" when AT_SENDER_ID is not set', async () => {
      mockSmsSend.mockResolvedValue({ Message: 'Sent', Recipients: undefined });
      const originalSender = process.env.AT_SENDER_ID;
      delete process.env.AT_SENDER_ID;

      const result = await sendSms('+256700123456', 'payment_confirmation', {
        amount: '1,000,000',
        ref: 'REF-001',
        balance: '500,000',
      });

      expect(result.success).toBe(true);
      expect(mockSmsSend).toHaveBeenCalledWith(expect.objectContaining({ from: 'RIS' }));

      process.env.AT_SENDER_ID = originalSender;
    });

    it('uses AT_SENDER_ID env var when it is set', async () => {
      // Covers the AT_SENDER_ID ?? 'RIS' left-hand (truthy) branch
      mockSmsSend.mockResolvedValue({ Message: 'Sent', Recipients: undefined });
      process.env.AT_SENDER_ID = 'RISPLATFORM';

      const result = await sendSms('+256700123456', 'payment_confirmation', {
        amount: '2,000,000',
        ref: 'REF-002',
        balance: '0',
      });

      expect(result.success).toBe(true);
      expect(mockSmsSend).toHaveBeenCalledWith(expect.objectContaining({ from: 'RISPLATFORM' }));

      process.env.AT_SENDER_ID = 'RIS';
    });

    it('returns success with messageId when Recipients.messageId is present', async () => {
      // Covers extractMessageId returning a defined messageId (BRDA:162,12,1 branch)
      mockSmsSend.mockResolvedValue({
        Message: 'Sent to 1/1',
        Recipients: {
          messageId: 'AT-extracted-id',
          status: 'Success',
          statusCode: 101,
          number: '+256700123456',
          cost: 'UGX 1.00',
        },
      });

      const result = await sendSms('+256700123456', 'payment_reminder', {
        name: 'David',
        amount: '500,000',
        invoice_no: 'INV-500',
        days: 5,
        paybill: '999888',
        ref: 'REF-EXT',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('AT-extracted-id');
    });

    it('passes correct recipient and message to the SMS client', async () => {
      // Verifies the send() call is made with the right shape (to, message, from)
      mockSmsSend.mockResolvedValue({ Message: 'Sent', Recipients: undefined });

      await sendSms('+256700123456', 'escalation_notice', {
        invoice_no: 'INV-ESC-01',
        days: 7,
        amount: '8,000,000',
        contact: '+256770000001',
      });

      expect(mockSmsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['+256700123456'],
          message: expect.stringContaining('URGENT') as unknown,
        }),
      );
    });
  });

  // =========================================================================
  // renderSmsTemplate — str() and num() truthy branches
  // =========================================================================

  describe('renderSmsTemplate — truthy helper branches', () => {
    it('str() returns value directly when value IS a string', () => {
      // Exercises the `typeof v === 'string' ? v : fallback` TRUE branch
      const result = renderSmsTemplate('payment_reminder', {
        name: 'StringValue',
        amount: '1,000',
        invoice_no: 'INV-STR',
        days: 3,
        paybill: '111222',
        ref: 'R001',
      });
      expect(result.message).toContain('StringValue');
    });

    it('num() returns value directly when value IS a number', () => {
      // Exercises the `typeof v === 'number' ? v : fallback` TRUE branch
      const result = renderSmsTemplate('payment_reminder', {
        name: 'NumTest',
        amount: '2,000',
        invoice_no: 'INV-NUM',
        days: 99,
        paybill: '333444',
        ref: 'R002',
      });
      expect(result.message).toContain('99 days overdue');
    });

    it('num() TRUE branch for escalation_notice days', () => {
      const result = renderSmsTemplate('escalation_notice', {
        invoice_no: 'INV-ESC',
        days: 14,
        amount: '3,000',
        contact: '+256700000000',
      });
      expect(result.message).toContain('14 days overdue');
    });
  });
});
