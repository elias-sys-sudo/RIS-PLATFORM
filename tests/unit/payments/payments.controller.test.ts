process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import type { Request, Response, NextFunction } from 'express';
import * as controller from '../../../src/services/payments/payments.controller';
import * as service from '../../../src/services/payments/payments.service';
import { PaymentStatus } from '../../../src/services/payments/payments.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/payments/payments.service');

const mockedService = service as jest.Mocked<typeof service>;

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    body: {},
    headers: {},
    user: { userId: 'user-1', role: 'finance_manager', sessionId: 'sess-1' },
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('test-agent'),
    ...overrides,
  } as unknown as Request;
}

function buildRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('payments.controller', () => {
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
  });

  // =========================================================================
  // authoriseHandler
  // =========================================================================
  describe('authoriseHandler', () => {
    it('calls firstAuth for pending_first_auth payment', async () => {
      mockedService.getPaymentDetails.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.PENDING_FIRST_AUTH,
      } as never);
      mockedService.authoriseFirstAuth.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.PENDING_SECOND_AUTH,
      } as never);

      const req = buildReq({ params: { id: 'pay-1' } });
      const res = buildRes();

      await controller.authoriseHandler(req, res, next);

      expect(mockedService.authoriseFirstAuth).toHaveBeenCalledWith(
        'pay-1',
        'user-1',
        '127.0.0.1',
        'test-agent',
        null,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('forwards errors to next()', async () => {
      const error = new Error('fail');
      mockedService.getPaymentDetails.mockRejectedValue(error);

      const req = buildReq({ params: { id: 'pay-1' } });
      const res = buildRes();

      await controller.authoriseHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // =========================================================================
  // getPendingHandler
  // =========================================================================
  describe('getPendingHandler', () => {
    it('returns pending payments', async () => {
      mockedService.getPendingPayments.mockResolvedValue([]);

      const req = buildReq();
      const res = buildRes();

      await controller.getPendingHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: [] });
    });
  });

  // =========================================================================
  // getPaymentHandler
  // =========================================================================
  describe('getPaymentHandler', () => {
    it('returns payment by id', async () => {
      const payment = {
        id: 'pay-1',
        status: PaymentStatus.FUNDED,
      };
      mockedService.getPaymentDetails.mockResolvedValue(payment as never);

      const req = buildReq({ params: { id: 'pay-1' } });
      const res = buildRes();

      await controller.getPaymentHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('forwards NotFoundError to next()', async () => {
      const error = new Error('not found');
      mockedService.getPaymentDetails.mockRejectedValue(error);

      const req = buildReq({ params: { id: 'no-exist' } });
      const res = buildRes();

      await controller.getPaymentHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // =========================================================================
  // handleProcessPaymentJob
  // =========================================================================
  describe('handleProcessPaymentJob', () => {
    it('calls initiatePayment with invoice id', async () => {
      mockedService.initiatePayment.mockResolvedValue({} as never);

      await controller.handleProcessPaymentJob('inv-1');

      expect(mockedService.initiatePayment).toHaveBeenCalledWith('inv-1');
    });
  });

  // =========================================================================
  // handleSlaCheckJob
  // =========================================================================
  describe('handleSlaCheckJob', () => {
    it('calls checkSlaBreaches', async () => {
      mockedService.checkSlaBreaches.mockResolvedValue();

      await controller.handleSlaCheckJob();

      expect(mockedService.checkSlaBreaches).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // authoriseHandler — second auth path
  // =========================================================================
  describe('authoriseHandler — second auth', () => {
    it('calls secondAuth for pending_second_auth payment', async () => {
      mockedService.getPaymentDetails.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.PENDING_SECOND_AUTH,
      } as never);
      mockedService.authoriseSecondAuth.mockResolvedValue({
        id: 'pay-1',
        status: 'executing',
      } as never);

      const req = buildReq({ params: { id: 'pay-1' } });
      const res = buildRes();

      await controller.authoriseHandler(req, res, next);

      expect(mockedService.authoriseSecondAuth).toHaveBeenCalledWith(
        'pay-1',
        'user-1',
        '127.0.0.1',
        'test-agent',
        null,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // =========================================================================
  // getPendingHandler — error path
  // =========================================================================
  describe('getPendingHandler — error', () => {
    it('forwards errors to next()', async () => {
      const error = new Error('db error');
      mockedService.getPendingPayments.mockRejectedValue(error);

      const req = buildReq();
      const res = buildRes();

      await controller.getPendingHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // =========================================================================
  // authoriseHandler — missing req.user (line 20 branch 1)
  // =========================================================================
  describe('authoriseHandler — missing req.user', () => {
    it('defaults userId to empty string when req.user is undefined (line 20 branch 1)', async () => {
      mockedService.getPaymentDetails.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.PENDING_FIRST_AUTH,
      } as never);
      mockedService.authoriseFirstAuth.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.PENDING_SECOND_AUTH,
      } as never);

      const req = buildReq({ params: { id: 'pay-1' }, user: undefined });
      const res = buildRes();

      await controller.authoriseHandler(req, res, next);

      expect(mockedService.authoriseFirstAuth).toHaveBeenCalledWith(
        'pay-1',
        '',
        '127.0.0.1',
        'test-agent',
        null,
      );
    });
  });
});
