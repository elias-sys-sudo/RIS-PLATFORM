process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import type { Request, Response, NextFunction } from 'express';
import * as controller from '../../../src/services/collections/collections.controller';
import * as service from '../../../src/services/collections/collections.service';
import type { PenaltyCalculation } from '../../../src/services/collections/collections.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/collections/collections.service');
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedService = service as jest.Mocked<typeof service>;

function makeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    params: {},
    body: {},
    query: {},
    user: { userId: 'officer-1', role: 'credit_officer' },
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('test-agent'),
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

const next: NextFunction = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// GET /collections/overdue
// ===========================================================================

describe('getOverdueHandler', () => {
  it('returns 200 with overdue invoices', async () => {
    mockedService.getOverdueInvoices.mockResolvedValue([]);

    const req = makeReq();
    const res = makeRes();

    await controller.getOverdueHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: [] });
  });

  it('calls next on error', async () => {
    mockedService.getOverdueInvoices.mockRejectedValue(new Error('DB error'));

    const req = makeReq();
    const res = makeRes();

    await controller.getOverdueHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ===========================================================================
// POST /collections/:id/record-payment
// ===========================================================================

describe('recordPaymentHandler', () => {
  it('returns 200 on successful payment recording', async () => {
    mockedService.recordPaymentReceived.mockResolvedValue(undefined);

    const req = makeReq({
      params: { id: 'inv-1' },
      body: {
        amount: '50000000',
        paymentDate: '2026-03-15',
        paymentMethod: 'bank_transfer',
        paidBy: 'Test Buyer Corporation',
      },
    });
    const res = makeRes();

    await controller.recordPaymentHandler(req, res, next);

    expect(mockedService.recordPaymentReceived).toHaveBeenCalledWith({
      invoiceId: 'inv-1',
      amount: '50000000',
      paymentDate: '2026-03-15',
      receivedBy: 'officer-1',
      paymentMethod: 'bank_transfer',
      paidBy: 'Test Buyer Corporation',
      paymentReference: undefined,
      notes: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next on error', async () => {
    mockedService.recordPaymentReceived.mockRejectedValue(new Error('tx failed'));

    const req = makeReq({
      params: { id: 'inv-1' },
      body: {
        amount: '50000000',
        paymentDate: '2026-03-15',
        paymentMethod: 'bank_transfer',
        paidBy: 'Test Buyer Corporation',
      },
    });
    const res = makeRes();

    await controller.recordPaymentHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ===========================================================================
// GET /collections/:invoiceId/penalty
// ===========================================================================

describe('getPenaltyHandler', () => {
  it('returns 200 with penalty calculation', async () => {
    const penalty: PenaltyCalculation = {
      invoiceId: 'inv-1',
      faceValue: '50000000',
      daysOverdue: 14,
      dailyPenaltyRate: '0.001',
      penaltyAmount: '700000',
    };
    mockedService.getPenaltyByInvoiceId.mockResolvedValue(penalty);

    const req = makeReq({ params: { invoiceId: 'inv-1' } });
    const res = makeRes();

    await controller.getPenaltyHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: penalty });
  });

  it('calls next on error', async () => {
    mockedService.getPenaltyByInvoiceId.mockRejectedValue(new Error('not found'));

    const req = makeReq({ params: { invoiceId: 'inv-1' } });
    const res = makeRes();

    await controller.getPenaltyHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ===========================================================================
// handleReminderJob (BullMQ handler)
// ===========================================================================

describe('handleReminderJob', () => {
  it('calls processReminders', async () => {
    mockedService.processReminders.mockResolvedValue(undefined);

    await controller.handleReminderJob();

    expect(mockedService.processReminders).toHaveBeenCalled();
  });
});
