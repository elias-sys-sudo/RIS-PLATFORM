process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long-for-jwt';

import { Request, Response, NextFunction } from 'express';
import {
  registerSupplierHandler,
  getSupplierHandler,
  uploadDocumentHandler,
  listDocumentsHandler,
  updateKycStatusHandler,
  listSuppliersHandler,
  createBuyerHandler,
  listBuyersHandler,
  getBuyerHandler,
  updateBuyerHandler,
  checkEligibilityHandler,
  ursbVerifyHandler,
  litigationCheckHandler,
  createBuyerRequestHandler,
  reviewBuyerRequestHandler,
  listBuyerRequestsHandler,
  listSupplierBuyerRequestsHandler,
  createUboHandler,
  listUbosHandler,
  updateUboHandler,
  deleteUboHandler,
} from '../../../src/services/onboarding/onboarding.controller';
import * as onboardingService from '../../../src/services/onboarding/onboarding.service';

jest.mock('../../../src/services/onboarding/onboarding.service');
jest.mock('../../../src/shared/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), audit: jest.fn() },
}));

const mockedService = onboardingService as jest.Mocked<typeof onboardingService>;

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    ip: '127.0.0.1',
    user: { userId: 'user-1', role: 'supplier', sessionId: 'sess-1' },
    get: jest.fn().mockReturnValue('test-agent'),
    file: undefined,
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

describe('registerSupplierHandler', () => {
  it('returns 201 with userId and supplierId', async () => {
    mockedService.registerSupplier.mockResolvedValue({
      userId: 'user-1',
      supplierId: 'supp-1',
    });

    const req = mockReq({ body: { email: 'test@test.com' } });
    const res = mockRes();

    await registerSupplierHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', supplierId: 'supp-1' }),
    );
  });

  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.registerSupplier.mockRejectedValue(error);

    const req = mockReq({ body: {} });
    const res = mockRes();

    await registerSupplierHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('handlers with missing req.user', () => {
  it('getSupplierHandler defaults userId and role to empty string', async () => {
    mockedService.getSupplierProfile.mockResolvedValue({
      id: 'supp-1',
      user_id: '',
      company_name: 'Test',
      registration_number: 'REG-1',
      tax_id: 'TAX-1',
      directors: [],
      bank_name: 'Bank',
      bank_branch: 'Main',
      preferred_payment_method: 'EFT' as never,
      kyc_status: 'pending' as never,
      sanctions_flag: false,
      created_at: '2026-03-20',
      required_financing_amount: null,
      consent_ursb_check: false,
      consent_supplier_refs: false,
      consent_litigation_check: false,
      ursb_verified: false,
      ursb_verified_at: null,
      litigation_checked: false,
      litigation_flag: false,
    });

    const req = mockReq({ params: { id: 'supp-1' }, user: undefined });
    const res = mockRes();

    await getSupplierHandler(req, res, next);

    expect(mockedService.getSupplierProfile).toHaveBeenCalledWith('supp-1', '', '');
  });

  it('uploadDocumentHandler defaults userId and role', async () => {
    mockedService.uploadDocument.mockResolvedValue({ documentId: 'doc-1' });

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { document_type: 'certificate_of_incorporation' },
      file: {
        buffer: Buffer.from('content'),
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        size: 1000,
      } as Express.Multer.File,
      user: undefined,
    });
    const res = mockRes();

    await uploadDocumentHandler(req, res, next);

    expect(mockedService.uploadDocument).toHaveBeenCalledWith(
      'supp-1',
      '',
      '',
      expect.anything(),
      'certificate_of_incorporation',
      expect.any(String),
      expect.any(String),
    );
  });

  it('listDocumentsHandler defaults userId and role', async () => {
    mockedService.listDocuments.mockResolvedValue([]);

    const req = mockReq({ params: { id: 'supp-1' }, user: undefined });
    const res = mockRes();

    await listDocumentsHandler(req, res, next);

    expect(mockedService.listDocuments).toHaveBeenCalledWith('supp-1', '', '');
  });

  it('updateKycStatusHandler defaults reviewerId', async () => {
    mockedService.updateKycStatus.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { status: 'approved', comments: 'test' },
      user: undefined,
    });
    const res = mockRes();

    await updateKycStatusHandler(req, res, next);

    expect(mockedService.updateKycStatus).toHaveBeenCalledWith(
      'supp-1',
      expect.anything(),
      '',
      expect.any(String),
      expect.any(String),
    );
  });

  it('createBuyerHandler defaults createdBy', async () => {
    mockedService.createBuyer.mockResolvedValue({ buyerId: 'buyer-1' });

    const req = mockReq({ body: { company_name: 'Test' }, user: undefined });
    const res = mockRes();

    await createBuyerHandler(req, res, next);

    expect(mockedService.createBuyer).toHaveBeenCalledWith(
      expect.anything(),
      '',
      expect.any(String),
      expect.any(String),
    );
  });

  it('updateBuyerHandler defaults updatedBy', async () => {
    mockedService.updateBuyerProfile.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'buyer-1' },
      body: { credit_rating: 'B' },
      user: undefined,
    });
    const res = mockRes();

    await updateBuyerHandler(req, res, next);

    expect(mockedService.updateBuyerProfile).toHaveBeenCalledWith(
      'buyer-1',
      expect.anything(),
      '',
      expect.any(String),
      expect.any(String),
    );
  });

  it('registerSupplierHandler with missing ip defaults to unknown', async () => {
    mockedService.registerSupplier.mockResolvedValue({
      userId: 'user-1',
      supplierId: 'supp-1',
    });

    const req = mockReq({ body: {}, ip: undefined });
    const res = mockRes();

    await registerSupplierHandler(req, res, next);

    expect(mockedService.registerSupplier).toHaveBeenCalledWith(
      expect.anything(),
      'unknown',
      expect.any(String),
    );
  });
});

describe('getSupplierHandler — error path', () => {
  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.getSupplierProfile.mockRejectedValue(error);

    const req = mockReq({ params: { id: 'supp-1' } });
    const res = mockRes();

    await getSupplierHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('getSupplierHandler', () => {
  it('returns 200 with supplier profile', async () => {
    mockedService.getSupplierProfile.mockResolvedValue({
      id: 'supp-1',
      user_id: 'user-1',
      company_name: 'Test',
      registration_number: 'REG-1',
      tax_id: 'TAX-1',
      directors: [],
      bank_name: 'Bank',
      bank_branch: 'Main',
      preferred_payment_method: 'EFT' as never,
      kyc_status: 'pending' as never,
      sanctions_flag: false,
      created_at: '2026-03-20',
      required_financing_amount: null,
      consent_ursb_check: false,
      consent_supplier_refs: false,
      consent_litigation_check: false,
      ursb_verified: false,
      ursb_verified_at: null,
      litigation_checked: false,
      litigation_flag: false,
    });

    const req = mockReq({ params: { id: 'supp-1' } });
    const res = mockRes();

    await getSupplierHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockedService.getSupplierProfile).toHaveBeenCalledWith('supp-1', 'user-1', 'supplier');
  });
});

describe('uploadDocumentHandler', () => {
  it('returns 400 if no file provided', async () => {
    const req = mockReq({
      params: { id: 'supp-1' },
      body: { document_type: 'certificate_of_incorporation' },
      file: undefined,
    });
    const res = mockRes();

    await uploadDocumentHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
  });

  it('returns 200 with documentId on success', async () => {
    mockedService.uploadDocument.mockResolvedValue({ documentId: 'doc-1' });

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { document_type: 'certificate_of_incorporation' },
      file: {
        buffer: Buffer.from('content'),
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        size: 1000,
      } as Express.Multer.File,
    });
    const res = mockRes();

    await uploadDocumentHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'doc-1' }));
  });
});

describe('uploadDocumentHandler — error path', () => {
  it('calls next on service error', async () => {
    const error = new Error('upload fail');
    mockedService.uploadDocument.mockRejectedValue(error);

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { document_type: 'certificate_of_incorporation' },
      file: {
        buffer: Buffer.from('content'),
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        size: 1000,
      } as Express.Multer.File,
    });
    const res = mockRes();

    await uploadDocumentHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('listDocumentsHandler — error path', () => {
  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.listDocuments.mockRejectedValue(error);

    const req = mockReq({ params: { id: 'supp-1' } });
    const res = mockRes();

    await listDocumentsHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('listDocumentsHandler', () => {
  it('returns documents array', async () => {
    mockedService.listDocuments.mockResolvedValue([]);

    const req = mockReq({ params: { id: 'supp-1' } });
    const res = mockRes();

    await listDocumentsHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ documents: [] });
  });
});

describe('updateKycStatusHandler — error path', () => {
  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.updateKycStatus.mockRejectedValue(error);

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { status: 'approved', comments: 'test' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await updateKycStatusHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('updateKycStatusHandler', () => {
  it('returns 200 on success', async () => {
    mockedService.updateKycStatus.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { status: 'under_review', comments: 'Reviewing now' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await updateKycStatusHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('listSuppliersHandler — error path', () => {
  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.listSuppliersForStaff.mockRejectedValue(error);

    const req = mockReq({ query: {} });
    const res = mockRes();

    await listSuppliersHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('listSuppliersHandler', () => {
  it('passes pagination and filter to service', async () => {
    mockedService.listSuppliersForStaff.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const req = mockReq({
      query: { page: '2', limit: '10', kyc_status: 'approved' },
    });
    const res = mockRes();

    await listSuppliersHandler(req, res, next);

    expect(mockedService.listSuppliersForStaff).toHaveBeenCalledWith(
      { page: 2, limit: 10 },
      'approved',
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('clamps limit to 100', async () => {
    mockedService.listSuppliersForStaff.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 100,
      totalPages: 0,
    });

    const req = mockReq({ query: { limit: '500' } });
    const res = mockRes();

    await listSuppliersHandler(req, res, next);

    expect(mockedService.listSuppliersForStaff).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
      undefined,
    );
  });
});

describe('createBuyerHandler — error path', () => {
  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.createBuyer.mockRejectedValue(error);

    const req = mockReq({
      body: { company_name: 'Test' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await createBuyerHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('createBuyerHandler', () => {
  it('returns 201 with buyerId', async () => {
    mockedService.createBuyer.mockResolvedValue({ buyerId: 'buyer-1' });

    const req = mockReq({
      body: { company_name: 'Buyer Co' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await createBuyerHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ buyerId: 'buyer-1' }));
  });
});

describe('listBuyersHandler — error path', () => {
  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.listBuyersForStaff.mockRejectedValue(error);

    const req = mockReq({ query: {} });
    const res = mockRes();

    await listBuyersHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('listBuyersHandler', () => {
  it('returns paginated buyers', async () => {
    mockedService.listBuyersForStaff.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const req = mockReq({ query: {} });
    const res = mockRes();

    await listBuyersHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getBuyerHandler — error path', () => {
  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.getBuyerProfile.mockRejectedValue(error);

    const req = mockReq({ params: { id: 'buyer-1' } });
    const res = mockRes();

    await getBuyerHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('getBuyerHandler', () => {
  it('returns buyer profile', async () => {
    mockedService.getBuyerProfile.mockResolvedValue({
      id: 'buyer-1',
      company_name: 'Buyer Co',
      registration_number: 'BREG-1',
      credit_rating: 'A',
      approved_limit: '100000000',
      used_limit: '0',
      ris_margin_rate: '0.03',
      payment_score: 85,
      is_active: true,
      sanctions_flag: false,
      payment_undertaking_signed: false,
      payment_undertaking_date: null,
      created_at: '2026-03-20',
    });

    const req = mockReq({ params: { id: 'buyer-1' } });
    const res = mockRes();

    await getBuyerHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('updateBuyerHandler — error path', () => {
  it('calls next on error', async () => {
    const error = new Error('fail');
    mockedService.updateBuyerProfile.mockRejectedValue(error);

    const req = mockReq({
      params: { id: 'buyer-1' },
      body: { credit_rating: 'B' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await updateBuyerHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('updateBuyerHandler', () => {
  it('returns 200 on success', async () => {
    mockedService.updateBuyerProfile.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'buyer-1' },
      body: { credit_rating: 'B' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await updateBuyerHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockedService.updateBuyerProfile).toHaveBeenCalledWith(
      'buyer-1',
      { credit_rating: 'B' },
      'officer-1',
      '127.0.0.1',
      'test-agent',
    );
  });

  it('defaults ip to "unknown" when req.ip is undefined (line 249 branch 1)', async () => {
    mockedService.updateBuyerProfile.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'buyer-1' },
      body: { credit_rating: 'B' },
      ip: undefined,
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await updateBuyerHandler(req, res, next);

    expect(mockedService.updateBuyerProfile).toHaveBeenCalledWith(
      'buyer-1',
      expect.anything(),
      'officer-1',
      'unknown',
      expect.any(String),
    );
  });
});

describe('uploadDocumentHandler — ip fallback', () => {
  it('defaults ip to "unknown" when req.ip is undefined (lines 71-72 branch 1)', async () => {
    mockedService.uploadDocument.mockResolvedValue({ documentId: 'doc-1' });

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { document_type: 'certificate_of_incorporation' },
      file: {
        buffer: Buffer.from('content'),
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        size: 1000,
      } as Express.Multer.File,
      ip: undefined,
    });
    const res = mockRes();

    await uploadDocumentHandler(req, res, next);

    expect(mockedService.uploadDocument).toHaveBeenCalledWith(
      'supp-1',
      expect.any(String),
      expect.any(String),
      expect.anything(),
      'certificate_of_incorporation',
      'unknown',
      expect.any(String),
    );
  });

  it('defaults ua to "unknown" when user-agent header is missing (line 72 branch 1)', async () => {
    mockedService.uploadDocument.mockResolvedValue({ documentId: 'doc-1' });

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { document_type: 'certificate_of_incorporation' },
      file: {
        buffer: Buffer.from('content'),
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        size: 1000,
      } as Express.Multer.File,
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = mockRes();

    await uploadDocumentHandler(req, res, next);

    expect(mockedService.uploadDocument).toHaveBeenCalledWith(
      'supp-1',
      expect.any(String),
      expect.any(String),
      expect.anything(),
      'certificate_of_incorporation',
      expect.any(String),
      'unknown',
    );
  });
});

describe('updateKycStatusHandler — ua fallback', () => {
  it('defaults ua to "unknown" when user-agent header is missing (line 138 branch 1)', async () => {
    mockedService.updateKycStatus.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { status: 'approved', comments: 'test' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = mockRes();

    await updateKycStatusHandler(req, res, next);

    expect(mockedService.updateKycStatus).toHaveBeenCalledWith(
      'supp-1',
      expect.anything(),
      'officer-1',
      expect.any(String),
      'unknown',
    );
  });

  it('defaults ip to "unknown" when req.ip is undefined (line 137 branch 1)', async () => {
    mockedService.updateKycStatus.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { status: 'approved', comments: 'test' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
      ip: undefined,
    });
    const res = mockRes();

    await updateKycStatusHandler(req, res, next);

    expect(mockedService.updateKycStatus).toHaveBeenCalledWith(
      'supp-1',
      expect.anything(),
      'officer-1',
      'unknown',
      expect.any(String),
    );
  });
});

describe('createBuyerHandler — ip/ua fallbacks', () => {
  it('defaults ua to "unknown" when user-agent header is missing (line 184 branch 1)', async () => {
    mockedService.createBuyer.mockResolvedValue({ buyerId: 'buyer-1' });

    const req = mockReq({
      body: { company_name: 'Buyer Co' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = mockRes();

    await createBuyerHandler(req, res, next);

    expect(mockedService.createBuyer).toHaveBeenCalledWith(
      expect.anything(),
      'officer-1',
      expect.any(String),
      'unknown',
    );
  });

  it('defaults ip to "unknown" when req.ip is undefined (line 183 branch 1)', async () => {
    mockedService.createBuyer.mockResolvedValue({ buyerId: 'buyer-1' });

    const req = mockReq({
      body: { company_name: 'Buyer Co' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
      ip: undefined,
    });
    const res = mockRes();

    await createBuyerHandler(req, res, next);

    expect(mockedService.createBuyer).toHaveBeenCalledWith(
      expect.anything(),
      'officer-1',
      'unknown',
      expect.any(String),
    );
  });
});

describe('updateBuyerHandler — ua fallback', () => {
  it('defaults ua to "unknown" when user-agent header is missing (line 250 branch 1)', async () => {
    mockedService.updateBuyerProfile.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'buyer-1' },
      body: { credit_rating: 'B' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = mockRes();

    await updateBuyerHandler(req, res, next);

    expect(mockedService.updateBuyerProfile).toHaveBeenCalledWith(
      'buyer-1',
      expect.anything(),
      'officer-1',
      expect.any(String),
      'unknown',
    );
  });
});

describe('registerSupplierHandler — ua fallback', () => {
  it('defaults ua to "unknown" when user-agent header is missing (line 22 branch 1)', async () => {
    mockedService.registerSupplier.mockResolvedValue({
      userId: 'user-1',
      supplierId: 'supp-1',
    });

    const req = mockReq({
      body: {},
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = mockRes();

    await registerSupplierHandler(req, res, next);

    expect(mockedService.registerSupplier).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      'unknown',
    );
  });
});

// =========================================================================
// checkEligibilityHandler
// =========================================================================
describe('checkEligibilityHandler', () => {
  it('returns 200 with eligibility result', async () => {
    mockedService.checkEligibility.mockResolvedValue({
      passed: true,
      session_token: 'token-1',
      message: 'Eligible',
    });

    const req = mockReq({ body: { registered_company: true } });
    const res = mockRes();

    await checkEligibilityHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockedService.checkEligibility).toHaveBeenCalledWith(expect.anything(), '127.0.0.1');
  });

  it('calls next on error', async () => {
    mockedService.checkEligibility.mockRejectedValue(new Error('fail'));

    const req = mockReq({ body: {} });
    const res = mockRes();

    await checkEligibilityHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('defaults ip to "unknown" when req.ip is undefined', async () => {
    mockedService.checkEligibility.mockResolvedValue({
      passed: false,
      message: 'Not eligible',
    });

    const req = mockReq({ body: {}, ip: undefined });
    const res = mockRes();

    await checkEligibilityHandler(req, res, next);

    expect(mockedService.checkEligibility).toHaveBeenCalledWith(expect.anything(), 'unknown');
  });
});

// =========================================================================
// ursbVerifyHandler
// =========================================================================
describe('ursbVerifyHandler', () => {
  it('returns 200 on success', async () => {
    mockedService.recordUrsbVerification.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { verified: true },
      user: { userId: 'officer-1', role: 'compliance_officer', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await ursbVerifyHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockedService.recordUrsbVerification).toHaveBeenCalledWith(
      'supp-1',
      true,
      'officer-1',
      '127.0.0.1',
      'test-agent',
    );
  });

  it('calls next on error', async () => {
    mockedService.recordUrsbVerification.mockRejectedValue(new Error('fail'));

    const req = mockReq({ params: { id: 'supp-1' }, body: { verified: true } });
    const res = mockRes();

    await ursbVerifyHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('defaults userId to empty string when user is undefined', async () => {
    mockedService.recordUrsbVerification.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { verified: false },
      user: undefined,
    });
    const res = mockRes();

    await ursbVerifyHandler(req, res, next);

    expect(mockedService.recordUrsbVerification).toHaveBeenCalledWith(
      'supp-1',
      false,
      '',
      expect.any(String),
      expect.any(String),
    );
  });

  it('defaults ip and ua to "unknown" when missing', async () => {
    mockedService.recordUrsbVerification.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { verified: true },
      ip: undefined,
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = mockRes();

    await ursbVerifyHandler(req, res, next);

    expect(mockedService.recordUrsbVerification).toHaveBeenCalledWith(
      'supp-1',
      true,
      expect.any(String),
      'unknown',
      'unknown',
    );
  });
});

// =========================================================================
// litigationCheckHandler
// =========================================================================
describe('litigationCheckHandler', () => {
  it('returns 200 on success', async () => {
    mockedService.recordLitigationCheck.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { flag: true },
      user: { userId: 'officer-1', role: 'compliance_officer', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await litigationCheckHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockedService.recordLitigationCheck).toHaveBeenCalledWith(
      'supp-1',
      true,
      'officer-1',
      '127.0.0.1',
      'test-agent',
    );
  });

  it('calls next on error', async () => {
    mockedService.recordLitigationCheck.mockRejectedValue(new Error('fail'));

    const req = mockReq({ params: { id: 'supp-1' }, body: { flag: false } });
    const res = mockRes();

    await litigationCheckHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('defaults userId to empty string when user is undefined', async () => {
    mockedService.recordLitigationCheck.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { flag: false },
      user: undefined,
    });
    const res = mockRes();

    await litigationCheckHandler(req, res, next);

    expect(mockedService.recordLitigationCheck).toHaveBeenCalledWith(
      'supp-1',
      false,
      '',
      expect.any(String),
      expect.any(String),
    );
  });

  it('defaults ip and ua to "unknown" when missing', async () => {
    mockedService.recordLitigationCheck.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'supp-1' },
      body: { flag: true },
      ip: undefined,
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = mockRes();

    await litigationCheckHandler(req, res, next);

    expect(mockedService.recordLitigationCheck).toHaveBeenCalledWith(
      'supp-1',
      true,
      expect.any(String),
      'unknown',
      'unknown',
    );
  });
});

// =========================================================================
// createBuyerRequestHandler
// =========================================================================
describe('createBuyerRequestHandler', () => {
  it('returns 201 with request data', async () => {
    mockedService.createBuyerOnboardingRequest.mockResolvedValue({ requestId: 'req-1' });

    const req = mockReq({
      body: { company_name: 'New Buyer', reason: 'Need to trade' },
      user: { userId: 'supplier-1', role: 'supplier', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await createBuyerRequestHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockedService.createBuyerOnboardingRequest).toHaveBeenCalledWith(
      'supplier-1',
      expect.anything(),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('calls next on error', async () => {
    mockedService.createBuyerOnboardingRequest.mockRejectedValue(new Error('fail'));

    const req = mockReq({ body: {} });
    const res = mockRes();

    await createBuyerRequestHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('defaults supplierId to empty string when user is undefined', async () => {
    mockedService.createBuyerOnboardingRequest.mockResolvedValue({ requestId: 'req-1' });

    const req = mockReq({ body: {}, user: undefined });
    const res = mockRes();

    await createBuyerRequestHandler(req, res, next);

    expect(mockedService.createBuyerOnboardingRequest).toHaveBeenCalledWith(
      '',
      expect.anything(),
      expect.any(String),
      expect.any(String),
    );
  });

  it('defaults ip and ua to "unknown" when missing', async () => {
    mockedService.createBuyerOnboardingRequest.mockResolvedValue({ requestId: 'req-1' });

    const req = mockReq({
      body: {},
      ip: undefined,
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = mockRes();

    await createBuyerRequestHandler(req, res, next);

    expect(mockedService.createBuyerOnboardingRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      'unknown',
      'unknown',
    );
  });
});

// =========================================================================
// reviewBuyerRequestHandler
// =========================================================================
describe('reviewBuyerRequestHandler', () => {
  it('returns 200 on success', async () => {
    mockedService.reviewBuyerOnboardingRequest.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'req-1' },
      body: { status: 'approved' },
      user: { userId: 'officer-1', role: 'credit_officer', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await reviewBuyerRequestHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockedService.reviewBuyerOnboardingRequest).toHaveBeenCalledWith(
      'req-1',
      'officer-1',
      expect.anything(),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('calls next on error', async () => {
    mockedService.reviewBuyerOnboardingRequest.mockRejectedValue(new Error('fail'));

    const req = mockReq({ params: { id: 'req-1' }, body: { status: 'rejected' } });
    const res = mockRes();

    await reviewBuyerRequestHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('defaults reviewerId to empty string when user is undefined', async () => {
    mockedService.reviewBuyerOnboardingRequest.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: 'req-1' }, body: { status: 'approved' }, user: undefined });
    const res = mockRes();

    await reviewBuyerRequestHandler(req, res, next);

    expect(mockedService.reviewBuyerOnboardingRequest).toHaveBeenCalledWith(
      'req-1',
      '',
      expect.anything(),
      expect.any(String),
      expect.any(String),
    );
  });

  it('defaults ip and ua to "unknown" when missing', async () => {
    mockedService.reviewBuyerOnboardingRequest.mockResolvedValue(undefined);

    const req = mockReq({
      params: { id: 'req-1' },
      body: { status: 'approved' },
      ip: undefined,
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = mockRes();

    await reviewBuyerRequestHandler(req, res, next);

    expect(mockedService.reviewBuyerOnboardingRequest).toHaveBeenCalledWith(
      'req-1',
      expect.any(String),
      expect.anything(),
      'unknown',
      'unknown',
    );
  });
});

// =========================================================================
// listBuyerRequestsHandler
// =========================================================================
describe('listBuyerRequestsHandler', () => {
  it('returns 200 with paginated results', async () => {
    mockedService.listBuyerOnboardingRequestsForReview.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const req = mockReq({ query: { page: '2', limit: '10', status: 'pending' } });
    const res = mockRes();

    await listBuyerRequestsHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockedService.listBuyerOnboardingRequestsForReview).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      status: 'pending',
    });
  });

  it('calls next on error', async () => {
    mockedService.listBuyerOnboardingRequestsForReview.mockRejectedValue(new Error('fail'));

    const req = mockReq({ query: {} });
    const res = mockRes();

    await listBuyerRequestsHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('defaults page and limit when query params are absent', async () => {
    mockedService.listBuyerOnboardingRequestsForReview.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const req = mockReq({ query: {} });
    const res = mockRes();

    await listBuyerRequestsHandler(req, res, next);

    expect(mockedService.listBuyerOnboardingRequestsForReview).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      status: undefined,
    });
  });

  it('clamps limit to 100', async () => {
    mockedService.listBuyerOnboardingRequestsForReview.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 100,
      totalPages: 0,
    });

    const req = mockReq({ query: { limit: '500' } });
    const res = mockRes();

    await listBuyerRequestsHandler(req, res, next);

    expect(mockedService.listBuyerOnboardingRequestsForReview).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
  });
});

// =========================================================================
// listSupplierBuyerRequestsHandler
// =========================================================================
describe('listSupplierBuyerRequestsHandler', () => {
  it('returns 200 with supplier buyer requests', async () => {
    mockedService.listSupplierBuyerRequests.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const req = mockReq({
      query: { page: '1', limit: '10' },
      user: { userId: 'supplier-1', role: 'supplier', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await listSupplierBuyerRequestsHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockedService.listSupplierBuyerRequests).toHaveBeenCalledWith('supplier-1', {
      page: 1,
      limit: 10,
    });
  });

  it('calls next on error', async () => {
    mockedService.listSupplierBuyerRequests.mockRejectedValue(new Error('fail'));

    const req = mockReq({ query: {} });
    const res = mockRes();

    await listSupplierBuyerRequestsHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('defaults supplierId to empty when user is undefined', async () => {
    mockedService.listSupplierBuyerRequests.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const req = mockReq({ query: {}, user: undefined });
    const res = mockRes();

    await listSupplierBuyerRequestsHandler(req, res, next);

    expect(mockedService.listSupplierBuyerRequests).toHaveBeenCalledWith('', expect.any(Object));
  });

  it('clamps limit to 100', async () => {
    mockedService.listSupplierBuyerRequests.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 100,
      totalPages: 0,
    });

    const req = mockReq({ query: { limit: '999' } });
    const res = mockRes();

    await listSupplierBuyerRequestsHandler(req, res, next);

    expect(mockedService.listSupplierBuyerRequests).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ limit: 100 }),
    );
  });
});

// =========================================================================
// createUboHandler
// =========================================================================
describe('createUboHandler', () => {
  it('returns 201 with uboId', async () => {
    mockedService.addBeneficialOwner.mockResolvedValue({ uboId: 'ubo-1' });

    const req = mockReq({
      params: { supplier_id: 'supp-1' },
      body: {
        full_name: 'Owner',
        nationality: 'UG',
        id_type: 'national_id',
        id_number: 'NID-1',
        ownership_percentage: 50,
        is_pep: false,
      },
      user: { userId: 'user-1', role: 'supplier', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await createUboHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockedService.addBeneficialOwner).toHaveBeenCalledWith(
      'supp-1',
      expect.anything(),
      'user-1',
      '127.0.0.1',
      'test-agent',
    );
  });

  it('calls next on error', async () => {
    mockedService.addBeneficialOwner.mockRejectedValue(new Error('fail'));

    const req = mockReq({ params: { supplier_id: 'supp-1' }, body: {} });
    const res = mockRes();

    await createUboHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('defaults userId to empty when user is undefined', async () => {
    mockedService.addBeneficialOwner.mockResolvedValue({ uboId: 'ubo-1' });

    const req = mockReq({ params: { supplier_id: 'supp-1' }, body: {}, user: undefined });
    const res = mockRes();

    await createUboHandler(req, res, next);

    expect(mockedService.addBeneficialOwner).toHaveBeenCalledWith(
      'supp-1',
      expect.anything(),
      '',
      expect.any(String),
      expect.any(String),
    );
  });

  it('defaults ip and ua to "unknown" when missing', async () => {
    mockedService.addBeneficialOwner.mockResolvedValue({ uboId: 'ubo-1' });

    const req = mockReq({
      params: { supplier_id: 'supp-1' },
      body: {},
      ip: undefined,
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = mockRes();

    await createUboHandler(req, res, next);

    expect(mockedService.addBeneficialOwner).toHaveBeenCalledWith(
      'supp-1',
      expect.anything(),
      expect.any(String),
      'unknown',
      'unknown',
    );
  });
});

// =========================================================================
// listUbosHandler
// =========================================================================
describe('listUbosHandler', () => {
  it('returns 200 with beneficial owners', async () => {
    mockedService.listBeneficialOwners.mockResolvedValue([]);

    const req = mockReq({ params: { supplier_id: 'supp-1' } });
    const res = mockRes();

    await listUbosHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ beneficialOwners: [] });
  });

  it('calls next on error', async () => {
    mockedService.listBeneficialOwners.mockRejectedValue(new Error('fail'));

    const req = mockReq({ params: { supplier_id: 'supp-1' } });
    const res = mockRes();

    await listUbosHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// =========================================================================
// updateUboHandler
// =========================================================================
describe('updateUboHandler', () => {
  it('returns 200 on success', async () => {
    mockedService.updateBeneficialOwner.mockResolvedValue(undefined);

    const req = mockReq({
      params: { supplier_id: 'supp-1', ubo_id: 'ubo-1' },
      body: { full_name: 'Updated Owner' },
      user: { userId: 'user-1', role: 'supplier', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await updateUboHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockedService.updateBeneficialOwner).toHaveBeenCalledWith(
      'ubo-1',
      'supp-1',
      expect.anything(),
      'user-1',
      '127.0.0.1',
      'test-agent',
    );
  });

  it('calls next on error', async () => {
    mockedService.updateBeneficialOwner.mockRejectedValue(new Error('fail'));

    const req = mockReq({ params: { supplier_id: 'supp-1', ubo_id: 'ubo-1' }, body: {} });
    const res = mockRes();

    await updateUboHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('defaults userId to empty when user is undefined', async () => {
    mockedService.updateBeneficialOwner.mockResolvedValue(undefined);

    const req = mockReq({
      params: { supplier_id: 'supp-1', ubo_id: 'ubo-1' },
      body: {},
      user: undefined,
    });
    const res = mockRes();

    await updateUboHandler(req, res, next);

    expect(mockedService.updateBeneficialOwner).toHaveBeenCalledWith(
      'ubo-1',
      'supp-1',
      expect.anything(),
      '',
      expect.any(String),
      expect.any(String),
    );
  });

  it('defaults ip and ua to "unknown" when missing', async () => {
    mockedService.updateBeneficialOwner.mockResolvedValue(undefined);

    const req = mockReq({
      params: { supplier_id: 'supp-1', ubo_id: 'ubo-1' },
      body: {},
      ip: undefined,
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = mockRes();

    await updateUboHandler(req, res, next);

    expect(mockedService.updateBeneficialOwner).toHaveBeenCalledWith(
      'ubo-1',
      'supp-1',
      expect.anything(),
      expect.any(String),
      'unknown',
      'unknown',
    );
  });
});

// =========================================================================
// deleteUboHandler
// =========================================================================
describe('deleteUboHandler', () => {
  it('returns 200 on success', async () => {
    mockedService.removeBeneficialOwner.mockResolvedValue(undefined);

    const req = mockReq({
      params: { supplier_id: 'supp-1', ubo_id: 'ubo-1' },
      user: { userId: 'user-1', role: 'supplier', sessionId: 'sess-1' },
    });
    const res = mockRes();

    await deleteUboHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockedService.removeBeneficialOwner).toHaveBeenCalledWith(
      'ubo-1',
      'supp-1',
      'user-1',
      '127.0.0.1',
      'test-agent',
    );
  });

  it('calls next on error', async () => {
    mockedService.removeBeneficialOwner.mockRejectedValue(new Error('fail'));

    const req = mockReq({ params: { supplier_id: 'supp-1', ubo_id: 'ubo-1' } });
    const res = mockRes();

    await deleteUboHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('defaults userId to empty when user is undefined', async () => {
    mockedService.removeBeneficialOwner.mockResolvedValue(undefined);

    const req = mockReq({
      params: { supplier_id: 'supp-1', ubo_id: 'ubo-1' },
      user: undefined,
    });
    const res = mockRes();

    await deleteUboHandler(req, res, next);

    expect(mockedService.removeBeneficialOwner).toHaveBeenCalledWith(
      'ubo-1',
      'supp-1',
      '',
      expect.any(String),
      expect.any(String),
    );
  });

  it('defaults ip and ua to "unknown" when missing', async () => {
    mockedService.removeBeneficialOwner.mockResolvedValue(undefined);

    const req = mockReq({
      params: { supplier_id: 'supp-1', ubo_id: 'ubo-1' },
      ip: undefined,
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = mockRes();

    await deleteUboHandler(req, res, next);

    expect(mockedService.removeBeneficialOwner).toHaveBeenCalledWith(
      'ubo-1',
      'supp-1',
      expect.any(String),
      'unknown',
      'unknown',
    );
  });
});
