process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import { pricingRouter, createPricingWorker } from '../../../src/services/pricing/pricing.routes';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/pricing/pricing.controller', () => ({
  getPricingHandler: jest.fn(
    (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
      res.status(200).json({ ok: true });
    },
  ),
  acceptPricingHandler: jest.fn(
    (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
      res.status(200).json({ message: 'Pricing accepted' });
    },
  ),
  rejectPricingHandler: jest.fn(
    (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
      res.status(200).json({ message: 'Pricing rejected' });
    },
  ),
  disputePricingHandler: jest.fn(
    (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
      res.status(201).json({ id: 'dispute-1' });
    },
  ),
  handlePriceInvoiceJob: jest.fn(),
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
  class MockWorker {
    processor: (...args: unknown[]) => unknown;
    private handlers = new Map<string, (...args: unknown[]) => unknown>();
    constructor(
      _queueName: string,
      processor: (...args: unknown[]) => unknown,
      _opts: Record<string, unknown>,
    ) {
      this.processor = processor;
    }
    on(event: string, handler: (...args: unknown[]) => unknown): MockWorker {
      this.handlers.set(event, handler);
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      const h = this.handlers.get(event);
      if (h) h(...args);
    }
    close = jest.fn();
  }
  return { Worker: MockWorker, Queue: jest.fn() };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('pricing.routes', () => {
  it('exports a pricingRouter', () => {
    expect(pricingRouter).toBeDefined();
  });

  it('has a GET /:id/pricing route', () => {
    const routes =
      (
        pricingRouter as {
          stack?: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
        }
      ).stack ?? [];
    const pricingRoute = routes.find((layer) => layer.route?.path === '/:id/pricing');
    expect(pricingRoute).toBeDefined();
    expect(pricingRoute?.route?.methods.get).toBe(true);
  });

  it('requires supplier, credit_officer, finance_manager, management roles for GET', () => {
    const { createRoleGuard } = jest.requireMock(
      '../../../src/shared/middleware/role.middleware',
    ) as { createRoleGuard: jest.Mock };
    expect(createRoleGuard).toHaveBeenCalledWith([
      'supplier',
      'credit_officer',
      'finance_manager',
      'management',
    ]);
  });

  it('has a POST /:id/pricing/dispute route', () => {
    const routes =
      (
        pricingRouter as {
          stack?: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
        }
      ).stack ?? [];
    const disputeRoute = routes.find((layer) => layer.route?.path === '/:id/pricing/dispute');
    expect(disputeRoute).toBeDefined();
    expect(disputeRoute?.route?.methods.post).toBe(true);
  });

  it('restricts POST /:id/pricing/dispute to supplier role', () => {
    const { createRoleGuard } = jest.requireMock(
      '../../../src/shared/middleware/role.middleware',
    ) as { createRoleGuard: jest.Mock };
    expect(createRoleGuard).toHaveBeenCalledWith(['supplier']);
  });

  // =======================================================================
  // BullMQ Worker factory
  // =======================================================================
  describe('createPricingWorker', () => {
    it('creates a BullMQ worker for price-invoice queue', () => {
      const worker = createPricingWorker('redis://localhost:6379');
      expect(worker).toBeDefined();
    });

    it('processor invokes handlePriceInvoiceJob with invoiceId (line 51)', async () => {
      const controller = jest.requireMock('../../../src/services/pricing/pricing.controller') as {
        handlePriceInvoiceJob: jest.Mock;
      };
      controller.handlePriceInvoiceJob.mockResolvedValue(undefined);

      const worker = createPricingWorker('redis://localhost:6379');
      const mockWorker = worker as unknown as {
        processor: (job: { data: { invoiceId: string } }) => Promise<void>;
      };

      await mockWorker.processor({ data: { invoiceId: 'inv-pricing-1' } });

      expect(controller.handlePriceInvoiceJob).toHaveBeenCalledWith('inv-pricing-1');
    });

    it('completed event handler logs info (line 60)', () => {
      const { logger } = jest.requireMock('../../../src/shared/logger') as {
        logger: { info: jest.Mock };
      };

      const worker = createPricingWorker('redis://localhost:6379');
      const emitter = worker as unknown as {
        emit: (event: string, ...args: unknown[]) => void;
      };

      emitter.emit('completed', { id: 'job-pricing-1', data: { invoiceId: 'inv-pricing-1' } });

      expect(logger.info).toHaveBeenCalledWith(
        'Pricing job completed',
        expect.objectContaining({ component: 'pricing', jobId: 'job-pricing-1' }),
      );
    });

    it('failed event handler logs error with defined job (line 68)', () => {
      const { logger } = jest.requireMock('../../../src/shared/logger') as {
        logger: { error: jest.Mock };
      };

      const worker = createPricingWorker('redis://localhost:6379');
      const emitter = worker as unknown as {
        emit: (event: string, ...args: unknown[]) => void;
      };

      emitter.emit(
        'failed',
        { id: 'job-pricing-fail', data: { invoiceId: 'inv-pricing-fail' } },
        new Error('Pricing engine error'),
      );

      expect(logger.error).toHaveBeenCalledWith(
        'Pricing job failed',
        expect.objectContaining({
          component: 'pricing',
          errorMessage: 'Pricing engine error',
        }),
      );
    });

    it('failed event handler handles undefined job gracefully', () => {
      const worker = createPricingWorker('redis://localhost:6379');
      const emitter = worker as unknown as {
        emit: (event: string, ...args: unknown[]) => void;
      };

      // Should not throw when job is undefined
      expect(() =>
        emitter.emit('failed', undefined, new Error('Unknown pricing failure')),
      ).not.toThrow();
    });
  });
});
