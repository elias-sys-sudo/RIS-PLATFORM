process.env.SES_SMTP_HOST = 'email-smtp.eu-central-1.amazonaws.com';
process.env.SES_SMTP_PORT = '587';
process.env.SES_SMTP_USER = 'AKIATEST';
process.env.SES_SMTP_PASS = 'testpass';
process.env.SES_FROM_DEFAULT = 'noreply@ris.ug';
process.env.AT_API_KEY = 'test';
process.env.AT_USERNAME = 'ris-sandbox';
process.env.AT_SENDER_ID = 'RIS';

import * as service from '../../../src/services/notifications/notifications.service';
import * as repo from '../../../src/services/notifications/notifications.repository';
import * as authRepo from '../../../src/services/auth/auth.repository';
import { pool } from '../../../src/shared/database/pool';

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));
jest.mock('../../../src/services/notifications/notifications.repository');
jest.mock('../../../src/services/auth/auth.repository');
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: jest.fn() })) },
  createTransport: jest.fn(() => ({ sendMail: jest.fn() })),
}));
jest.mock('africastalking', () => jest.fn(() => ({ SMS: { send: jest.fn() } })));

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedAuthRepo = authRepo as jest.Mocked<typeof authRepo>;
const mockedPool = pool as jest.Mocked<typeof pool>;

function buildMockClient() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
}

describe('handleNotificationTerminalFailure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes EMAIL_VERIFICATION_DELIVERY_FAILED audit for verification template', async () => {
    const mockClient = buildMockClient();
    (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
    mockedAuthRepo.findUserByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      password_hash: '',
      role: 'supplier',
      is_active: true,
      email_verified: false,
      created_at: '',
      updated_at: '',
      last_2fa_verified_at: null,
    } as never);
    mockedRepo.createAuditEntryWithClient.mockResolvedValue();

    await service.handleNotificationTerminalFailure({
      jobId: 'job-1',
      jobName: 'send-email',
      template: 'email_verification',
      channel: 'email',
      recipientEmail: 'a@b.com',
      errorCode: 'SES_REJECTED',
      attemptsMade: 3,
    });

    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
      expect.anything(),
      null,
      'EMAIL_VERIFICATION_DELIVERY_FAILED',
      'notifications',
      'job-1',
      expect.any(Object),
      expect.objectContaining({
        jobName: 'send-email',
        template: 'email_verification',
        channel: 'email',
        errorCode: 'SES_REJECTED',
        retriesExhausted: true,
        recipientUserId: 'user-1',
      }),
    );
  });

  it('writes generic NOTIFICATION_DELIVERY_FAILED for non-verification templates', async () => {
    const mockClient = buildMockClient();
    (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
    mockedRepo.createAuditEntryWithClient.mockResolvedValue();

    await service.handleNotificationTerminalFailure({
      jobId: 'job-2',
      jobName: 'payment-funded',
      template: 'payment_received',
      channel: 'email',
      recipientEmail: null,
      errorCode: 'TIMEOUT',
      attemptsMade: 3,
    });

    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
      expect.anything(),
      null,
      'NOTIFICATION_DELIVERY_FAILED',
      'notifications',
      'job-2',
      expect.any(Object),
      expect.objectContaining({ template: 'payment_received', recipientUserId: null }),
    );
  });

  it('PII guard — audit payload contains no email or phone fields', async () => {
    const mockClient = buildMockClient();
    (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
    mockedAuthRepo.findUserByEmail.mockResolvedValue(null);
    mockedRepo.createAuditEntryWithClient.mockResolvedValue();

    await service.handleNotificationTerminalFailure({
      jobId: 'job-3',
      jobName: 'send-email',
      template: 'email_verification',
      channel: 'email',
      recipientEmail: 'sensitive@example.com',
      errorCode: 'X',
      attemptsMade: 3,
    });

    const auditCall = (mockedRepo.createAuditEntryWithClient as jest.Mock).mock
      .calls[0] as unknown[];
    const newValues = auditCall[6];
    const serialised = JSON.stringify(newValues);
    // Real PII patterns: literal email address, phone-shaped digit run,
    // bank-account / password / supplier-name fields. The strings
    // "send-email" (job name), "email_verification" (template), and
    // "email" (channel) are NOT PII.
    expect(serialised).not.toMatch(/sensitive@example/);
    expect(serialised).not.toMatch(/@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    expect(serialised).not.toMatch(/\+?\d{9,}/);
    expect(serialised).not.toMatch(/password|bank_account|supplier_name|buyer_name/i);
  });

  it('ROLLBACKs when audit insert rejects', async () => {
    const mockClient = buildMockClient();
    (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
    mockedAuthRepo.findUserByEmail.mockResolvedValue(null);
    mockedRepo.createAuditEntryWithClient.mockRejectedValue(new Error('DB down'));

    await expect(
      service.handleNotificationTerminalFailure({
        jobId: 'job-4',
        jobName: 'send-email',
        template: 'email_verification',
        channel: 'email',
        recipientEmail: null,
        errorCode: 'X',
        attemptsMade: 3,
      }),
    ).rejects.toThrow('DB down');

    const calls = mockClient.query.mock.calls as unknown[][];
    expect(calls.find((c) => c[0] === 'ROLLBACK')).toBeDefined();
    expect(calls.find((c) => c[0] === 'COMMIT')).toBeUndefined();
  });

  it('skips userId lookup for non-email channels', async () => {
    const mockClient = buildMockClient();
    (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
    mockedRepo.createAuditEntryWithClient.mockResolvedValue();

    await service.handleNotificationTerminalFailure({
      jobId: 'job-5',
      jobName: 'sms-job',
      template: 'overdue_reminder',
      channel: 'sms',
      recipientEmail: null,
      errorCode: 'AT_FAILED',
      attemptsMade: 3,
    });

    expect(mockedAuthRepo.findUserByEmail).not.toHaveBeenCalled();
  });
});
