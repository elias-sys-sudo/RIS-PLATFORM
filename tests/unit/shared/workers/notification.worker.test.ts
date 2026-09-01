process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.SES_SMTP_HOST = 'email-smtp.eu-central-1.amazonaws.com';
process.env.SES_SMTP_PORT = '587';
process.env.SES_SMTP_USER = 'AKIATEST';
process.env.SES_SMTP_PASS = 'testpass';
process.env.AT_API_KEY = 'test';
process.env.AT_USERNAME = 'ris-sandbox';
process.env.AT_SENDER_ID = 'RIS';

import { createNotificationWorker } from '../../../../src/shared/workers/notification.worker';
import * as service from '../../../../src/services/notifications/notifications.service';

jest.mock('../../../../src/services/notifications/notifications.service');
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: jest.fn() })) },
  createTransport: jest.fn(() => ({ sendMail: jest.fn() })),
}));
jest.mock('africastalking', () => jest.fn(() => ({ SMS: { send: jest.fn() } })));

// BullMQ Worker mock — captures event handlers so tests can emit synthetic
// events. Same pattern used in tests/unit/payments/payments.routes.test.ts.
jest.mock('bullmq', () => {
  class MockWorker {
    handlers = new Map<string, (...args: unknown[]) => unknown>();
    constructor() {}
    on(event: string, handler: (...args: unknown[]) => unknown): MockWorker {
      this.handlers.set(event, handler);
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      const h = this.handlers.get(event);
      if (h) h(...args);
    }
  }
  return { Worker: MockWorker, Queue: jest.fn() };
});

const mockedService = service as jest.Mocked<typeof service>;

describe('createNotificationWorker — terminal failure path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedService.handleNotificationTerminalFailure.mockResolvedValue();
  });

  it('calls handleNotificationTerminalFailure when attemptsMade >= opts.attempts', async () => {
    const worker = createNotificationWorker('redis://localhost:6379');
    const err = new Error('SES rejected') as Error & { code?: string };
    err.code = 'SES_SANDBOX_REJECT';

    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      {
        id: 'job-1',
        name: 'send-email',
        data: { template: 'email_verification', channel: 'email', recipient: 'a@b.com' },
        attemptsMade: 3,
        opts: { attempts: 3 },
      },
      err,
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockedService.handleNotificationTerminalFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        jobName: 'send-email',
        template: 'email_verification',
        channel: 'email',
        recipientEmail: 'a@b.com',
        errorCode: 'SES_SANDBOX_REJECT',
        attemptsMade: 3,
      }),
    );
  });

  it('does NOT call handler on non-terminal failures (retry will fire)', async () => {
    const worker = createNotificationWorker('redis://localhost:6379');
    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      {
        id: 'job-2',
        name: 'send-email',
        data: { template: 'email_verification', channel: 'email' },
        attemptsMade: 1,
        opts: { attempts: 3 },
      },
      new Error('transient'),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockedService.handleNotificationTerminalFailure).not.toHaveBeenCalled();
  });

  it('defaults errorCode to NOTIFICATION_WORKER_EXHAUSTED when err.code absent', async () => {
    const worker = createNotificationWorker('redis://localhost:6379');
    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      {
        id: 'job-3',
        name: 'send-email',
        data: { template: 'email_verification', channel: 'email' },
        attemptsMade: 3,
        opts: { attempts: 3 },
      },
      new Error('no code'),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockedService.handleNotificationTerminalFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'NOTIFICATION_WORKER_EXHAUSTED' }),
    );
  });

  it('does NOT call handler when job is undefined', async () => {
    const worker = createNotificationWorker('redis://localhost:6379');
    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      undefined,
      new Error('worker process died'),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockedService.handleNotificationTerminalFailure).not.toHaveBeenCalled();
  });
});
