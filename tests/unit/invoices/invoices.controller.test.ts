process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import { Request, Response, NextFunction } from 'express';
import {
  submitInvoiceHandler,
  listInvoicesHandler,
  getInvoiceHandler,
  getInvoiceTimelineHandler,
} from '../../../src/services/invoices/invoices.controller';
import * as invoiceService from '../../../src/services/invoices/invoices.service';

jest.mock('../../../src/services/invoices/invoices.service');
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedService = invoiceService as jest.Mocked<typeof invoiceService>;

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    ip: '127.0.0.1',
    user: { userId: 'user-1', role: 'supplier', sessionId: 'sess-1' },
    get: jest.fn().mockReturnValue('test-agent'),
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const next: NextFunction = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('submitInvoiceHandler', () => {
  it('returns 201 with invoiceId on success', async () => {
    mockedService.submitInvoice.mockResolvedValue({ invoiceId: 'inv-1' });

    const req = mockReq({
      body: {
        invoice_number: 'INV-001',
        buyer_id: 'buyer-1',
        face_value: 50000000,
        due_date: '2026-05-01',
        description: 'Test',
      },
    });
    const res = mockRes();

    await submitInvoiceHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: 'inv-1' }));
  });

  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.submitInvoice.mockRejectedValue(error);

    const req = mockReq({ body: {} });
    const res = mockRes();

    await submitInvoiceHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('defaults userId and ip when missing', async () => {
    mockedService.submitInvoice.mockResolvedValue({ invoiceId: 'inv-1' });

    const req = mockReq({ user: undefined, ip: undefined });
    const res = mockRes();

    await submitInvoiceHandler(req, res, next);

    expect(mockedService.submitInvoice).toHaveBeenCalledWith(
      '',
      expect.anything(),
      'unknown',
      expect.any(String),
    );
  });
});

describe('listInvoicesHandler', () => {
  it('returns 200 with paginated result', async () => {
    mockedService.listInvoices.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const req = mockReq({ query: {} });
    const res = mockRes();

    await listInvoicesHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('passes filters from query params', async () => {
    mockedService.listInvoices.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 0,
    });

    const req = mockReq({
      query: {
        page: '2',
        limit: '10',
        status: 'submitted',
        buyer_id: 'buyer-1',
        date_from: '2026-01-01',
        date_to: '2026-12-31',
      },
    });
    const res = mockRes();

    await listInvoicesHandler(req, res, next);

    expect(mockedService.listInvoices).toHaveBeenCalledWith(
      'user-1',
      'supplier',
      {
        status: 'submitted',
        buyer_id: 'buyer-1',
        date_from: '2026-01-01',
        date_to: '2026-12-31',
      },
      { page: 2, limit: 10 },
    );
  });

  it('clamps limit to 100', async () => {
    mockedService.listInvoices.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 100,
      totalPages: 0,
    });

    const req = mockReq({ query: { limit: '500' } });
    const res = mockRes();

    await listInvoicesHandler(req, res, next);

    expect(mockedService.listInvoices).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ limit: 100 }),
    );
  });

  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.listInvoices.mockRejectedValue(error);

    const req = mockReq({ query: {} });
    const res = mockRes();

    await listInvoicesHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('getInvoiceHandler', () => {
  it('returns 200 with invoice detail', async () => {
    mockedService.getInvoiceDetail.mockResolvedValue({
      id: 'inv-1',
      face_value: 50000000,
    } as never);

    const req = mockReq({ params: { id: 'inv-1' } });
    const res = mockRes();

    await getInvoiceHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.getInvoiceDetail.mockRejectedValue(error);

    const req = mockReq({ params: { id: 'inv-1' } });
    const res = mockRes();

    await getInvoiceHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('getInvoiceTimelineHandler', () => {
  it('returns 200 with timeline', async () => {
    mockedService.getInvoiceTimeline.mockResolvedValue([]);

    const req = mockReq({
      params: { id: 'inv-1' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await getInvoiceTimelineHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ timeline: [] });
  });

  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.getInvoiceTimeline.mockRejectedValue(error);

    const req = mockReq({ params: { id: 'inv-1' } });
    const res = mockRes();

    await getInvoiceTimelineHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('defaults role when user is missing', async () => {
    mockedService.getInvoiceTimeline.mockResolvedValue([]);

    const req = mockReq({ params: { id: 'inv-1' }, user: undefined });
    const res = mockRes();

    await getInvoiceTimelineHandler(req, res, next);

    expect(mockedService.getInvoiceTimeline).toHaveBeenCalledWith('inv-1', '');
  });
});
