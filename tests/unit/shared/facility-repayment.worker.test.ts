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

jest.mock('../../../src/services/facilities/facilities.repository', () => ({
  getDrawdownByInvoiceId: jest.fn(),
}));

jest.mock('../../../src/services/facilities/facilities.service', () => ({
  processRepayment: jest.fn(),
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
import { createFacilityRepaymentWorker } from '../../../src/shared/workers/facility-repayment.worker';
import * as facilitiesRepo from '../../../src/services/facilities/facilities.repository';
import * as facilitiesService from '../../../src/services/facilities/facilities.service';
import { logger } from '../../../src/shared/logger';

const MockWorker = Worker as jest.MockedClass<typeof Worker>;
const mockedLogger = logger as jest.Mocked<typeof logger>;
const mockedRepo = facilitiesRepo as jest.Mocked<typeof facilitiesRepo>;
const mockedService = facilitiesService as jest.Mocked<typeof facilitiesService>;

function getMockOn(): jest.Mock {
  return (MockWorker as unknown as Record<string, unknown>).__mockOn as jest.Mock;
}

beforeEach(() => {
  jest.clearAllMocks();
  const mockOn = jest.fn();
  (MockWorker as unknown as Record<string, unknown>).__mockOn = mockOn;
  MockWorker.mockImplementation(() => ({ on: mockOn }) as unknown as Worker);
});

// ===========================================================================
// createFacilityRepaymentWorker
// ===========================================================================
describe('createFacilityRepaymentWorker', () => {
  it('creates a BullMQ Worker with correct queue name and options', () => {
    const worker = createFacilityRepaymentWorker('redis://localhost:6379');

    expect(MockWorker).toHaveBeenCalledWith(
      'facility-repayment',
      expect.any(Function),
      expect.objectContaining({
        connection: { url: 'redis://localhost:6379' },
        concurrency: 1,
      }),
    );
    expect(worker).toBeDefined();
  });

  it('registers completed and failed event handlers', () => {
    createFacilityRepaymentWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    expect(mockOn).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('failed', expect.any(Function));
  });
});

// ===========================================================================
// Event handlers
// ===========================================================================
describe('event handlers', () => {
  it('completed handler logs job completion with correct fields', () => {
    createFacilityRepaymentWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    const completedHandler = (
      mockOn.mock.calls as [string, (job: { id: string; data: { invoiceId: string } }) => void][]
    ).find(([event]) => event === 'completed')?.[1];

    completedHandler?.({ id: 'job-100', data: { invoiceId: 'inv-abc' } });

    expect(mockedLogger.info).toHaveBeenCalledWith(
      'Facility repayment job completed',
      expect.objectContaining({
        component: 'facility-repayment',
        jobId: 'job-100',
        invoiceId: 'inv-abc',
      }),
    );
  });

  it('failed handler logs job failure with error message', () => {
    createFacilityRepaymentWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    const failedHandler = (
      mockOn.mock.calls as [
        string,
        (job: { id: string; data: { invoiceId: string } } | undefined, err: Error) => void,
      ][]
    ).find(([event]) => event === 'failed')?.[1];

    failedHandler?.({ id: 'job-200', data: { invoiceId: 'inv-def' } }, new Error('payment failed'));

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Facility repayment job failed',
      expect.objectContaining({
        component: 'facility-repayment',
        jobId: 'job-200',
        invoiceId: 'inv-def',
        errorMessage: 'payment failed',
      }),
    );
  });

  it('failed handler handles undefined job gracefully', () => {
    createFacilityRepaymentWorker('redis://localhost:6379');
    const mockOn = getMockOn();

    const failedHandler = (
      mockOn.mock.calls as [string, (job: undefined, err: Error) => void][]
    ).find(([event]) => event === 'failed')?.[1];

    failedHandler?.(undefined, new Error('crash'));

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Facility repayment job failed',
      expect.objectContaining({
        component: 'facility-repayment',
        jobId: undefined,
        invoiceId: undefined,
        errorMessage: 'crash',
      }),
    );
  });
});

// ===========================================================================
// Processor function (handleRepaymentJob)
// ===========================================================================
describe('processor', () => {
  function getProcessorFn(): (job: { data: { invoiceId: string } }) => Promise<void> {
    createFacilityRepaymentWorker('redis://localhost:6379');
    return MockWorker.mock.calls[MockWorker.mock.calls.length - 1][1] as (job: {
      data: { invoiceId: string };
    }) => Promise<void>;
  }

  it('happy path — drawdown found, calls processRepayment and logs success', async () => {
    const mockDrawdown = { id: 'dd-001', facility_id: 'fac-001' };
    mockedRepo.getDrawdownByInvoiceId.mockResolvedValue(mockDrawdown as never);
    mockedService.processRepayment.mockResolvedValue(undefined as never);

    const processor = getProcessorFn();
    await processor({ data: { invoiceId: 'inv-123' } });

    expect(mockedRepo.getDrawdownByInvoiceId).toHaveBeenCalledWith('inv-123');
    expect(mockedService.processRepayment).toHaveBeenCalledWith(
      'fac-001',
      'dd-001',
      'SYSTEM',
      'system',
      'bull-worker',
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'Facility repayment processed',
      expect.objectContaining({
        component: 'facility-repayment',
        invoiceId: 'inv-123',
        drawdownId: 'dd-001',
        facilityId: 'fac-001',
      }),
    );
  });

  it('no drawdown — logs skip, does NOT call processRepayment', async () => {
    mockedRepo.getDrawdownByInvoiceId.mockResolvedValue(null as never);

    const processor = getProcessorFn();
    await processor({ data: { invoiceId: 'inv-999' } });

    expect(mockedRepo.getDrawdownByInvoiceId).toHaveBeenCalledWith('inv-999');
    expect(mockedService.processRepayment).not.toHaveBeenCalled();
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'No active drawdown for invoice — skipping',
      expect.objectContaining({
        component: 'facility-repayment',
        invoiceId: 'inv-999',
      }),
    );
  });

  it('processRepayment throws — error propagates for worker retry', async () => {
    const mockDrawdown = { id: 'dd-002', facility_id: 'fac-002' };
    mockedRepo.getDrawdownByInvoiceId.mockResolvedValue(mockDrawdown as never);
    mockedService.processRepayment.mockRejectedValue(new Error('DB connection lost'));

    const processor = getProcessorFn();

    await expect(processor({ data: { invoiceId: 'inv-456' } })).rejects.toThrow(
      'DB connection lost',
    );

    expect(mockedService.processRepayment).toHaveBeenCalled();
  });
});
