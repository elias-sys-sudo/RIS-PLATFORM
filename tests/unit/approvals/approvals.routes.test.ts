process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import {
  approvalsRouter,
  createApprovalSlaWorker,
} from '../../../src/services/approvals/approvals.routes';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/approvals/approvals.controller', () => ({
  approveHandler: jest.fn(
    (_req: unknown, res: { status: (code: number) => { json: (data: unknown) => void } }) => {
      res.status(200).json({});
    },
  ),
  rejectHandler: jest.fn(
    (_req: unknown, res: { status: (code: number) => { json: (data: unknown) => void } }) => {
      res.status(200).json({});
    },
  ),
  getQueueHandler: jest.fn(
    (_req: unknown, res: { status: (code: number) => { json: (data: unknown) => void } }) => {
      res.status(200).json({});
    },
  ),
  handleSlaCheckJob: jest.fn(),
}));
jest.mock('../../../src/shared/middleware/auth.middleware', () => ({
  authenticateJwt: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));
jest.mock('../../../src/shared/middleware/role.middleware', () => ({
  createRoleGuard: jest.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));
jest.mock('../../../src/shared/middleware/validate', () => ({
  validate: jest.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));
jest.mock('../../../src/shared/middleware/async-handler', () => ({
  asyncHandler: jest.fn((fn: unknown) => fn),
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

jest.mock('bullmq', () => {
  const mockWorker = {
    on: jest.fn().mockReturnThis(),
    close: jest.fn(),
  };
  return {
    Worker: jest.fn().mockImplementation(() => mockWorker),
    Queue: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('approvals.routes', () => {
  it('exports a router', () => {
    expect(approvalsRouter).toBeDefined();
  });

  it('has POST /:id/approve route', () => {
    const routes =
      (
        approvalsRouter as {
          stack?: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
        }
      ).stack ?? [];
    const approveRoute = routes.find((r) => r.route?.path === '/:id/approve');
    expect(approveRoute).toBeDefined();
    expect(approveRoute?.route?.methods.post).toBe(true);
  });

  it('has POST /:id/reject route', () => {
    const routes =
      (
        approvalsRouter as {
          stack?: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
        }
      ).stack ?? [];
    const rejectRoute = routes.find((r) => r.route?.path === '/:id/reject');
    expect(rejectRoute).toBeDefined();
    expect(rejectRoute?.route?.methods.post).toBe(true);
  });

  it('has GET /queue route', () => {
    const routes =
      (
        approvalsRouter as {
          stack?: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
        }
      ).stack ?? [];
    const queueRoute = routes.find((r) => r.route?.path === '/queue');
    expect(queueRoute).toBeDefined();
    expect(queueRoute?.route?.methods.get).toBe(true);
  });

  it('requires credit_officer and management roles for approve', () => {
    const { createRoleGuard } = jest.requireMock(
      '../../../src/shared/middleware/role.middleware',
    ) as { createRoleGuard: jest.Mock };
    expect(createRoleGuard).toHaveBeenCalledWith(['credit_officer', 'management']);
  });

  // =========================================================================
  // BullMQ Worker factory
  // =========================================================================
  describe('createApprovalSlaWorker', () => {
    it('creates a BullMQ worker for approval-sla-check queue', () => {
      const { Worker } = jest.requireMock('bullmq') as {
        Worker: jest.Mock;
      };

      const worker = createApprovalSlaWorker('redis://localhost:6379');

      expect(Worker).toHaveBeenCalledWith(
        'approval-sla-check',
        expect.any(Function),
        expect.objectContaining({
          connection: { url: 'redis://localhost:6379' },
        }),
      );
      expect(worker.on).toHaveBeenCalledWith('completed', expect.any(Function));
      expect(worker.on).toHaveBeenCalledWith('failed', expect.any(Function));
    });

    it('executes the worker processor function which calls handleSlaCheckJob', async () => {
      const { Worker } = jest.requireMock('bullmq') as {
        Worker: jest.Mock;
      };
      const { handleSlaCheckJob } = jest.requireMock(
        '../../../src/services/approvals/approvals.controller',
      ) as { handleSlaCheckJob: jest.Mock };

      handleSlaCheckJob.mockResolvedValue(undefined);

      createApprovalSlaWorker('redis://localhost:6379');

      // Extract the processor function passed to Worker constructor
      const lastCall = Worker.mock.calls[Worker.mock.calls.length - 1] as [
        string,
        () => Promise<void>,
        unknown,
      ];
      const processorFn = lastCall[1];
      await processorFn();

      expect(handleSlaCheckJob).toHaveBeenCalled();
    });

    it('worker "completed" event handler logs job completion', () => {
      const { Worker } = jest.requireMock('bullmq') as {
        Worker: jest.Mock;
      };
      const { logger } = jest.requireMock('../../../src/shared/logger') as {
        logger: { info: jest.Mock; error: jest.Mock };
      };

      createApprovalSlaWorker('redis://localhost:6379');

      const worker = Worker.mock.results[Worker.mock.results.length - 1].value as {
        on: jest.Mock;
      };

      // Find the 'completed' event handler
      const completedCall = (worker.on.mock.calls as [string, (...args: unknown[]) => void][]).find(
        ([event]) => event === 'completed',
      );
      expect(completedCall).toBeDefined();

      const completedHandler = completedCall![1];
      completedHandler({ id: 'job-123' });

      expect(logger.info).toHaveBeenCalledWith(
        'SLA check job completed',
        expect.objectContaining({ jobId: 'job-123' }),
      );
    });

    it('worker "failed" event handler logs job failure with error message', () => {
      const { Worker } = jest.requireMock('bullmq') as {
        Worker: jest.Mock;
      };
      const { logger } = jest.requireMock('../../../src/shared/logger') as {
        logger: { info: jest.Mock; error: jest.Mock };
      };

      createApprovalSlaWorker('redis://localhost:6379');

      const worker = Worker.mock.results[Worker.mock.results.length - 1].value as {
        on: jest.Mock;
      };

      // Find the 'failed' event handler
      const failedCall = (worker.on.mock.calls as [string, (...args: unknown[]) => void][]).find(
        ([event]) => event === 'failed',
      );
      expect(failedCall).toBeDefined();

      const failedHandler = failedCall![1];
      const err = new Error('Redis connection lost');
      failedHandler({ id: 'job-456' }, err);

      expect(logger.error).toHaveBeenCalledWith(
        'SLA check job failed',
        expect.objectContaining({
          jobId: 'job-456',
          errorMessage: 'Redis connection lost',
        }),
      );
    });

    it('worker "failed" handler handles undefined job gracefully', () => {
      const { Worker } = jest.requireMock('bullmq') as {
        Worker: jest.Mock;
      };
      const { logger } = jest.requireMock('../../../src/shared/logger') as {
        logger: { info: jest.Mock; error: jest.Mock };
      };

      createApprovalSlaWorker('redis://localhost:6379');

      const worker = Worker.mock.results[Worker.mock.results.length - 1].value as {
        on: jest.Mock;
      };

      const failedCall = (worker.on.mock.calls as [string, (...args: unknown[]) => void][]).find(
        ([event]) => event === 'failed',
      );

      const failedHandler = failedCall![1];
      const err = new Error('Worker crashed');
      failedHandler(undefined, err);

      expect(logger.error).toHaveBeenCalledWith(
        'SLA check job failed',
        expect.objectContaining({
          jobId: undefined,
          errorMessage: 'Worker crashed',
        }),
      );
    });
  });
});
