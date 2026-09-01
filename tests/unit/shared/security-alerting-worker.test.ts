// ---------------------------------------------------------------------------
// Mocks — hoisted
// ---------------------------------------------------------------------------
jest.mock('bullmq', () => {
  const mockOn = jest.fn();
  const MockWorkerImpl = jest.fn().mockImplementation(() => ({ on: mockOn }));
  (MockWorkerImpl as unknown as Record<string, unknown>).__mockOn = mockOn;
  return { Worker: MockWorkerImpl, Queue: jest.fn() };
});

const mockQuery = jest.fn();

jest.mock('../../../src/shared/database/pool', () => ({
  query: mockQuery,
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
import {
  createSecurityAlertingWorker,
  setAlertNotificationQueue,
} from '../../../src/shared/workers/security-alerting.worker';
import { logger } from '../../../src/shared/logger';

const MockWorker = Worker as jest.MockedClass<typeof Worker>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

function getMockOn(): jest.Mock {
  return (MockWorker as unknown as Record<string, unknown>).__mockOn as jest.Mock;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'AML_FLAG',
    entityId: 'entity-001',
    entityType: 'invoices',
    metadata: { threshold: 100000000 },
    timestamp: '2026-04-01T10:00:00.000Z',
    ...overrides,
  };
}

async function invokeProcessor(payload: Record<string, unknown>): Promise<void> {
  const workerConstructorCall = MockWorker.mock.calls[0];
  const processorFn = workerConstructorCall[1] as (job: { data: unknown }) => Promise<void>;
  await processorFn({ data: payload });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  const mockOn = jest.fn();
  (MockWorker as unknown as Record<string, unknown>).__mockOn = mockOn;
  MockWorker.mockImplementation(() => ({ on: mockOn }) as unknown as Worker);
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('SecurityAlertingWorker', () => {
  describe('createSecurityAlertingWorker', () => {
    it('creates a Worker on the security-alerts queue', () => {
      createSecurityAlertingWorker('redis://localhost:6379');
      expect(MockWorker).toHaveBeenCalledWith(
        'security-alerts',
        expect.any(Function),
        expect.objectContaining({ concurrency: 5 }),
      );
    });

    it('registers completed and failed event handlers', () => {
      createSecurityAlertingWorker('redis://localhost:6379');
      const mockOn = getMockOn();
      const events = mockOn.mock.calls.map((c: unknown[]) => c[0]);
      expect(events).toContain('completed');
      expect(events).toContain('failed');
    });

    it('logs on completed event', () => {
      createSecurityAlertingWorker('redis://localhost:6379');
      const mockOn = getMockOn();
      const completedCall = mockOn.mock.calls.find((c: unknown[]) => c[0] === 'completed') as [
        string,
        (job: { id: string; data: { type: string } }) => void,
      ];
      const completedHandler = completedCall[1];

      completedHandler({ id: 'job-1', data: { type: 'AML_FLAG' } });

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Security alert processed',
        expect.objectContaining({ jobId: 'job-1', type: 'AML_FLAG' }),
      );
    });

    it('logs on failed event', () => {
      createSecurityAlertingWorker('redis://localhost:6379');
      const mockOn = getMockOn();
      const failedCall = mockOn.mock.calls.find((c: unknown[]) => c[0] === 'failed') as [
        string,
        (job: { id: string } | undefined, err: Error) => void,
      ];
      const failedHandler = failedCall[1];

      failedHandler({ id: 'job-2' }, new Error('Redis down'));

      expect(mockedLogger.error).toHaveBeenCalledWith(
        'Security alert processing failed',
        expect.objectContaining({ jobId: 'job-2', errorMessage: 'Redis down' }),
      );
    });
  });

  describe('processSecurityAlert', () => {
    it('writes audit log to audit_logs table', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      createSecurityAlertingWorker('redis://localhost:6379');

      await invokeProcessor(buildPayload());

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining(['SECURITY_ALERT_DISPATCHED']),
      );
    });

    it('queries compliance officers from users table', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // audit insert
        .mockResolvedValueOnce({ rows: [{ id: 'co-1' }], rowCount: 1 }) // compliance officers
        .mockResolvedValueOnce({ rows: [{ id: 'mgmt-1' }], rowCount: 1 }); // management

      createSecurityAlertingWorker('redis://localhost:6379');
      await invokeProcessor(buildPayload({ type: 'AML_FLAG' }));

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM users WHERE role = $1'),
        ['compliance_officer', true],
      );
    });

    it('also queries management for AML_FLAG alerts', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      createSecurityAlertingWorker('redis://localhost:6379');
      await invokeProcessor(buildPayload({ type: 'AML_FLAG' }));

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM users WHERE role = $1'),
        ['management', true],
      );
    });

    it('also queries management for SAR_FLAGGED alerts', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      createSecurityAlertingWorker('redis://localhost:6379');
      await invokeProcessor(buildPayload({ type: 'SAR_FLAGGED' }));

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM users WHERE role = $1'),
        ['management', true],
      );
    });

    it('does NOT query management for ACCOUNT_LOCKED alerts', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      createSecurityAlertingWorker('redis://localhost:6379');
      await invokeProcessor(buildPayload({ type: 'ACCOUNT_LOCKED' }));

      const managementCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('SELECT id FROM users') &&
          Array.isArray(c[1]) &&
          c[1][0] === 'management',
      );
      expect(managementCalls).toHaveLength(0);
    });

    it('queues notifications for compliance officers when queue is set', async () => {
      const mockAdd = jest.fn().mockResolvedValue(undefined);
      const mockQueue = { add: mockAdd } as unknown as import('bullmq').Queue;
      setAlertNotificationQueue(mockQueue);

      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ id: 'co-1' }, { id: 'co-2' }], rowCount: 2 });

      createSecurityAlertingWorker('redis://localhost:6379');
      await invokeProcessor(buildPayload({ type: 'ACCOUNT_LOCKED' }));

      expect(mockAdd).toHaveBeenCalledTimes(2);
      expect(mockAdd).toHaveBeenCalledWith(
        'security-alert-notification',
        expect.objectContaining({
          channel: 'email',
          template: 'security_alert',
          recipientUserId: 'co-1',
        }),
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('warns but does not throw when notification queue is not set', async () => {
      setAlertNotificationQueue(null as unknown as import('bullmq').Queue);

      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ id: 'co-1' }], rowCount: 1 });

      createSecurityAlertingWorker('redis://localhost:6379');

      // Should not throw
      await invokeProcessor(buildPayload({ type: 'IP_ANOMALY' }));

      expect(mockedLogger.warn).toHaveBeenCalledWith(
        'Notification queue not configured for security alerts',
        expect.objectContaining({ component: 'security-alerting' }),
      );
    });

    it('logs IP address for FAILED_AUTH_BURST alerts', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      createSecurityAlertingWorker('redis://localhost:6379');
      await invokeProcessor(
        buildPayload({
          type: 'FAILED_AUTH_BURST',
          entityId: '192.168.1.1',
          entityType: 'ip_address',
        }),
      );

      expect(mockedLogger.audit).toHaveBeenCalledWith(
        'SECURITY_ALERT_DISPATCHED',
        expect.objectContaining({ ipAddress: '192.168.1.1' }),
      );
    });

    it('logs entityId for non-IP alert types', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      createSecurityAlertingWorker('redis://localhost:6379');
      await invokeProcessor(buildPayload({ type: 'AML_FLAG', entityId: 'inv-123' }));

      expect(mockedLogger.audit).toHaveBeenCalledWith(
        'SECURITY_ALERT_DISPATCHED',
        expect.objectContaining({ entityId: 'inv-123' }),
      );
    });
  });
});
