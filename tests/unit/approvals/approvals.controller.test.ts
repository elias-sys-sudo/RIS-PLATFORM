process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import { Request, Response, NextFunction } from 'express';
import * as controller from '../../../src/services/approvals/approvals.controller';
import * as service from '../../../src/services/approvals/approvals.service';
import { ApprovalTier, ApprovalDecision } from '../../../src/services/approvals/approvals.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/approvals/approvals.service');
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

function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    body: {},
    query: {},
    user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('test-agent'),
    ...overrides,
  } as unknown as Request;
}

function mockResponse(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('approvals.controller', () => {
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
  });

  // =========================================================================
  // approveHandler
  // =========================================================================
  describe('approveHandler', () => {
    it('calls service.approveInvoice and returns 200', async () => {
      mockedService.approveInvoice.mockResolvedValue({
        approvalId: 'appr-1',
        invoiceId: 'inv-1',
        tier: ApprovalTier.TIER_2,
        decision: ApprovalDecision.APPROVED,
        comments: 'Approved after review of buyer data',
        quorumReached: true,
      });

      const req = mockRequest({
        params: { id: 'inv-1' },
        body: { comments: 'Approved after review of buyer data' },
      });
      const res = mockResponse();

      await controller.approveHandler(req, res, next);

      expect(mockedService.approveInvoice).toHaveBeenCalledWith(
        'inv-1',
        'officer-1',
        'credit_officer',
        '127.0.0.1',
        'test-agent',
        'Approved after review of buyer data',
        undefined,
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: ApprovalDecision.APPROVED,
        }),
      );
    });

    it('forwards errors to next()', async () => {
      const error = new Error('Test error');
      mockedService.approveInvoice.mockRejectedValue(error);

      const req = mockRequest({
        params: { id: 'inv-1' },
        body: { comments: 'Some review comments here' },
      });
      const res = mockResponse();

      await controller.approveHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // =========================================================================
  // rejectHandler
  // =========================================================================
  describe('rejectHandler', () => {
    it('calls service.rejectInvoice and returns 200', async () => {
      mockedService.rejectInvoice.mockResolvedValue({
        approvalId: 'appr-2',
        invoiceId: 'inv-1',
        tier: ApprovalTier.TIER_2,
        decision: ApprovalDecision.REJECTED,
        comments: 'Buyer credit history is concerning',
        quorumReached: false,
      });

      const req = mockRequest({
        params: { id: 'inv-1' },
        body: { comments: 'Buyer credit history is concerning' },
      });
      const res = mockResponse();

      await controller.rejectHandler(req, res, next);

      expect(mockedService.rejectInvoice).toHaveBeenCalledWith(
        'inv-1',
        'officer-1',
        'credit_officer',
        '127.0.0.1',
        'test-agent',
        'Buyer credit history is concerning',
        undefined,
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('forwards errors to next()', async () => {
      const error = new Error('Rejection failed');
      mockedService.rejectInvoice.mockRejectedValue(error);

      const req = mockRequest({
        params: { id: 'inv-1' },
        body: { comments: 'Buyer credit history is quite concerning' },
      });
      const res = mockResponse();

      await controller.rejectHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // =========================================================================
  // getQueueHandler
  // =========================================================================
  describe('getQueueHandler', () => {
    it('returns approval queue for the officer', async () => {
      mockedService.getApprovalQueue.mockResolvedValue([
        {
          invoice_id: 'inv-1',
          face_value: '25000000',
          supplier_id: 'sup-1',
          buyer_id: 'buyer-1',
          tier: ApprovalTier.TIER_2,
          status: 'scored',
          final_score: 65,
          aml_flagged: false,
          created_at: '2026-03-21T10:00:00Z',
        },
      ]);

      const req = mockRequest();
      const res = mockResponse();

      await controller.getQueueHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.arrayContaining([expect.objectContaining({ invoice_id: 'inv-1' })]),
        }),
      );
    });

    it('forwards errors to next()', async () => {
      const error = new Error('Queue fetch failed');
      mockedService.getApprovalQueue.mockRejectedValue(error);

      const req = mockRequest();
      const res = mockResponse();

      await controller.getQueueHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // =========================================================================
  // handleSlaCheckJob
  // =========================================================================
  describe('handleSlaCheckJob', () => {
    it('calls service.checkSlaBreaches', async () => {
      mockedService.checkSlaBreaches.mockResolvedValue(undefined);

      await controller.handleSlaCheckJob();

      expect(mockedService.checkSlaBreaches).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // approveHandler — null/undefined branch coverage
  // =========================================================================
  describe('approveHandler — fallback branches', () => {
    it('uses empty string when req.user is undefined', async () => {
      mockedService.approveInvoice.mockResolvedValue({
        approvalId: 'appr-1',
        invoiceId: 'inv-1',
        tier: ApprovalTier.TIER_2,
        decision: ApprovalDecision.APPROVED,
        comments: 'Approved after review of buyer data',
        quorumReached: true,
      });

      const req = mockRequest({
        params: { id: 'inv-1' },
        body: { comments: 'Approved after review of buyer data' },
        user: undefined,
      });
      const res = mockResponse();

      await controller.approveHandler(req, res, next);

      expect(mockedService.approveInvoice).toHaveBeenCalledWith(
        'inv-1',
        '',
        '',
        expect.any(String),
        expect.any(String),
        'Approved after review of buyer data',
        undefined,
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('uses "unknown" when req.ip is null and user-agent is null', async () => {
      mockedService.approveInvoice.mockResolvedValue({
        approvalId: 'appr-1',
        invoiceId: 'inv-1',
        tier: ApprovalTier.TIER_2,
        decision: ApprovalDecision.APPROVED,
        comments: 'Approved after review of buyer data',
        quorumReached: true,
      });

      const req = mockRequest({
        params: { id: 'inv-1' },
        body: { comments: 'Approved after review of buyer data' },
        ip: undefined,
        get: jest.fn().mockReturnValue(null),
      });
      const res = mockResponse();

      await controller.approveHandler(req, res, next);

      expect(mockedService.approveInvoice).toHaveBeenCalledWith(
        'inv-1',
        'officer-1',
        'credit_officer',
        'unknown',
        'unknown',
        'Approved after review of buyer data',
        undefined,
        undefined,
      );
    });
  });

  // =========================================================================
  // rejectHandler — null/undefined branch coverage
  // =========================================================================
  describe('rejectHandler — fallback branches', () => {
    it('uses empty string when req.user is undefined', async () => {
      mockedService.rejectInvoice.mockResolvedValue({
        approvalId: 'appr-2',
        invoiceId: 'inv-1',
        tier: ApprovalTier.TIER_2,
        decision: ApprovalDecision.REJECTED,
        comments: 'Buyer credit history is concerning',
        quorumReached: false,
      });

      const req = mockRequest({
        params: { id: 'inv-1' },
        body: { comments: 'Buyer credit history is concerning' },
        user: undefined,
      });
      const res = mockResponse();

      await controller.rejectHandler(req, res, next);

      expect(mockedService.rejectInvoice).toHaveBeenCalledWith(
        'inv-1',
        '',
        '',
        expect.any(String),
        expect.any(String),
        'Buyer credit history is concerning',
        undefined,
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('uses "unknown" when req.ip is null and user-agent is null', async () => {
      mockedService.rejectInvoice.mockResolvedValue({
        approvalId: 'appr-2',
        invoiceId: 'inv-1',
        tier: ApprovalTier.TIER_2,
        decision: ApprovalDecision.REJECTED,
        comments: 'Buyer credit history is concerning',
        quorumReached: false,
      });

      const req = mockRequest({
        params: { id: 'inv-1' },
        body: { comments: 'Buyer credit history is concerning' },
        ip: undefined,
        get: jest.fn().mockReturnValue(null),
      });
      const res = mockResponse();

      await controller.rejectHandler(req, res, next);

      expect(mockedService.rejectInvoice).toHaveBeenCalledWith(
        'inv-1',
        'officer-1',
        'credit_officer',
        'unknown',
        'unknown',
        'Buyer credit history is concerning',
        undefined,
        undefined,
      );
    });
  });

  // =========================================================================
  // getQueueHandler — null/undefined branch coverage
  // =========================================================================
  describe('getQueueHandler — fallback branches', () => {
    it('uses empty string userId when req.user is undefined', async () => {
      mockedService.getApprovalQueue.mockResolvedValue([]);

      const req = mockRequest({ user: undefined });
      const res = mockResponse();

      await controller.getQueueHandler(req, res, next);

      expect(mockedService.getApprovalQueue).toHaveBeenCalledWith('');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
