process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

// ---------------------------------------------------------------------------
// Mocks — all jest.mock calls are hoisted, so they must be at the top
// ---------------------------------------------------------------------------
jest.mock('bullmq', () => {
  const mockOn = jest.fn();
  const MockWorkerImpl = jest.fn().mockImplementation(() => ({ on: mockOn }));
  (MockWorkerImpl as unknown as Record<string, unknown>).__mockOn = mockOn;
  return { Worker: MockWorkerImpl };
});

jest.mock('../../../src/services/facilities/facilities.service', () => ({
  getActiveFacilities: jest.fn(),
  getDashboard: jest.fn(),
  createDrawdown: jest.fn(),
  processRepayment: jest.fn(),
  setNotificationQueue: jest.fn(),
  accrueInterest: jest.fn(),
  checkUtilisationAlerts: jest.fn(),
  checkMaturityAlerts: jest.fn(),
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
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../../src/shared/middleware/auth.middleware', () => ({
  authenticateJwt: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------
import { Worker } from 'bullmq';
import {
  createInterestAccrualWorker,
  createUtilisationCheckWorker,
} from '../../../src/services/facilities/facilities.routes';
import * as service from '../../../src/services/facilities/facilities.service';
import { logger } from '../../../src/shared/logger';

const MockWorker = Worker as jest.MockedClass<typeof Worker>;
const mockedLogger = logger as jest.Mocked<typeof logger>;
const mockedService = service as jest.Mocked<typeof service>;

function getMockOn(): jest.Mock {
  return (MockWorker as unknown as Record<string, unknown>).__mockOn as jest.Mock;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Re-attach mockOn to each new Worker instance
  const mockOn = jest.fn();
  (MockWorker as unknown as Record<string, unknown>).__mockOn = mockOn;
  MockWorker.mockImplementation(() => ({ on: mockOn }) as unknown as Worker);
});

// ===========================================================================
// createInterestAccrualWorker
// ===========================================================================
describe('createInterestAccrualWorker', () => {
  it('creates a BullMQ Worker for facility-interest-accrual queue', () => {
    const worker = createInterestAccrualWorker('redis://localhost:6379');

    expect(MockWorker).toHaveBeenCalledWith(
      'facility-interest-accrual',
      expect.any(Function),
      expect.objectContaining({
        connection: { url: 'redis://localhost:6379' },
        concurrency: 1,
      }),
    );
    expect(worker).toBeDefined();
  });

  it('registers completed and failed event handlers', () => {
    createInterestAccrualWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    expect(mockOn).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('completed handler logs job completion', () => {
    createInterestAccrualWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    const completedHandler = (mockOn.mock.calls as [string, (job: { id: string }) => void][]).find(
      ([event]) => event === 'completed',
    )?.[1];

    completedHandler?.({ id: 'job-123' });

    expect(mockedLogger.info).toHaveBeenCalledWith(
      'Interest accrual job completed',
      expect.objectContaining({ jobId: 'job-123' }),
    );
  });

  it('failed handler logs job failure', () => {
    createInterestAccrualWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    const failedHandler = (
      mockOn.mock.calls as [string, (job: { id: string } | undefined, err: Error) => void][]
    ).find(([event]) => event === 'failed')?.[1];

    failedHandler?.({ id: 'job-456' }, new Error('job failed'));

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Interest accrual job failed',
      expect.objectContaining({ jobId: 'job-456', errorMessage: 'job failed' }),
    );
  });

  it('failed handler handles undefined job gracefully', () => {
    createInterestAccrualWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    const failedHandler = (
      mockOn.mock.calls as [string, (job: undefined, err: Error) => void][]
    ).find(([event]) => event === 'failed')?.[1];

    failedHandler?.(undefined, new Error('crash'));

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Interest accrual job failed',
      expect.objectContaining({ jobId: undefined, errorMessage: 'crash' }),
    );
  });

  it('worker processor calls accrueInterest', async () => {
    mockedService.accrueInterest.mockResolvedValue(undefined);
    createInterestAccrualWorker('redis://localhost:6379');

    const processorFn = MockWorker.mock.calls[
      MockWorker.mock.calls.length - 1
    ][1] as () => Promise<void>;
    await processorFn();

    expect(mockedService.accrueInterest).toHaveBeenCalled();
  });
});

// ===========================================================================
// createUtilisationCheckWorker
// ===========================================================================
describe('createUtilisationCheckWorker', () => {
  it('creates a BullMQ Worker for facility-utilisation-check queue', () => {
    const worker = createUtilisationCheckWorker('redis://localhost:6379');

    expect(MockWorker).toHaveBeenCalledWith(
      'facility-utilisation-check',
      expect.any(Function),
      expect.objectContaining({
        connection: { url: 'redis://localhost:6379' },
        concurrency: 1,
      }),
    );
    expect(worker).toBeDefined();
  });

  it('registers completed and failed event handlers', () => {
    createUtilisationCheckWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    expect(mockOn).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('completed handler logs job completion', () => {
    createUtilisationCheckWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    const completedHandler = (mockOn.mock.calls as [string, (job: { id: string }) => void][]).find(
      ([event]) => event === 'completed',
    )?.[1];

    completedHandler?.({ id: 'job-789' });

    expect(mockedLogger.info).toHaveBeenCalledWith(
      'Utilisation check job completed',
      expect.objectContaining({ jobId: 'job-789' }),
    );
  });

  it('failed handler logs job failure', () => {
    createUtilisationCheckWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    const failedHandler = (
      mockOn.mock.calls as [string, (job: { id: string } | undefined, err: Error) => void][]
    ).find(([event]) => event === 'failed')?.[1];

    failedHandler?.({ id: 'job-789' }, new Error('util check failed'));

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Utilisation check job failed',
      expect.objectContaining({ jobId: 'job-789', errorMessage: 'util check failed' }),
    );
  });

  it('failed handler handles undefined job gracefully', () => {
    createUtilisationCheckWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    const failedHandler = (
      mockOn.mock.calls as [string, (job: undefined, err: Error) => void][]
    ).find(([event]) => event === 'failed')?.[1];

    failedHandler?.(undefined, new Error('crash'));

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Utilisation check job failed',
      expect.objectContaining({ jobId: undefined }),
    );
  });

  it('worker processor calls checkUtilisationAlerts and checkMaturityAlerts', async () => {
    mockedService.checkUtilisationAlerts.mockResolvedValue(undefined);
    mockedService.checkMaturityAlerts.mockResolvedValue(undefined);
    createUtilisationCheckWorker('redis://localhost:6379');

    const processorFn = MockWorker.mock.calls[
      MockWorker.mock.calls.length - 1
    ][1] as () => Promise<void>;
    await processorFn();

    expect(mockedService.checkUtilisationAlerts).toHaveBeenCalled();
    expect(mockedService.checkMaturityAlerts).toHaveBeenCalled();
  });
});
