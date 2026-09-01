// Set env vars before imports
process.env.SES_SMTP_HOST = 'email-smtp.eu-central-1.amazonaws.com';
process.env.SES_SMTP_PORT = '587';
process.env.SES_SMTP_USER = 'AKIATEST';
process.env.SES_SMTP_PASS = 'testpass';
process.env.SES_FROM_DEFAULT = 'noreply@ris.ug';
process.env.SES_FROM_CONFIRM = 'confirm@ris.ug';
process.env.SES_FROM_PAYMENTS = 'payments@ris.ug';
process.env.SES_FROM_KYC = 'kyc@ris.ug';
process.env.SES_FROM_COLLECTIONS = 'collections@ris.ug';
process.env.SES_FROM_SUPPORT = 'support@ris.ug';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSendMail = jest.fn();

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

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

import nodemailer from 'nodemailer';
import { logger } from '../../../src/shared/logger';
import {
  initialiseEmailProvider,
  isEmailConfigured,
  sendEmail,
  renderEmailTemplate,
} from '../../../src/services/notifications/email.provider';
import type { EmailTemplate } from '../../../src/services/notifications/notifications.types';

const mockCreateTransport = nodemailer.createTransport as unknown as jest.Mock;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmailProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockReset();
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
    // Restore baseline env vars (individual tests may unset them and not restore)
    process.env.SES_SMTP_HOST = 'email-smtp.eu-central-1.amazonaws.com';
    process.env.SES_SMTP_PORT = '587';
    process.env.SES_SMTP_USER = 'AKIATEST';
    process.env.SES_SMTP_PASS = 'testpass';
  });

  // =========================================================================
  // initialiseEmailProvider
  // =========================================================================

  describe('initialiseEmailProvider', () => {
    it('marks provider as configured when all SMTP env vars are set', () => {
      initialiseEmailProvider();
      expect(isEmailConfigured()).toBe(true);
      expect(mockCreateTransport).toHaveBeenCalled();
    });

    it('logs warning and returns without configuring when SES_SMTP_HOST is empty string', () => {
      const originalHost = process.env.SES_SMTP_HOST;
      process.env.SES_SMTP_HOST = '';

      initialiseEmailProvider();

      expect(logger.warn).toHaveBeenCalledWith(
        'SES SMTP credentials not set — email sending disabled',
        expect.objectContaining({ component: 'email-provider' }),
      );
      // createTransport should NOT be called when host is empty
      expect(mockCreateTransport).not.toHaveBeenCalled();

      process.env.SES_SMTP_HOST = originalHost;
    });

    it('logs warning and returns without configuring when SES_SMTP_HOST is undefined', () => {
      const originalHost = process.env.SES_SMTP_HOST;
      delete process.env.SES_SMTP_HOST;

      initialiseEmailProvider();

      expect(logger.warn).toHaveBeenCalledWith(
        'SES SMTP credentials not set — email sending disabled',
        expect.objectContaining({ component: 'email-provider' }),
      );
      expect(mockCreateTransport).not.toHaveBeenCalled();

      process.env.SES_SMTP_HOST = originalHost;
    });
  });

  // =========================================================================
  // renderEmailTemplate — str() and num() helper branches
  // =========================================================================

  describe('renderEmailTemplate — helper fallbacks', () => {
    it('str() uses fallback when value is not a string (number passed for token_url)', () => {
      // data.token_url is a number — str() should return '' (fallback)
      const result = renderEmailTemplate('password_reset', {
        token_url: 12345, // not a string
        expiry_minutes: 30,
        user_name: 'Alice',
      });
      // token_url defaults to '' so the link href should be empty
      expect(result.html).toContain('href=""');
    });

    it('num() uses fallback when value is not a number (string passed for expiry_minutes)', () => {
      // data.expiry_minutes is a string — num() should return 60 (fallback)
      const result = renderEmailTemplate('password_reset', {
        token_url: 'https://reset.example.com',
        expiry_minutes: 'not-a-number', // not a number
        user_name: 'Bob',
      });
      // Falls back to 60
      expect(result.text).toContain('60 minutes');
    });

    it('num() uses fallback for collection_escalation when days_overdue is not a number', () => {
      const result = renderEmailTemplate('collection_escalation', {
        escalation_level: '2',
        amount_overdue: '5,000,000',
        days_overdue: 'many', // not a number
        next_action: 'Legal',
      });
      // Fallback is 0
      expect(result.text).toContain('Days Overdue: 0');
    });

    it('str() uses explicit fallback for amount when value is not a string', () => {
      const result = renderEmailTemplate('invoice_created', {
        invoice_number: 'INV-001',
        amount: 9999999, // number, not string
        buyer_name: 'Corp Ltd',
        due_date: '2025-12-01',
      });
      // Falls back to '0'
      expect(result.subject).toContain('UGX 0');
    });
  });

  // =========================================================================
  // renderEmailTemplate — all templates
  // =========================================================================

  describe('renderEmailTemplate', () => {
    it('renders password_reset template', () => {
      const result = renderEmailTemplate('password_reset', {
        token_url: 'https://app.mms.ug/reset?token=abc',
        expiry_minutes: 60,
        user_name: 'Test User',
      });
      expect(result.subject).toContain('Password Reset');
      expect(result.html).toContain('https://app.mms.ug/reset?token=abc');
      expect(result.text).toContain('Test User');
    });

    it('renders invoice_created template', () => {
      const result = renderEmailTemplate('invoice_created', {
        invoice_number: 'INV-001',
        amount: '5,000,000',
        buyer_name: 'Buyer Co',
        due_date: '2024-06-15',
      });
      expect(result.subject).toContain('INV-001');
    });

    it('renders payment_received template', () => {
      const result = renderEmailTemplate('payment_received', {
        amount: '1,000,000',
        reference: 'REF-001',
        remaining_balance: '500,000',
      });
      expect(result.subject).toContain('UGX 1,000,000');
    });

    it('renders collection_escalation template', () => {
      const result = renderEmailTemplate('collection_escalation', {
        escalation_level: '3',
        amount_overdue: '5,000,000',
        days_overdue: 30,
        next_action: 'Legal',
      });
      expect(result.subject).toContain('URGENT');
    });

    it('renders welcome template', () => {
      const result = renderEmailTemplate('welcome', {
        user_name: 'New User',
        login_url: 'https://app.mms.ug',
      });
      expect(result.subject).toContain('Welcome');
    });

    it('renders document_comment_added template', () => {
      const result = renderEmailTemplate('document_comment_added', {
        document_type: 'Invoice',
        comment_snippet: 'Needs revision',
        login_url: 'https://app.mms.ug',
      });
      expect(result.subject).toBeDefined();
      expect(result.html).toContain('Needs revision');
    });

    it('renders new_document_uploaded template', () => {
      const result = renderEmailTemplate('new_document_uploaded', {
        document_type: 'Tax Certificate',
        login_url: 'https://app.mms.ug',
      });
      expect(result.subject).toBeDefined();
      expect(result.html).toContain('Tax Certificate');
    });

    it('renders financing_timeline_due template', () => {
      const result = renderEmailTemplate('financing_timeline_due', {
        invoice_number: 'INV-100',
        amount: '3,000,000',
        due_date: '2026-06-01',
        login_url: 'https://app.mms.ug',
      });
      expect(result.subject).toBeDefined();
      expect(result.html).toContain('INV-100');
    });

    it('renders kyc_approved template', () => {
      const result = renderEmailTemplate('kyc_approved', {
        user_name: 'Alice',
        login_url: 'https://app.mms.ug',
      });
      expect(result.subject).toBeDefined();
      expect(result.html).toContain('Alice');
    });

    it('renders kyc_rejected template', () => {
      const result = renderEmailTemplate('kyc_rejected', {
        user_name: 'Bob',
        rejection_reason: 'Incomplete documents',
        login_url: 'https://app.mms.ug',
      });
      expect(result.subject).toBeDefined();
      expect(result.html).toContain('Incomplete documents');
    });

    it('renders settlement_complete template', () => {
      const result = renderEmailTemplate('settlement_complete', {
        invoice_number: 'INV-200',
        net_profit: '500,000',
        settlement_id: 'SETT-001',
        login_url: 'https://app.mms.ug',
      });
      expect(result.subject).toBeDefined();
      expect(result.html).toContain('SETT-001');
    });

    it('throws for an unknown template (exhaustive default branch)', () => {
      // Cast to bypass TypeScript's exhaustiveness check and exercise the default branch
      const unknown = 'completely_unknown_template' as EmailTemplate;
      expect(() => renderEmailTemplate(unknown, {})).toThrow(
        'Unknown email template: completely_unknown_template',
      );
    });
  });

  // =========================================================================
  // sendEmail
  // =========================================================================

  describe('sendEmail', () => {
    beforeEach(() => {
      // Ensure provider is configured for most tests
      initialiseEmailProvider();
    });

    it('sends email via SES SMTP and returns success', async () => {
      mockSendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: ['user@test.com'],
        rejected: [],
      });

      const result = await sendEmail('user@test.com', 'welcome', {
        user_name: 'Test',
        login_url: 'https://app.mms.ug',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('ses');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it('includes messageId from SMTP response in result (stripped of angle brackets)', async () => {
      mockSendMail.mockResolvedValue({
        messageId: '<msg-xyz-999@example.com>',
        accepted: ['user@test.com'],
        rejected: [],
      });

      const result = await sendEmail('user@test.com', 'welcome', {
        user_name: 'Test',
        login_url: 'https://app.mms.ug',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-xyz-999@example.com');
    });

    it('returns success with undefined messageId when SMTP response has no messageId', async () => {
      mockSendMail.mockResolvedValue({
        accepted: ['user@test.com'],
        rejected: [],
      });

      const result = await sendEmail('user@test.com', 'welcome', {
        user_name: 'Test',
        login_url: 'https://app.mms.ug',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();
    });

    it('returns success with undefined messageId when messageId is not a string', async () => {
      mockSendMail.mockResolvedValue({
        messageId: 12345 as unknown as string,
        accepted: ['user@test.com'],
        rejected: [],
      });

      const result = await sendEmail('user@test.com', 'welcome', {
        user_name: 'Test',
        login_url: 'https://app.mms.ug',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();
    });

    it('returns failure when transporter.sendMail throws an Error instance', async () => {
      mockSendMail.mockRejectedValue(new Error('SMTP quota exceeded'));

      const result = await sendEmail('user@test.com', 'welcome', {
        user_name: 'Test',
        login_url: 'https://app.mms.ug',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('SMTP quota exceeded');
      expect(result.provider).toBe('ses');
    });

    it('returns failure with "Unknown send error" when sendMail throws a non-Error value', async () => {
      // Covers the `err instanceof Error ? ... : 'Unknown send error'` false branch
      mockSendMail.mockRejectedValue('string-error-not-an-Error-instance');

      const result = await sendEmail('user@test.com', 'welcome', {
        user_name: 'Test',
        login_url: 'https://app.mms.ug',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown send error');
    });

    it('returns failure when SMTP rejects the recipient', async () => {
      mockSendMail.mockResolvedValue({
        messageId: '<rejected@example.com>',
        accepted: [],
        rejected: ['user@test.com'],
      });

      const result = await sendEmail('user@test.com', 'welcome', {
        user_name: 'Test',
        login_url: 'https://app.mms.ug',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('recipient rejected');
      expect(result.error).toContain('user@test.com');
    });

    it('returns failure immediately when provider is not configured', async () => {
      // Covers the `if (!configured)` branch.
      // `configured` starts as `false` in a fresh module. Use isolateModules to get
      // a fresh copy where initialiseEmailProvider has never been called.
      await jest.isolateModulesAsync(async () => {
        // Do NOT set SES_SMTP_HOST so initialisation is never called
        // (the module default is configured=false)
        delete process.env.SES_SMTP_HOST;

        const freshModule =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../src/services/notifications/email.provider') as typeof import('../../../src/services/notifications/email.provider');

        const result = await freshModule.sendEmail('user@test.com', 'welcome', {
          user_name: 'Test',
          login_url: 'https://app.mms.ug',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Email provider not configured');
        expect(result.provider).toBe('ses');

        process.env.SES_SMTP_HOST = 'email-smtp.eu-central-1.amazonaws.com';
      });
    });

    it('uses template-mapped From (KYC) for welcome template by default', async () => {
      mockSendMail.mockResolvedValue({ messageId: '<a@b>', accepted: ['x'], rejected: [] });

      const result = await sendEmail('user@test.com', 'welcome', {
        user_name: 'Test',
        login_url: 'https://app.mms.ug',
      });

      expect(result.success).toBe(true);
      // welcome routes through FROM_KYC; address is wrapped as "RIS Platform <addr>"
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'RIS Platform <kyc@ris.ug>' }),
      );
    });

    it('uses template-mapped From (PAYMENTS) for invoice_created template', async () => {
      mockSendMail.mockResolvedValue({ messageId: '<a@b>', accepted: ['x'], rejected: [] });

      const result = await sendEmail('user@test.com', 'invoice_created', {
        invoice_number: 'INV-1',
        amount: '1,000',
        buyer_name: 'Buyer',
        due_date: '2025-01-01',
      });

      expect(result.success).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'RIS Platform <payments@ris.ug>' }),
      );
    });

    it('honours opts.from override when supplied', async () => {
      mockSendMail.mockResolvedValue({ messageId: '<a@b>', accepted: ['x'], rejected: [] });

      const result = await sendEmail(
        'user@test.com',
        'welcome',
        { user_name: 'Test', login_url: 'https://app.mms.ug' },
        { from: 'custom@ris.ug' },
      );

      expect(result.success).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'RIS Platform <custom@ris.ug>' }),
      );
    });

    it('forwards opts.replyTo to the SMTP transport', async () => {
      mockSendMail.mockResolvedValue({ messageId: '<a@b>', accepted: ['x'], rejected: [] });

      await sendEmail(
        'user@test.com',
        'welcome',
        { user_name: 'Test', login_url: 'https://app.mms.ug' },
        { replyTo: 'compliance@ris.ug' },
      );

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ replyTo: 'compliance@ris.ug' }),
      );
    });

    it('passes correct subject, html and text fields to nodemailer', async () => {
      // Ensures the rendered email fields are forwarded to transporter.sendMail()
      mockSendMail.mockResolvedValue({ messageId: '<a@b>', accepted: ['x'], rejected: [] });

      await sendEmail('user@test.com', 'invoice_created', {
        invoice_number: 'INV-999',
        amount: '2,500,000',
        buyer_name: 'Test Buyer',
        due_date: '2025-01-31',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@test.com',
          subject: expect.stringContaining('INV-999') as unknown,
          html: expect.stringContaining('INV-999') as unknown,
          text: expect.stringContaining('INV-999') as unknown,
        }),
      );
    });
  });

  // =========================================================================
  // renderEmailTemplate — all templates produce valid html+text
  // =========================================================================

  describe('renderEmailTemplate — output completeness', () => {
    it('password_reset: text includes brand name footer', () => {
      const result = renderEmailTemplate('password_reset', {
        token_url: 'https://reset.example.com',
        expiry_minutes: 15,
        user_name: 'Carol',
      });
      expect(result.text).toContain('RIS Platform');
    });

    it('invoice_created: text includes RIS Platform footer', () => {
      const result = renderEmailTemplate('invoice_created', {
        invoice_number: 'INV-002',
        amount: '1,000,000',
        buyer_name: 'Buyer Corp',
        due_date: '2025-06-01',
      });
      expect(result.text).toContain('RIS Platform');
    });

    it('payment_received: text includes thank you message in html', () => {
      const result = renderEmailTemplate('payment_received', {
        amount: '500,000',
        reference: 'PAY-500',
        remaining_balance: '0',
      });
      expect(result.html).toContain('Thank you for your payment');
    });

    it('collection_escalation: html includes urgency styling', () => {
      const result = renderEmailTemplate('collection_escalation', {
        escalation_level: '1',
        amount_overdue: '3,000,000',
        days_overdue: 10,
        next_action: 'Call buyer',
      });
      expect(result.html).toContain('c0392b');
    });

    it('welcome: html includes login button', () => {
      const result = renderEmailTemplate('welcome', {
        user_name: 'Alice',
        login_url: 'https://app.mms.ug/login',
      });
      expect(result.html).toContain('Log In');
      expect(result.html).toContain('https://app.mms.ug/login');
    });

    it('str() returns value directly when value is a string (truthy str branch)', () => {
      // Exercises the `typeof v === 'string' ? v : fallback` TRUE branch
      // for user_name (str helper returns the actual string, not fallback)
      const result = renderEmailTemplate('password_reset', {
        token_url: 'https://reset.example.com',
        expiry_minutes: 30,
        user_name: 'DirectValue',
      });
      expect(result.text).toContain('DirectValue');
    });

    it('num() returns value directly when value is a number (truthy num branch)', () => {
      // Exercises the `typeof v === 'number' ? v : fallback` TRUE branch
      // for expiry_minutes (num helper returns the actual number, not fallback)
      const result = renderEmailTemplate('password_reset', {
        token_url: 'https://reset.example.com',
        expiry_minutes: 45,
        user_name: 'User',
      });
      expect(result.text).toContain('45 minutes');
      expect(result.html).toContain('45 minutes');
    });

    it('num() returns value directly for days_overdue when it is a number', () => {
      // Exercises num() TRUE branch for collection_escalation days_overdue
      const result = renderEmailTemplate('collection_escalation', {
        escalation_level: '3',
        amount_overdue: '7,000,000',
        days_overdue: 21,
        next_action: 'Escalate to legal',
      });
      expect(result.text).toContain('Days Overdue: 21');
      expect(result.html).toContain('21');
    });
  });
});
