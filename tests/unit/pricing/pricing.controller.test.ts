process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import type { Request, Response, NextFunction } from 'express';
import * as controller from '../../../src/services/pricing/pricing.controller';
import * as service from '../../../src/services/pricing/pricing.service';
import type {
  PricingResult,
  FeeBreakdown,
  DisputeResponse,
} from '../../../src/services/pricing/pricing.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/pricing/pricing.service');
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const INVOICE_ID = 'invoice-uuid-1';

function makePricingResult(): PricingResult {
  const breakdown: FeeBreakdown = {
    faceValue: '50000000',
    advancePercentage: '95.00',
    advanceAmount: '47500000',
    discountPercentage: '2.6507',
    discountAmount: '1325342',
    netPaymentToSupplier: '46174658',
    bankCostComponent: '1109589',
    riskPremiumComponent: '30821',
    risMarginComponent: '184931',
    expectedCollectionDate: '2026-05-05',
  };
  return {
    invoiceId: INVOICE_ID,
    faceValue: '50000000',
    advanceAmount: '47500000',
    discountAmount: '1325342',
    netPaymentToSupplier: '46174658',
    bankCostRate: 0.18,
    riskPremiumRate: 0.005,
    risMarginRate: 0.03,
    totalDiscountRate: 0.02650684,
    bankCostAmount: '1054109',
    risNetProfit: '271233',
    feeBreakdown: breakdown,
  };
}

function makeReq(
  params: Record<string, string> = {},
  overrides: Partial<Request> = {},
): Partial<Request> {
  return { params, ...overrides } as Partial<Request>;
}

function makeAuthReq(
  params: Record<string, string>,
  opts: {
    userId?: string;
    ip?: string;
    userAgent?: string;
    body?: Record<string, unknown>;
  } = {},
): Partial<Request> {
  return {
    params,
    user: opts.userId !== undefined ? { userId: opts.userId } : undefined,
    ip: opts.ip,
    get: jest.fn().mockReturnValue(opts.userAgent) as never,
    body: opts.body ?? {},
  } as Partial<Request>;
}

function makeRes(): Partial<Response> {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis() as never,
    json: jest.fn().mockReturnThis() as never,
  };
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('pricing.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =======================================================================
  // getPricingHandler
  // =======================================================================
  describe('getPricingHandler', () => {
    it('returns 200 with pricing result', async () => {
      const pricingResult = makePricingResult();
      mockedService.getPricing.mockResolvedValue(pricingResult);

      const req = makeReq({ id: INVOICE_ID });
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await controller.getPricingHandler(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(pricingResult);
    });

    it('delegates errors to next()', async () => {
      const error = new Error('Not found');
      mockedService.getPricing.mockRejectedValue(error);

      const req = makeReq({ id: INVOICE_ID });
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await controller.getPricingHandler(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // =======================================================================
  // acceptPricingHandler
  // =======================================================================
  describe('acceptPricingHandler', () => {
    it('returns 200 on successful accept with full auth context', async () => {
      mockedService.acceptPricing.mockResolvedValue(undefined);

      const req = makeAuthReq(
        { id: INVOICE_ID },
        { userId: 'user-1', ip: '10.0.0.1', userAgent: 'TestAgent/1.0' },
      );
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await controller.acceptPricingHandler(req as Request, res as Response, next);

      expect(mockedService.acceptPricing).toHaveBeenCalledWith(
        INVOICE_ID,
        'user-1',
        '10.0.0.1',
        'TestAgent/1.0',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Pricing accepted' });
    });

    it('falls back to empty strings when user/ip/userAgent are missing', async () => {
      mockedService.acceptPricing.mockResolvedValue(undefined);

      const req = makeAuthReq({ id: INVOICE_ID }, {});
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await controller.acceptPricingHandler(req as Request, res as Response, next);

      expect(mockedService.acceptPricing).toHaveBeenCalledWith(INVOICE_ID, '', '', '');
    });

    it('delegates errors to next()', async () => {
      const error = new Error('Pricing not found');
      mockedService.acceptPricing.mockRejectedValue(error);

      const req = makeAuthReq({ id: INVOICE_ID }, { userId: 'user-1' });
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await controller.acceptPricingHandler(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // =======================================================================
  // rejectPricingHandler
  // =======================================================================
  describe('rejectPricingHandler', () => {
    it('returns 200 on successful reject with full auth context', async () => {
      mockedService.rejectPricing.mockResolvedValue(undefined);

      const req = makeAuthReq(
        { id: INVOICE_ID },
        {
          userId: 'user-1',
          ip: '10.0.0.1',
          userAgent: 'TestAgent/1.0',
          body: { reason: 'Too expensive' },
        },
      );
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await controller.rejectPricingHandler(req as Request, res as Response, next);

      expect(mockedService.rejectPricing).toHaveBeenCalledWith(
        INVOICE_ID,
        'user-1',
        'Too expensive',
        '10.0.0.1',
        'TestAgent/1.0',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Pricing rejected' });
    });

    it('falls back to empty strings when user/ip/userAgent are missing', async () => {
      mockedService.rejectPricing.mockResolvedValue(undefined);

      const req = makeAuthReq({ id: INVOICE_ID }, { body: { reason: 'Too expensive' } });
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await controller.rejectPricingHandler(req as Request, res as Response, next);

      expect(mockedService.rejectPricing).toHaveBeenCalledWith(
        INVOICE_ID,
        '',
        'Too expensive',
        '',
        '',
      );
    });

    it('delegates errors to next()', async () => {
      const error = new Error('Already rejected');
      mockedService.rejectPricing.mockRejectedValue(error);

      const req = makeAuthReq(
        { id: INVOICE_ID },
        { userId: 'user-1', body: { reason: 'Bad terms' } },
      );
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await controller.rejectPricingHandler(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // =======================================================================
  // disputePricingHandler
  // =======================================================================
  describe('disputePricingHandler', () => {
    const MOCK_DISPUTE: DisputeResponse = {
      id: 'dispute-uuid-1',
      invoiceId: INVOICE_ID,
      reason: 'rate_too_high',
      proposedRate: null,
      proposedAdvancePct: null,
      notes: null,
      submittedAt: '2026-04-11T00:00:00.000Z',
      slaDeadline: '2026-04-12T00:00:00.000Z',
      status: 'open',
    };

    it('calls service.disputePricing and responds 201 with result', async () => {
      mockedService.disputePricing.mockResolvedValue(MOCK_DISPUTE);

      const req = makeAuthReq(
        { id: INVOICE_ID },
        {
          userId: 'user-1',
          ip: '10.0.0.1',
          userAgent: 'TestAgent/1.0',
          body: { reason: 'rate_too_high' },
        },
      );
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await controller.disputePricingHandler(req as Request, res as Response, next);

      expect(mockedService.disputePricing).toHaveBeenCalledWith(
        INVOICE_ID,
        'user-1',
        { reason: 'rate_too_high' },
        '10.0.0.1',
        'TestAgent/1.0',
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(MOCK_DISPUTE);
    });

    it('delegates errors to next()', async () => {
      const error = new Error('Already disputed');
      mockedService.disputePricing.mockRejectedValue(error);

      const req = makeAuthReq(
        { id: INVOICE_ID },
        { userId: 'user-1', body: { reason: 'rate_too_high' } },
      );
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await controller.disputePricingHandler(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // =======================================================================
  // handlePriceInvoiceJob
  // =======================================================================
  describe('handlePriceInvoiceJob', () => {
    it('calls priceInvoice with the invoice ID', async () => {
      mockedService.priceInvoice.mockResolvedValue(makePricingResult());

      await controller.handlePriceInvoiceJob(INVOICE_ID);

      expect(mockedService.priceInvoice).toHaveBeenCalledWith(INVOICE_ID);
    });

    it('propagates errors from the service', async () => {
      mockedService.priceInvoice.mockRejectedValue(new Error('Pricing failed'));

      await expect(controller.handlePriceInvoiceJob(INVOICE_ID)).rejects.toThrow('Pricing failed');
    });
  });
});
