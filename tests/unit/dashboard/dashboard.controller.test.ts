process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';

import type { Request, Response, NextFunction } from 'express';
import {
  summaryHandler,
  paymentHistoryHandler,
} from '../../../src/services/dashboard/dashboard.controller';
import * as service from '../../../src/services/dashboard/dashboard.service';

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock('../../../src/services/dashboard/dashboard.service');

const mockedService = service as jest.Mocked<typeof service>;

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    user: { userId: 'user-1', role: 'finance_manager', sessionId: 'sess-1' },
    query: {},
    params: {},
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('jest-agent'),
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('dashboard.controller', () => {
  const next: NextFunction = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('summaryHandler', () => {
    it('returns 200 with summary data', async () => {
      const summary = {
        period: '30d' as const,
        cached_at: new Date().toISOString(),
        stats: {
          total_invoices: 5,
          total_face_value: 50_000_000,
          total_funded: 40_000_000,
          collection_rate: 60,
          overdue_count: 1,
          overdue_amount: 10_000_000,
          avg_tenor_days: 12,
          active_facilities: 1,
        },
        trends: {
          total_face_value_change: 0,
          total_funded_change: 0,
          collection_rate_change: 0,
          overdue_amount_change: 0,
        },
        invoice_status_breakdown: [],
        payment_method_breakdown: [],
        trend_data: [],
        escalation_overview: { none: 0, reminder: 0, formal: 0, legal: 0 },
        recent_activity: [],
      };
      mockedService.getDashboardSummary.mockResolvedValue(summary);

      const req = mockReq({ query: { period: '30d' } });
      const res = mockRes();

      await summaryHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: summary });
    });

    it('calls next on error', async () => {
      mockedService.getDashboardSummary.mockRejectedValue(new Error('fail'));

      const req = mockReq();
      const res = mockRes();

      await summaryHandler(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('paymentHistoryHandler', () => {
    it('returns 200 with payment history', async () => {
      const result = {
        data: [],
        pagination: { page: 1, limit: 20, total: 0, total_pages: 0 },
        summary: {
          total_paid: '0',
          payment_count: 0,
          last_payment_date: null,
          by_method: [],
        },
      };
      mockedService.getPaymentHistory.mockResolvedValue(result);

      const req = mockReq({ query: { supplier_id: 'sup-1' } });
      const res = mockRes();

      await paymentHistoryHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(result);
    });

    it('passes filter parameters correctly', async () => {
      const result = {
        data: [],
        pagination: { page: 2, limit: 10, total: 25, total_pages: 3 },
        summary: {
          total_paid: '0',
          payment_count: 0,
          last_payment_date: null,
          by_method: [],
        },
      };
      mockedService.getPaymentHistory.mockResolvedValue(result);

      const req = mockReq({
        query: {
          supplier_id: 'sup-1',
          from: '2025-01-01',
          to: '2025-12-31',
          method: 'EFT',
          min_amount: '100000',
          sort: 'amount',
          order: 'desc',
          page: '2',
          limit: '10',
        },
      });
      const res = mockRes();

      await paymentHistoryHandler(req, res, next);

      expect(mockedService.getPaymentHistory).toHaveBeenCalledWith(
        'user-1',
        'finance_manager',
        expect.objectContaining({
          supplierId: 'sup-1',
          from: '2025-01-01',
          to: '2025-12-31',
          method: 'EFT',
          minAmount: '100000',
          sort: 'amount',
          order: 'desc',
          page: 2,
          limit: 10,
        }),
        '127.0.0.1',
        'jest-agent',
      );
    });
  });
});
