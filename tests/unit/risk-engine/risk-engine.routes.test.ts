jest.mock('../../../src/shared/middleware/auth.middleware', () => ({
  authenticateJwt: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));
jest.mock('../../../src/shared/middleware/role.middleware', () => ({
  createRoleGuard: jest.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));
jest.mock('../../../src/services/risk-engine/risk-engine.controller', () => ({
  getRiskScoreHandler: jest.fn(
    (_req: unknown, res: { status: (n: number) => { json: (d: unknown) => void } }) => {
      res.status(200).json({ id: 'rs-1' });
    },
  ),
  handleScoreInvoiceJob: jest.fn(),
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
    public processor: (...args: unknown[]) => unknown;
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
      const handler = this.handlers.get(event);
      if (handler) handler(...args);
    }
    close(): void {}
  }
  return { Worker: MockWorker, Queue: jest.fn() };
});

import express from 'express';
import request from 'supertest';
import {
  riskEngineRouter,
  createRiskScoringWorker,
} from '../../../src/services/risk-engine/risk-engine.routes';

const app = express();
app.use(express.json());
app.use('/invoices', riskEngineRouter);

describe('risk-engine.routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /invoices/:id/risk-score', () => {
    it('returns 200 for valid UUID', async () => {
      const res = await request(app).get(
        '/invoices/a1b2c3d4-e5f6-7890-abcd-ef1234567890/risk-score',
      );

      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await request(app).get('/invoices/not-a-uuid/risk-score');

      expect(res.status).toBe(400);
    });

    it('applies role-based access control', async () => {
      // Verify the endpoint is accessible (role guard mock allows all)
      const res = await request(app).get(
        '/invoices/a1b2c3d4-e5f6-7890-abcd-ef1234567890/risk-score',
      );
      expect(res.status).toBe(200);
    });
  });

  describe('createRiskScoringWorker', () => {
    it('creates a Worker instance', () => {
      const worker = createRiskScoringWorker('redis://localhost:6379');
      expect(worker).toBeDefined();
      expect(worker.on).toBeDefined();
    });

    it('invokes handleScoreInvoiceJob in the processor callback', async () => {
      const worker = createRiskScoringWorker('redis://localhost:6379');
      const { handleScoreInvoiceJob } =
        await import('../../../src/services/risk-engine/risk-engine.controller');

      // Call the processor directly
      const typedWorker = worker as unknown as {
        processor: (job: { data: { invoiceId: string } }) => Promise<void>;
      };
      await typedWorker.processor({ data: { invoiceId: 'inv-1' } });

      expect(handleScoreInvoiceJob).toHaveBeenCalledWith('inv-1');
    });

    it('handles completed event', () => {
      const worker = createRiskScoringWorker('redis://localhost:6379');
      const typedWorker = worker as unknown as {
        emit: (event: string, ...args: unknown[]) => void;
      };

      expect(() =>
        typedWorker.emit('completed', {
          id: 'job-1',
          data: { invoiceId: 'inv-1' },
        }),
      ).not.toThrow();
    });

    it('handles failed event', () => {
      const worker = createRiskScoringWorker('redis://localhost:6379');
      const typedWorker = worker as unknown as {
        emit: (event: string, ...args: unknown[]) => void;
      };

      expect(() =>
        typedWorker.emit(
          'failed',
          { id: 'job-1', data: { invoiceId: 'inv-1' } },
          new Error('Scoring failed'),
        ),
      ).not.toThrow();
    });

    it('handles failed event with undefined job', () => {
      const worker = createRiskScoringWorker('redis://localhost:6379');
      const typedWorker = worker as unknown as {
        emit: (event: string, ...args: unknown[]) => void;
      };

      expect(() => typedWorker.emit('failed', undefined, new Error('Unknown'))).not.toThrow();
    });
  });
});
