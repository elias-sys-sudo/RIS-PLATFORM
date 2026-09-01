process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import type { Request, Response, NextFunction } from 'express';
import {
  getConfirmationPageHandler,
  confirmInvoiceHandler,
  raiseDisputeHandler,
  resendConfirmationHandler,
  listPendingConfirmationsHandler,
} from '../../../src/services/verification/verification.controller';
import * as verificationService from '../../../src/services/verification/verification.service';

jest.mock('../../../src/services/verification/verification.service');
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedService = verificationService as jest.Mocked<typeof verificationService>;

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    ip: '127.0.0.1',
    user: { userId: 'user-1', role: 'credit_officer', sessionId: 'sess-1' },
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

// =========================================================================
// getConfirmationPageHandler
// =========================================================================
describe('getConfirmationPageHandler', () => {
  it('returns 200 with confirmation page data', async () => {
    const pageData = {
      invoice_number: 'INV-001',
      supplier_name: 'Supplier Ltd',
      buyer_name: 'Buyer Ltd',
      face_value: 50000000,
      due_date: '2026-05-01',
      description: 'Test goods',
      ris_bank_details: 'RIS bank details',
    };
    mockedService.getConfirmationPageData.mockResolvedValue(pageData);

    const req = mockReq({ params: { token: 'a'.repeat(64) } });
    const res = mockRes();

    await getConfirmationPageHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(pageData);
    expect(mockedService.getConfirmationPageData).toHaveBeenCalledWith('a'.repeat(64));
  });

  it('passes errors to next', async () => {
    const error = new Error('Token not found');
    mockedService.getConfirmationPageData.mockRejectedValue(error);

    const req = mockReq({ params: { token: 'b'.repeat(64) } });
    const res = mockRes();

    await getConfirmationPageHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

// =========================================================================
// confirmInvoiceHandler
// =========================================================================
describe('confirmInvoiceHandler', () => {
  it('returns 200 with invoiceId on success', async () => {
    mockedService.confirmInvoice.mockResolvedValue({
      invoiceId: 'inv-1',
    });

    const req = mockReq({
      params: { token: 'a'.repeat(64) },
      body: {
        invoice_is_valid: true,
        amount_is_correct: true,
        due_date_is_correct: true,
        agrees_to_pay_ris: true,
      },
    });
    const res = mockRes();

    await confirmInvoiceHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      invoiceId: 'inv-1',
      message: 'Invoice confirmed successfully',
    });
  });

  it('passes IP and user-agent to service', async () => {
    mockedService.confirmInvoice.mockResolvedValue({ invoiceId: 'inv-1' });

    const req = mockReq({
      params: { token: 'a'.repeat(64) },
      body: {
        invoice_is_valid: true,
        amount_is_correct: true,
        due_date_is_correct: true,
        agrees_to_pay_ris: true,
      },
      ip: '10.0.0.1',
    });
    (req.get as jest.Mock).mockReturnValue('Custom-Agent');
    const res = mockRes();

    await confirmInvoiceHandler(req, res, next);

    expect(mockedService.confirmInvoice).toHaveBeenCalledWith(
      'a'.repeat(64),
      expect.any(Object),
      '10.0.0.1',
      'Custom-Agent',
    );
  });

  it('passes errors to next', async () => {
    const error = new Error('Confirmation failed');
    mockedService.confirmInvoice.mockRejectedValue(error);

    const req = mockReq({
      params: { token: 'a'.repeat(64) },
      body: {},
    });
    const res = mockRes();

    await confirmInvoiceHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('handles missing ip and user-agent gracefully', async () => {
    mockedService.confirmInvoice.mockResolvedValue({ invoiceId: 'inv-1' });

    const req = mockReq({
      params: { token: 'a'.repeat(64) },
      body: {
        invoice_is_valid: true,
        amount_is_correct: true,
        due_date_is_correct: true,
        agrees_to_pay_ris: true,
      },
      ip: undefined,
    });
    (req.get as jest.Mock).mockReturnValue(undefined);
    const res = mockRes();

    await confirmInvoiceHandler(req, res, next);

    expect(mockedService.confirmInvoice).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      'unknown',
      'unknown',
    );
  });
});

// =========================================================================
// raiseDisputeHandler
// =========================================================================
describe('raiseDisputeHandler', () => {
  it('returns 201 with disputeId on success', async () => {
    mockedService.raiseDispute.mockResolvedValue({
      id: 'dispute-1',
      invoice_id: 'inv-1',
      buyer_id: 'buyer-1',
      dispute_reason: 'Wrong amount',
      dispute_type: 'general',
      status: 'open',
      created_at: '2026-01-01T00:00:00Z',
    });

    const req = mockReq({
      params: { token: 'a'.repeat(64) },
      body: { reason: 'Wrong amount' },
    });
    const res = mockRes();

    await raiseDisputeHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      disputeId: 'dispute-1',
      message: 'Dispute raised successfully',
    });
    expect(mockedService.raiseDispute).toHaveBeenCalledWith(
      'a'.repeat(64),
      { reason: 'Wrong amount' },
      '127.0.0.1',
      'test-agent',
    );
  });

  it('passes errors to next', async () => {
    const error = new Error('Dispute failed');
    mockedService.raiseDispute.mockRejectedValue(error);

    const req = mockReq({
      params: { token: 'a'.repeat(64) },
      body: { reason: 'Wrong amount' },
    });
    const res = mockRes();

    await raiseDisputeHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('falls back to "unknown" when ip and user-agent are undefined', async () => {
    mockedService.raiseDispute.mockResolvedValue({
      id: 'dispute-2',
      invoice_id: 'inv-1',
      buyer_id: 'buyer-1',
      dispute_reason: 'Wrong amount',
      dispute_type: 'general',
      status: 'open',
      created_at: '2026-01-01T00:00:00Z',
    });

    const req = mockReq({
      params: { token: 'a'.repeat(64) },
      body: { reason: 'Wrong amount' },
      ip: undefined,
    });
    (req.get as jest.Mock).mockReturnValue(undefined);
    const res = mockRes();

    await raiseDisputeHandler(req, res, next);

    expect(mockedService.raiseDispute).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      'unknown',
      'unknown',
    );
  });
});

// =========================================================================
// resendConfirmationHandler
// =========================================================================
describe('resendConfirmationHandler', () => {
  it('returns 200 with success message', async () => {
    mockedService.resendConfirmation.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'inv-1' },
    });
    const res = mockRes();

    await resendConfirmationHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Confirmation email resent',
    });
    expect(mockedService.resendConfirmation).toHaveBeenCalledWith(
      'inv-1',
      'user-1',
      '127.0.0.1',
      'test-agent',
    );
  });

  it('passes errors to next', async () => {
    const error = new Error('Not found');
    mockedService.resendConfirmation.mockRejectedValue(error);

    const req = mockReq({ params: { id: 'inv-1' } });
    const res = mockRes();

    await resendConfirmationHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('handles missing userId gracefully', async () => {
    mockedService.resendConfirmation.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'inv-1' },
      user: undefined,
    });
    const res = mockRes();

    await resendConfirmationHandler(req, res, next);

    expect(mockedService.resendConfirmation).toHaveBeenCalledWith(
      'inv-1',
      '',
      expect.any(String),
      expect.any(String),
    );
  });

  it('falls back to "unknown" when req.ip and user-agent are both undefined', async () => {
    mockedService.resendConfirmation.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'inv-1' },
      ip: undefined,
    });
    (req.get as jest.Mock).mockReturnValue(undefined);
    const res = mockRes();

    await resendConfirmationHandler(req, res, next);

    expect(mockedService.resendConfirmation).toHaveBeenCalledWith(
      'inv-1',
      expect.any(String),
      'unknown',
      'unknown',
    );
  });
});

// =========================================================================
// listPendingConfirmationsHandler
// =========================================================================
describe('listPendingConfirmationsHandler', () => {
  it('returns 200 with paginated results', async () => {
    const mockResult = {
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    };
    mockedService.listPendingConfirmations.mockResolvedValue(mockResult);

    const req = mockReq({ query: {} });
    const res = mockRes();

    await listPendingConfirmationsHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(mockResult);
  });

  it('parses page and limit from query', async () => {
    mockedService.listPendingConfirmations.mockResolvedValue({
      data: [],
      total: 0,
      page: 2,
      limit: 10,
      totalPages: 0,
    });

    const req = mockReq({ query: { page: '2', limit: '10' } });
    const res = mockRes();

    await listPendingConfirmationsHandler(req, res, next);

    expect(mockedService.listPendingConfirmations).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
    });
  });

  it('caps limit at 100', async () => {
    mockedService.listPendingConfirmations.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 100,
      totalPages: 0,
    });

    const req = mockReq({ query: { limit: '500' } });
    const res = mockRes();

    await listPendingConfirmationsHandler(req, res, next);

    expect(mockedService.listPendingConfirmations).toHaveBeenCalledWith({
      page: 1,
      limit: 100,
    });
  });

  it('defaults page=1 and limit=20 when not provided', async () => {
    mockedService.listPendingConfirmations.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const req = mockReq({ query: {} });
    const res = mockRes();

    await listPendingConfirmationsHandler(req, res, next);

    expect(mockedService.listPendingConfirmations).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
    });
  });

  it('passes errors to next', async () => {
    const error = new Error('DB error');
    mockedService.listPendingConfirmations.mockRejectedValue(error);

    const req = mockReq({ query: {} });
    const res = mockRes();

    await listPendingConfirmationsHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
