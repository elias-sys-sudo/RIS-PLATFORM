process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.SENDGRID_API_KEY = 'SG.test-key';
process.env.SENDGRID_FROM_EMAIL = 'test@ris.ug';
process.env.AT_API_KEY = 'test-at-key';
process.env.AT_USERNAME = 'ris-sandbox';
process.env.AT_SENDER_ID = 'RIS';

// ---------------------------------------------------------------------------
// Mocks — hoisted
// ---------------------------------------------------------------------------
jest.mock('bullmq', () => {
  const mockOn = jest.fn();
  const MockWorkerImpl = jest.fn().mockImplementation(() => ({ on: mockOn }));
  (MockWorkerImpl as unknown as Record<string, unknown>).__mockOn = mockOn;
  return { Worker: MockWorkerImpl };
});

const mockProcessNotification = jest.fn();
const mockInitialise = jest.fn();
const mockHydrateLegacyJobPayload = jest.fn();

jest.mock('../../../src/services/notifications/notifications.service', () => ({
  initialiseNotificationService: mockInitialise,
  processNotification: mockProcessNotification,
  hydrateLegacyJobPayload: mockHydrateLegacyJobPayload,
}));

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  pool: { connect: jest.fn() },
  query: jest.fn(),
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
// Imports — after mocks
// ---------------------------------------------------------------------------
import { Worker } from 'bullmq';
import { createNotificationWorker } from '../../../src/shared/workers/notification.worker';
import { logger } from '../../../src/shared/logger';

const MockWorker = Worker as jest.MockedClass<typeof Worker>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

function getMockOn(): jest.Mock {
  return (MockWorker as unknown as Record<string, unknown>).__mockOn as jest.Mock;
}

beforeEach(() => {
  jest.clearAllMocks();
  const mockOn = jest.fn();
  (MockWorker as unknown as Record<string, unknown>).__mockOn = mockOn;
  MockWorker.mockImplementation(() => ({ on: mockOn }) as unknown as Worker);
  // Default: hydration is a no-op so legacy worker tests exercise the
  // normaliser path (template + recipient inferred from job.name + data).
  // Specific tests covering buyer-confirmation hydration override this.
  mockHydrateLegacyJobPayload.mockResolvedValue(null);
});

// ===========================================================================
// createNotificationWorker
// ===========================================================================
describe('createNotificationWorker', () => {
  it('creates a BullMQ Worker with correct queue name and options', () => {
    const worker = createNotificationWorker('redis://localhost:6379');

    expect(MockWorker).toHaveBeenCalledWith(
      'notifications',
      expect.any(Function),
      expect.objectContaining({
        connection: { url: 'redis://localhost:6379' },
        concurrency: 5,
      }),
    );
    expect(worker).toBeDefined();
  });

  it('calls initialiseNotificationService on creation', () => {
    createNotificationWorker('redis://localhost:6379');
    expect(mockInitialise).toHaveBeenCalled();
  });

  it('registers completed and failed event handlers', () => {
    createNotificationWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    expect(mockOn).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('failed', expect.any(Function));
  });
});

// ===========================================================================
// Event handlers
// ===========================================================================
describe('event handlers', () => {
  it('completed handler logs job completion', () => {
    createNotificationWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    const completedHandler = (
      mockOn.mock.calls as [string, (job: { id: string; name: string }) => void][]
    ).find(([event]) => event === 'completed')?.[1];

    completedHandler?.({ id: 'job-100', name: 'send-email' });

    expect(mockedLogger.info).toHaveBeenCalledWith(
      'Notification job completed',
      expect.objectContaining({
        component: 'notifications',
        jobId: 'job-100',
        jobName: 'send-email',
      }),
    );
  });

  it('failed handler logs job failure with error message', () => {
    createNotificationWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    const failedHandler = (
      mockOn.mock.calls as [
        string,
        (job: { id: string; name: string } | undefined, err: Error) => void,
      ][]
    ).find(([event]) => event === 'failed')?.[1];

    failedHandler?.({ id: 'job-200', name: 'payment-funded' }, new Error('SendGrid failed'));

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Notification job failed',
      expect.objectContaining({
        component: 'notifications',
        jobId: 'job-200',
        jobName: 'payment-funded',
        errorMessage: 'SendGrid failed',
      }),
    );
  });

  it('failed handler handles undefined job gracefully', () => {
    createNotificationWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    const failedHandler = (
      mockOn.mock.calls as [string, (job: undefined, err: Error) => void][]
    ).find(([event]) => event === 'failed')?.[1];

    failedHandler?.(undefined, new Error('crash'));

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Notification job failed',
      expect.objectContaining({
        component: 'notifications',
        jobId: undefined,
        jobName: undefined,
        errorMessage: 'crash',
      }),
    );
  });
});

// ===========================================================================
// Processor — normalisation and job handling
// ===========================================================================
describe('processor', () => {
  function getProcessorFn(): (job: {
    id: string;
    name: string;
    data: Record<string, unknown>;
    attemptsMade: number;
  }) => Promise<void> {
    createNotificationWorker('redis://localhost:6379');
    return MockWorker.mock.calls[MockWorker.mock.calls.length - 1][1] as (job: {
      id: string;
      name: string;
      data: Record<string, unknown>;
      attemptsMade: number;
    }) => Promise<void>;
  }

  it('processes a known job type without logging a warning', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    await processor({
      id: 'job-1',
      name: 'send-email',
      data: { to: 'user@example.com', subject: 'Test' },
      attemptsMade: 0,
    });

    expect(mockedLogger.warn).not.toHaveBeenCalled();
    expect(mockProcessNotification).toHaveBeenCalled();
  });

  it('logs warning for unknown job type', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    await processor({
      id: 'job-2',
      name: 'unknown-type',
      data: { to: 'user@example.com' },
      attemptsMade: 0,
    });

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'Unknown notification job type',
      expect.objectContaining({
        component: 'notifications',
        jobName: 'unknown-type',
        jobId: 'job-2',
      }),
    );
  });

  it('passes through data as-is when it has full payload (channel, template, recipient)', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const fullPayload = {
      channel: 'email',
      template: 'password_reset',
      recipient: 'user@example.com',
      id: 'notif-1',
      data: {},
      priority: 'normal',
      attempts: 0,
      max_attempts: 3,
      created_at: '2025-01-01T00:00:00Z',
    };

    const processor = getProcessorFn();
    await processor({
      id: 'job-3',
      name: 'send-email',
      data: fullPayload as unknown as Record<string, unknown>,
      attemptsMade: 0,
    });

    expect(mockProcessNotification).toHaveBeenCalledWith(fullPayload);
  });

  it('normalises legacy payload without channel/template/recipient', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    await processor({
      id: 'job-4',
      name: 'payment-funded',
      data: { to: 'supplier@example.com', amount: '500000' },
      attemptsMade: 1,
    });

    const call = (mockProcessNotification.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(call.channel).toBe('email');
    expect(call.template).toBe('payment_received');
    expect(call.recipient).toBe('supplier@example.com');
    expect(call.attempts).toBe(1);
  });

  it('infers SMS channel when phone field is present', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    await processor({
      id: 'job-5',
      name: 'overdue-notification',
      data: { phone: '+256700123456', amount: '1000000' },
      attemptsMade: 0,
    });

    const call = (mockProcessNotification.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(call.channel).toBe('sms');
  });

  it('infers SMS channel when channel is explicitly sms', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    await processor({
      id: 'job-6',
      name: 'overdue-notification',
      data: { channel: 'sms', to: '+256700123456' },
      attemptsMade: 0,
    });

    const call = (mockProcessNotification.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(call.channel).toBe('sms');
  });

  it('throws when processNotification returns failure', async () => {
    mockProcessNotification.mockResolvedValue({
      success: false,
      error: 'Provider timeout',
    });

    const processor = getProcessorFn();

    await expect(
      processor({
        id: 'job-7',
        name: 'send-email',
        data: { to: 'user@example.com' },
        attemptsMade: 0,
      }),
    ).rejects.toThrow('Provider timeout');
  });

  it('throws generic message when processNotification returns failure without error', async () => {
    mockProcessNotification.mockResolvedValue({ success: false });

    const processor = getProcessorFn();

    await expect(
      processor({
        id: 'job-8',
        name: 'send-email',
        data: { to: 'user@example.com' },
        attemptsMade: 0,
      }),
    ).rejects.toThrow('Notification send failed');
  });

  it('uses fallback template "welcome" for unmapped job name', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    await processor({
      id: 'job-9',
      name: 'send-buyer-confirmation',
      data: { to: 'buyer@example.com' },
      attemptsMade: 0,
    });

    const call = (mockProcessNotification.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(call.template).toBe('welcome');
  });

  // -------------------------------------------------------------------------
  // line 78 branch 1: job.id is undefined → uuidv4() is used
  // -------------------------------------------------------------------------
  it('generates a uuid when job.id is undefined', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    // Pass undefined as job.id to trigger the uuidv4() fallback (line 78 branch 1)
    await processor({
      id: undefined as unknown as string,
      name: 'send-email',
      data: { to: 'user@example.com' },
      attemptsMade: 0,
    });

    const call = (mockProcessNotification.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    // id should be a non-empty string (a uuid)
    expect(typeof call.id).toBe('string');
    expect((call.id as string).length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // line 84 branch 0: data.to is not a string but data.recipient IS a string
  // -------------------------------------------------------------------------
  it('uses data.recipient when data.to is absent', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    await processor({
      id: 'job-10',
      name: 'send-email',
      data: { recipient: 'alt-recipient@example.com' },
      attemptsMade: 0,
    });

    const call = (mockProcessNotification.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(call.recipient).toBe('alt-recipient@example.com');
  });

  // -------------------------------------------------------------------------
  // line 84 branch 0 (else): neither data.to nor data.recipient is a string
  // -------------------------------------------------------------------------
  it('uses empty string as recipient when neither to nor recipient field is present', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    await processor({
      id: 'job-11',
      name: 'send-email',
      data: { subject: 'No recipient here' },
      attemptsMade: 0,
    });

    const call = (mockProcessNotification.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(call.recipient).toBe('');
  });

  // -------------------------------------------------------------------------
  // line 98 branch 3: data.phoneNumber (not data.phone) triggers sms
  // -------------------------------------------------------------------------
  it('infers SMS channel when phoneNumber field is present', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    await processor({
      id: 'job-12',
      name: 'overdue-notification',
      data: { phoneNumber: '+256780000000', amount: '500000' },
      attemptsMade: 0,
    });

    const call = (mockProcessNotification.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(call.channel).toBe('sms');
  });

  // -------------------------------------------------------------------------
  // line 106 branches 0+1: inferTemplate with data.template already set
  // -------------------------------------------------------------------------
  it('uses data.template directly when it is set (line 106 branch 0)', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    await processor({
      id: 'job-13',
      name: 'send-buyer-confirmation', // would normally map to 'welcome'
      data: { to: 'user@example.com', template: 'invoice_approved' },
      attemptsMade: 0,
    });

    const call = (mockProcessNotification.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    // data.template is present and not null → use it directly
    expect(call.template).toBe('invoice_approved');
  });

  // -------------------------------------------------------------------------
  // Mapped job names for inferTemplate coverage
  // -------------------------------------------------------------------------
  it('maps "escalation-notification" to "escalation_notice"', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    await processor({
      id: 'job-14',
      name: 'escalation-notification',
      data: { to: 'user@example.com' },
      attemptsMade: 0,
    });

    const call = (mockProcessNotification.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(call.template).toBe('escalation_notice');
  });

  it('maps "overdue-notification" to "payment_reminder"', async () => {
    mockProcessNotification.mockResolvedValue({ success: true });

    const processor = getProcessorFn();
    await processor({
      id: 'job-15',
      name: 'overdue-notification',
      data: { to: 'user@example.com' },
      attemptsMade: 0,
    });

    const call = (mockProcessNotification.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(call.template).toBe('payment_reminder');
  });
});
