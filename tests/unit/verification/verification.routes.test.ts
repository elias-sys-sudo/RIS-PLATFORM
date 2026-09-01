process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long-for-jwt';
process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { verificationRouter } from '../../../src/services/verification/verification.routes';
import { globalErrorHandler } from '../../../src/shared/middleware/error-handler';
import { AuthError } from '../../../src/shared/errors/auth.error';

// Mock the auth middleware
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

// Mock the service layer
jest.mock('../../../src/services/verification/verification.service', () => ({
  getConfirmationPageData: jest.fn().mockResolvedValue({
    invoice_number: 'INV-001',
    supplier_name: 'Test Supplier',
    face_value: 50000000,
    due_date: '2026-05-01',
    description: 'Test goods',
    ris_bank_details: 'RIS bank details',
  }),
  confirmInvoice: jest.fn().mockResolvedValue({ invoiceId: 'inv-1' }),
  resendConfirmation: jest.fn().mockResolvedValue(undefined),
  listPendingConfirmations: jest.fn().mockResolvedValue({
    data: [],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  }),
  setNotificationQueue: jest.fn(),
  setRiskScoringQueue: jest.fn(),
}));

jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));

// Build test app
const app = express();
app.use(express.json());
app.use('/verify', verificationRouter);
app.use(globalErrorHandler);

// Helpers
const VALID_TOKEN = 'a'.repeat(64);
const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function makeJwt(role: string, userId = 'user-1'): string {
  return jwt.sign(
    { userId, role, sessionId: 'sess-1', type: 'full' },
    process.env.JWT_SECRET ?? '',
    { expiresIn: '15m' },
  );
}

describe('verification routes', () => {
  // =========================================================================
  // Public routes — no auth required
  // =========================================================================
  describe('GET /verify/:token', () => {
    it('returns 200 for valid 64-char hex token', async () => {
      const res = await request(app).get(`/verify/${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect((res.body as { invoice_number: string }).invoice_number).toBe('INV-001');
    });

    it('returns 400 for token shorter than 64 chars', async () => {
      const res = await request(app).get('/verify/tooshort');

      expect(res.status).toBe(400);
    });

    it('returns 400 for non-hex token', async () => {
      const nonHex = 'g'.repeat(64);
      const res = await request(app).get(`/verify/${nonHex}`);

      expect(res.status).toBe(400);
    });

    it('does not require JWT auth', async () => {
      const res = await request(app).get(`/verify/${VALID_TOKEN}`);

      expect(res.status).toBe(200);
    });
  });

  describe('POST /verify/:token/confirm', () => {
    it('returns 200 with valid token and all true confirmations', async () => {
      const res = await request(app).post(`/verify/${VALID_TOKEN}/confirm`).send({
        invoice_is_valid: true,
        amount_is_correct: true,
        due_date_is_correct: true,
        agrees_to_pay_ris: true,
      });

      expect(res.status).toBe(200);
      expect((res.body as { invoiceId: string }).invoiceId).toBe('inv-1');
    });

    it('returns 400 when a confirmation field is false', async () => {
      const res = await request(app).post(`/verify/${VALID_TOKEN}/confirm`).send({
        invoice_is_valid: false,
        amount_is_correct: true,
        due_date_is_correct: true,
        agrees_to_pay_ris: true,
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when a confirmation field is missing', async () => {
      const res = await request(app).post(`/verify/${VALID_TOKEN}/confirm`).send({
        invoice_is_valid: true,
        amount_is_correct: true,
        due_date_is_correct: true,
      });

      expect(res.status).toBe(400);
    });

    it('does not require JWT auth', async () => {
      const res = await request(app).post(`/verify/${VALID_TOKEN}/confirm`).send({
        invoice_is_valid: true,
        amount_is_correct: true,
        due_date_is_correct: true,
        agrees_to_pay_ris: true,
      });

      expect(res.status).toBe(200);
    });
  });

  // =========================================================================
  // Admin routes — JWT + role required
  // =========================================================================
  describe('POST /verify/admin/invoices/:id/resend-confirmation', () => {
    it('returns 200 for credit_officer', async () => {
      const token = makeJwt('credit_officer');
      const res = await request(app)
        .post(`/verify/admin/invoices/${VALID_UUID}/resend-confirmation`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect((res.body as { message: string }).message).toBe('Confirmation email resent');
    });

    it('returns 401 without JWT', async () => {
      const res = await request(app).post(
        `/verify/admin/invoices/${VALID_UUID}/resend-confirmation`,
      );

      expect(res.status).toBe(401);
    });

    it('returns 403 for supplier role', async () => {
      const token = makeJwt('supplier');
      const res = await request(app)
        .post(`/verify/admin/invoices/${VALID_UUID}/resend-confirmation`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('returns 403 for finance_manager role', async () => {
      const token = makeJwt('finance_manager');
      const res = await request(app)
        .post(`/verify/admin/invoices/${VALID_UUID}/resend-confirmation`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('returns 400 for non-UUID id param', async () => {
      const token = makeJwt('credit_officer');
      const res = await request(app)
        .post('/verify/admin/invoices/not-a-uuid/resend-confirmation')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /verify/admin/invoices/pending-confirmation', () => {
    it('returns 200 for credit_officer', async () => {
      const token = makeJwt('credit_officer');
      const res = await request(app)
        .get('/verify/admin/invoices/pending-confirmation')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect((res.body as { data: unknown[] }).data).toEqual([]);
    });

    it('returns 401 without JWT', async () => {
      const res = await request(app).get('/verify/admin/invoices/pending-confirmation');

      expect(res.status).toBe(401);
    });

    it('returns 403 for supplier role', async () => {
      const token = makeJwt('supplier');
      const res = await request(app)
        .get('/verify/admin/invoices/pending-confirmation')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('returns 403 for management role', async () => {
      const token = makeJwt('management');
      const res = await request(app)
        .get('/verify/admin/invoices/pending-confirmation')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // Route ordering — admin routes must not be caught by :token wildcard
  // =========================================================================
  describe('route ordering', () => {
    it('admin route is not intercepted by :token wildcard', async () => {
      const token = makeJwt('credit_officer');
      const res = await request(app)
        .get('/verify/admin/invoices/pending-confirmation')
        .set('Authorization', `Bearer ${token}`);

      // If admin was caught by /:token, it would return 400 (not 64 hex chars)
      expect(res.status).toBe(200);
    });
  });
});
