process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-tests';

import request from 'supertest';
import express from 'express';
import { paymentsRouter } from '../../../src/services/payments/payments.routes';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/payments/payments.service');
jest.mock('../../../src/services/payments/payments.controller', () => ({
  authoriseHandler: jest.fn((_req: unknown, res: { json: (v: unknown) => void }) =>
    res.json({ ok: true }),
  ),
  getPendingHandler: jest.fn((_req: unknown, res: { json: (v: unknown) => void }) =>
    res.json({ ok: true }),
  ),
  getPaymentHandler: jest.fn((_req: unknown, res: { json: (v: unknown) => void }) =>
    res.json({ ok: true }),
  ),
  handleProcessPaymentJob: jest.fn().mockResolvedValue(undefined),
  handleTerminalWorkerFailureJob: jest.fn().mockResolvedValue(undefined),
  handleSlaCheckJob: jest.fn().mockResolvedValue(undefined),
  getKillSwitchHandler: jest.fn((_req: unknown, res: { json: (v: unknown) => void }) =>
    res.json({ ok: true }),
  ),
  activateKillSwitchHandler: jest.fn((_req: unknown, res: { json: (v: unknown) => void }) =>
    res.json({ ok: true }),
  ),
  deactivateKillSwitchHandler: jest.fn((_req: unknown, res: { json: (v: unknown) => void }) =>
    res.json({ ok: true }),
  ),
}));
jest.mock('../../../src/services/auth/auth.service', () => ({
  getSession: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'finance_manager' }),
}));

// Mock JWT verification to pass auth middleware
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({
    userId: 'user-1',
    role: 'finance_manager',
    sessionId: 'sess-1',
    type: 'full',
  }),
  JsonWebTokenError: class JsonWebTokenError extends Error {},
  TokenExpiredError: class TokenExpiredError extends Error {},
}));

const app = express();
app.use(express.json());
app.use('/payments', paymentsRouter);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('payments.routes', () => {
  // =========================================================================
  // POST /payments/:id/authorise
  // =========================================================================
  describe('POST /payments/:id/authorise', () => {
    it('returns 200 on valid authorisation', async () => {
      const service = await import('../../../src/services/payments/payments.service');
      (service.getPaymentDetails as jest.Mock).mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        status: 'pending_first_auth',
      });
      (service.authoriseFirstAuth as jest.Mock).mockResolvedValue({
        id: 'pay-1',
        status: 'pending_second_auth',
      });

      const res = await request(app)
        .post('/payments/11111111-1111-1111-1111-111111111111/authorise')
        .set('Authorization', 'Bearer valid-token')
        .send();

      expect(res.status).toBe(200);
    });

    it('returns 401 without auth token', async () => {
      const res = await request(app)
        .post('/payments/11111111-1111-1111-1111-111111111111/authorise')
        .send();

      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // GET /payments/pending — authenticated
  // =========================================================================
  describe('GET /payments/pending', () => {
    it('returns 200 for finance_manager', async () => {
      const service = await import('../../../src/services/payments/payments.service');
      (service.getPendingPayments as jest.Mock).mockResolvedValue([]);

      const res = await request(app)
        .get('/payments/pending')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
    });
  });

  // =========================================================================
  // GET /payments/:id — authenticated
  // =========================================================================
  describe('GET /payments/:id', () => {
    it('returns 200 for valid payment id', async () => {
      const service = await import('../../../src/services/payments/payments.service');
      (service.getPaymentDetails as jest.Mock).mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        status: 'funded',
      });

      const res = await request(app)
        .get('/payments/11111111-1111-1111-1111-111111111111')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
    });
  });
});

// ===========================================================================
// BullMQ Worker factories
// ===========================================================================
jest.mock('bullmq', () => {
  class MockWorker {
    private handlers = new Map<string, (...args: unknown[]) => unknown>();
    processor: (...args: unknown[]) => unknown;
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
  }
  return { Worker: MockWorker, Queue: jest.fn() };
});

describe('payments.routes — BullMQ workers', () => {
  it('createPaymentWorker creates a worker and handles completed event', async () => {
    const { createPaymentWorker } = await import('../../../src/services/payments/payments.routes');
    const worker = createPaymentWorker('redis://localhost:6379');
    expect(worker).toBeDefined();

    // Trigger completed event
    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('completed', {
      id: 'job-1',
      data: { invoiceId: 'inv-1' },
    });
  });

  it('createPaymentWorker handles failed event', async () => {
    const { createPaymentWorker } = await import('../../../src/services/payments/payments.routes');
    const worker = createPaymentWorker('redis://localhost:6379');

    // Trigger failed event
    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      { id: 'job-1', data: { invoiceId: 'inv-1' } },
      new Error('Redis down'),
    );
  });

  it('createPaymentWorker handles failed event with undefined job', async () => {
    const { createPaymentWorker } = await import('../../../src/services/payments/payments.routes');
    const worker = createPaymentWorker('redis://localhost:6379');

    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      undefined,
      new Error('Unknown failure'),
    );
  });

  it('createPaymentSlaWorker creates a worker and handles completed event', async () => {
    const { createPaymentSlaWorker } =
      await import('../../../src/services/payments/payments.routes');
    const worker = createPaymentSlaWorker('redis://localhost:6379');
    expect(worker).toBeDefined();

    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit('completed', {
      id: 'sla-job-1',
      data: { trigger: 'scheduled' },
    });
  });

  it('createPaymentSlaWorker handles failed event', async () => {
    const { createPaymentSlaWorker } =
      await import('../../../src/services/payments/payments.routes');
    const worker = createPaymentSlaWorker('redis://localhost:6379');

    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      { id: 'sla-job-1', data: { trigger: 'scheduled' } },
      new Error('SLA check failed'),
    );
  });

  it('createPaymentSlaWorker handles failed event with undefined job', async () => {
    const { createPaymentSlaWorker } =
      await import('../../../src/services/payments/payments.routes');
    const worker = createPaymentSlaWorker('redis://localhost:6379');

    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      undefined,
      new Error('Unknown SLA failure'),
    );
  });

  it('createPaymentWorker calls terminal handler when attemptsMade >= opts.attempts', async () => {
    const controller = await import('../../../src/services/payments/payments.controller');
    (controller.handleTerminalWorkerFailureJob as jest.Mock).mockClear();
    const { createPaymentWorker } = await import('../../../src/services/payments/payments.routes');
    const worker = createPaymentWorker('redis://localhost:6379');

    const err = new Error('Provider unreachable') as Error & { code?: string };
    err.code = 'PROVIDER_TIMEOUT';
    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      { id: 'job-1', data: { invoiceId: 'inv-terminal' }, attemptsMade: 3, opts: { attempts: 3 } },
      err,
    );
    // Settle the floating promise the listener fires.
    await new Promise((resolve) => setImmediate(resolve));

    expect(controller.handleTerminalWorkerFailureJob).toHaveBeenCalledWith(
      'inv-terminal',
      'PROVIDER_TIMEOUT',
    );
  });

  it('createPaymentWorker does NOT call terminal handler on non-terminal failures', async () => {
    const controller = await import('../../../src/services/payments/payments.controller');
    (controller.handleTerminalWorkerFailureJob as jest.Mock).mockClear();
    const { createPaymentWorker } = await import('../../../src/services/payments/payments.routes');
    const worker = createPaymentWorker('redis://localhost:6379');

    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      { id: 'job-1', data: { invoiceId: 'inv-retry' }, attemptsMade: 1, opts: { attempts: 3 } },
      new Error('Transient error'),
    );

    expect(controller.handleTerminalWorkerFailureJob).not.toHaveBeenCalled();
  });

  it('createPaymentWorker terminal handler defaults errorCode when err.code is absent', async () => {
    const controller = await import('../../../src/services/payments/payments.controller');
    (controller.handleTerminalWorkerFailureJob as jest.Mock).mockClear();
    const { createPaymentWorker } = await import('../../../src/services/payments/payments.routes');
    const worker = createPaymentWorker('redis://localhost:6379');

    (worker as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
      'failed',
      { id: 'job-2', data: { invoiceId: 'inv-no-code' }, attemptsMade: 3, opts: { attempts: 3 } },
      new Error('Generic error'),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(controller.handleTerminalWorkerFailureJob).toHaveBeenCalledWith(
      'inv-no-code',
      'WORKER_EXHAUSTED',
    );
  });

  it('createPaymentWorker processor invokes handleProcessPaymentJob (line 108)', async () => {
    const controller = await import('../../../src/services/payments/payments.controller');
    const { createPaymentWorker } = await import('../../../src/services/payments/payments.routes');
    const worker = createPaymentWorker('redis://localhost:6379');

    // Invoke the processor directly
    const mockWorker = worker as unknown as { processor: (job: unknown) => Promise<void> };
    await mockWorker.processor({ data: { invoiceId: 'inv-processor-test' } });

    expect(controller.handleProcessPaymentJob).toHaveBeenCalledWith('inv-processor-test');
  });

  it('createPaymentSlaWorker processor invokes handleSlaCheckJob (line 148)', async () => {
    const controller = await import('../../../src/services/payments/payments.controller');
    const { createPaymentSlaWorker } =
      await import('../../../src/services/payments/payments.routes');
    const worker = createPaymentSlaWorker('redis://localhost:6379');

    const mockWorker = worker as unknown as { processor: () => Promise<void> };
    await mockWorker.processor();

    expect(controller.handleSlaCheckJob).toHaveBeenCalled();
  });
});
