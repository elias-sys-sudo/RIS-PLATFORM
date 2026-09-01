process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long-for-jwt';
process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { onboardingRouter } from '../../../src/services/onboarding/onboarding.routes';
import { globalErrorHandler } from '../../../src/shared/middleware/error-handler';
import { AuthError } from '../../../src/shared/errors/auth.error';

// Mock the auth middleware to inject req.user
jest.mock('../../../src/shared/middleware/auth.middleware', () => ({
  authenticateJwt: jest.fn(
    /* eslint-disable @typescript-eslint/require-await */
    async (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ): Promise<void> => {
      /* eslint-enable @typescript-eslint/require-await */
      const authHeader = req.headers.authorization;
      if (authHeader === undefined || authHeader === null || authHeader === '') {
        next(new AuthError('Authentication required'));
        return;
      }
      const token = authHeader.replace('Bearer ', '');
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET ?? '') as {
          userId: string;
          role: string;
          sessionId: string;
        };
        req.user = {
          userId: decoded.userId,
          role: decoded.role,
          sessionId: decoded.sessionId,
        };
        next();
      } catch {
        next(new AuthError('Authentication required'));
      }
    },
  ),
}));

// Mock the service layer — we're testing route/middleware wiring, not business logic
jest.mock('../../../src/services/onboarding/onboarding.service', () => ({
  updateKycStatus: jest.fn().mockResolvedValue(undefined),
  listSuppliersForStaff: jest.fn().mockResolvedValue({
    data: [],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  }),
  createBuyer: jest.fn().mockResolvedValue({ buyerId: 'buyer-123' }),
  listBuyersForStaff: jest.fn().mockResolvedValue({
    data: [],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  }),
  getBuyerProfile: jest.fn().mockResolvedValue({
    id: 'buyer-123',
    company_name: 'Test',
  }),
  updateBuyerProfile: jest.fn().mockResolvedValue(undefined),
  registerSupplier: jest.fn().mockResolvedValue({
    userId: 'user-1',
    supplierId: 'supp-1',
  }),
  getSupplierProfile: jest.fn().mockResolvedValue({
    id: 'supp-1',
    company_name: 'Test',
  }),
  uploadDocument: jest.fn().mockResolvedValue({ documentId: 'doc-1' }),
  listDocuments: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../src/shared/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), audit: jest.fn() },
}));

// Build test app
const app = express();
app.use(express.json());
app.use('/onboarding', onboardingRouter);
app.use(globalErrorHandler);

function makeToken(role: string, userId = 'user-1'): string {
  return jwt.sign({ userId, role, sessionId: 'session-1' }, process.env.JWT_SECRET ?? '', {
    expiresIn: '15m',
  });
}

describe('Role-based access control on onboarding routes', () => {
  it('17. supplier cannot update KYC status — returns 403', async () => {
    const token = makeToken('supplier');

    const res = await request(app)
      .put('/onboarding/admin/suppliers/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/kyc-status')
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: 'under_review',
        comments: 'This should be blocked by role guard',
      });

    expect(res.status).toBe(403);
  });

  it('credit_officer can update KYC status', async () => {
    const token = makeToken('credit_officer');

    const res = await request(app)
      .put('/onboarding/admin/suppliers/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/kyc-status')
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: 'under_review',
        comments: 'This should be allowed for credit officer role',
      });

    expect(res.status).toBe(200);
  });

  it('compliance_officer can update KYC status', async () => {
    const token = makeToken('compliance_officer');

    const res = await request(app)
      .put('/onboarding/admin/suppliers/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/kyc-status')
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: 'under_review',
        comments: 'Compliance officer reviewing status change',
      });

    expect(res.status).toBe(200);
  });

  it('23. supplier cannot create buyer — returns 403', async () => {
    const token = makeToken('supplier');

    const res = await request(app)
      .post('/onboarding/admin/buyers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        company_name: 'Test Buyer',
        registration_number: 'REG-001',
        credit_rating: 'A',
        approved_limit: 100000000,
        payment_score: 85,
        contact_email: 'buyer@test.com',
        contact_phone: '256700000001',
      });

    expect(res.status).toBe(403);
  });

  it('management cannot create buyer — returns 403', async () => {
    const token = makeToken('management');

    const res = await request(app)
      .post('/onboarding/admin/buyers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        company_name: 'Test Buyer',
        registration_number: 'REG-002',
        credit_rating: 'B',
        approved_limit: 50000000,
        payment_score: 70,
        contact_email: 'buyer2@test.com',
        contact_phone: '256700000002',
      });

    expect(res.status).toBe(403);
  });

  it('credit_officer can create buyer', async () => {
    const token = makeToken('credit_officer');

    const res = await request(app)
      .post('/onboarding/admin/buyers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        company_name: 'Test Buyer',
        registration_number: 'REG-001',
        credit_rating: 'A',
        approved_limit: 100000000,
        payment_score: 85,
        contact_email: 'buyer@test.com',
        contact_phone: '256700000001',
      });

    expect(res.status).toBe(201);
  });

  it('supplier cannot list all suppliers — returns 403', async () => {
    const token = makeToken('supplier');

    const res = await request(app)
      .get('/onboarding/admin/suppliers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('management can list suppliers', async () => {
    const token = makeToken('management');

    const res = await request(app)
      .get('/onboarding/admin/suppliers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('supplier cannot list buyers — returns 403', async () => {
    const token = makeToken('supplier');

    const res = await request(app)
      .get('/onboarding/admin/buyers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('unauthenticated request to admin route returns 401', async () => {
    const res = await request(app).get('/onboarding/admin/suppliers');

    expect(res.status).toBe(401);
  });
});
