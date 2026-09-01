/**
 * legal-role.test.ts
 *
 * Verifies that the 'legal' role has read-only access to invoices, approvals,
 * payments, and reporting endpoints, and is blocked from all write operations.
 *
 * Uses real createRoleGuard (not mocked) so role enforcement is tested end-to-end
 * through actual Express middleware.
 */

// Set env vars before any imports
process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-tests';

import request from 'supertest';
import express from 'express';

// ---------------------------------------------------------------------------
// Mocks — infrastructure only; role middleware is real
// ---------------------------------------------------------------------------

jest.mock('../../../src/services/invoices/invoices.service');
jest.mock('../../../src/services/approvals/approvals.service');
jest.mock('../../../src/services/payments/payments.service');
jest.mock('../../../src/services/reporting/reporting.service');

// Mock auth.service session lookup. Re-export PASSWORD_REGEX because
// onboarding.routes imports it for the registration password Joi schema.
jest.mock('../../../src/services/auth/auth.service', () => ({
  getSession: jest.fn().mockResolvedValue({ userId: 'legal-user-1', role: 'legal' }),
  PASSWORD_REGEX: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{12,}$/,
}));

// Mock JWT to return a legal user payload
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({
    userId: 'legal-user-1',
    role: 'legal',
    sessionId: 'sess-legal-1',
    type: 'full',
  }),
  JsonWebTokenError: class JsonWebTokenError extends Error {},
  TokenExpiredError: class TokenExpiredError extends Error {},
}));

// Mock BullMQ to avoid Redis connections in tests
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn().mockReturnThis() })),
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), close: jest.fn() })),
}));

// Mock redis to avoid connection errors
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  })),
}));

// Mock pool for any direct DB queries in middleware
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue({ rows: [] }),
  rlsStore: {
    run: jest.fn((_ctx: unknown, callback: () => void) => callback()),
    getStore: jest.fn(() => undefined),
  },
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

// ---------------------------------------------------------------------------
// Build the Express app with all relevant routers
// ---------------------------------------------------------------------------

import { invoicesRouter } from '../../../src/services/invoices/invoices.routes';
import { approvalsRouter } from '../../../src/services/approvals/approvals.routes';
import { paymentsRouter } from '../../../src/services/payments/payments.routes';
import { reportingRouter } from '../../../src/services/reporting/reporting.routes';
import { onboardingRouter } from '../../../src/services/onboarding/onboarding.routes';
import * as invoiceService from '../../../src/services/invoices/invoices.service';
import * as approvalService from '../../../src/services/approvals/approvals.service';
import * as paymentService from '../../../src/services/payments/payments.service';
import * as reportingService from '../../../src/services/reporting/reporting.service';

const app = express();
app.use(express.json());
app.use('/invoices', invoicesRouter);
app.use('/approvals', approvalsRouter);
app.use('/payments', paymentsRouter);
app.use('/reporting', reportingRouter);
app.use('/', onboardingRouter);

const AUTH_HEADER = { Authorization: 'Bearer valid-legal-token' };
const VALID_UUID = '11111111-1111-1111-1111-111111111111';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Legal role — access control', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Legal user can login (JWT token is issued by auth module — we verify
  //    the role guard is correctly configured, i.e. legal token passes auth)
  // =========================================================================
  it('1. Legal user JWT is accepted by authenticateJwt middleware', async () => {
    (invoiceService.listInvoices as jest.Mock).mockResolvedValue({ data: [], total: 0 });

    const res = await request(app).get('/invoices').set(AUTH_HEADER);

    // Would be 401/403 if token was rejected; 200 means JWT + role guard both passed
    expect(res.status).toBe(200);
  });

  // =========================================================================
  // 2. Legal user can GET /invoices
  // =========================================================================
  it('2. Legal user can GET /invoices', async () => {
    (invoiceService.listInvoices as jest.Mock).mockResolvedValue({ data: [], total: 0 });

    const res = await request(app).get('/invoices').set(AUTH_HEADER);

    expect(res.status).toBe(200);
  });

  // =========================================================================
  // 3. Legal user can GET /invoices/:id
  // =========================================================================
  it('3. Legal user can GET /invoices/:id', async () => {
    (invoiceService.getInvoiceDetail as jest.Mock).mockResolvedValue({
      id: VALID_UUID,
      status: 'funded',
    });

    const res = await request(app).get(`/invoices/${VALID_UUID}`).set(AUTH_HEADER);

    expect(res.status).toBe(200);
  });

  // =========================================================================
  // 4. Legal user can GET /suppliers/:id (no role guard — ownership-only)
  // =========================================================================
  it('4. Legal user can GET /suppliers/:id (authenticated, ownership enforced in service)', async () => {
    // onboarding getSupplier is not mocked at module level — the endpoint has no
    // role guard (just authenticateJwt), so legal can reach it (ownership is enforced in service)
    jest.mock('../../../src/services/onboarding/onboarding.service', () => ({
      getSupplier: jest.fn().mockResolvedValue({ id: VALID_UUID }),
      uploadDocument: jest.fn(),
      listDocuments: jest.fn().mockResolvedValue([]),
      updateKycStatus: jest.fn(),
      listSuppliers: jest.fn().mockResolvedValue([]),
      createBuyer: jest.fn(),
      listBuyers: jest.fn().mockResolvedValue([]),
      getBuyer: jest.fn().mockResolvedValue({ id: VALID_UUID }),
      updateBuyer: jest.fn(),
      registerSupplier: jest.fn(),
    }));

    const res = await request(app).get(`/suppliers/${VALID_UUID}`).set(AUTH_HEADER);

    // 200 or service-level error — just confirm not a 403 role rejection
    expect(res.status).not.toBe(403);
  });

  // =========================================================================
  // 5. Legal user can GET /approvals (queue)
  // =========================================================================
  it('5. Legal user can GET /approvals/queue', async () => {
    (approvalService.getApprovalQueue as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get('/approvals/queue').set(AUTH_HEADER);

    expect(res.status).toBe(200);
  });

  // =========================================================================
  // 6. Legal user can GET /payments (pending)
  // =========================================================================
  it('6. Legal user can GET /payments/pending', async () => {
    (paymentService.getPendingPayments as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get('/payments/pending').set(AUTH_HEADER);

    expect(res.status).toBe(200);
  });

  // =========================================================================
  // 7. Legal user can GET /payments/:id
  // =========================================================================
  it('7. Legal user can GET /payments/:id', async () => {
    (paymentService.getPaymentDetails as jest.Mock).mockResolvedValue({
      id: VALID_UUID,
      status: 'funded',
    });

    const res = await request(app).get(`/payments/${VALID_UUID}`).set(AUTH_HEADER);

    expect(res.status).toBe(200);
  });

  // =========================================================================
  // 8. Legal user can GET /reporting/audit-export
  // =========================================================================
  it('8. Legal user can GET /reporting/audit-export', async () => {
    (reportingService.generateReport as jest.Mock).mockResolvedValue({
      type: 'audit-export',
      generatedAt: new Date().toISOString(),
      data: [],
    });

    const res = await request(app).get('/reporting/audit-export').set(AUTH_HEADER);

    expect(res.status).toBe(200);
  });

  // =========================================================================
  // 9. Legal user CANNOT POST /invoices/submit → 403
  // =========================================================================
  it('9. Legal user CANNOT POST /invoices/submit → 403', async () => {
    const res = await request(app).post('/invoices/submit').set(AUTH_HEADER).send({
      invoice_number: 'INV-001',
      buyer_id: VALID_UUID,
      face_value: 1000000,
      due_date: '2026-06-01',
      description: 'Test invoice',
    });

    expect(res.status).toBe(403);
  });

  // =========================================================================
  // 10. Legal user CANNOT POST /payments/:id/authorise → 403
  // =========================================================================
  it('10. Legal user CANNOT POST /payments/:id/authorise → 403', async () => {
    const res = await request(app)
      .post(`/payments/${VALID_UUID}/authorise`)
      .set(AUTH_HEADER)
      .send();

    expect(res.status).toBe(403);
  });

  // =========================================================================
  // 11. Legal user CANNOT POST /approvals/:id/approve → 403
  // =========================================================================
  it('11. Legal user CANNOT POST /approvals/:id/approve → 403', async () => {
    const res = await request(app)
      .post(`/approvals/${VALID_UUID}/approve`)
      .set(AUTH_HEADER)
      .send({ comments: 'This invoice is approved for payment processing now.' });

    expect(res.status).toBe(403);
  });

  // =========================================================================
  // 12. Legal user CANNOT PUT /suppliers/:id (kyc-status) → 403
  // =========================================================================
  it('12. Legal user CANNOT PUT /admin/suppliers/:id/kyc-status → 403', async () => {
    const res = await request(app)
      .put(`/admin/suppliers/${VALID_UUID}/kyc-status`)
      .set(AUTH_HEADER)
      .send({ status: 'approved', comments: 'KYC documents verified and approved by legal.' });

    expect(res.status).toBe(403);
  });

  // =========================================================================
  // 13. Audit log written when legal user accesses invoice
  //     The invoices.service.getInvoiceDetail writes the audit log internally.
  //     Here we verify the service was called (which contains the audit write).
  // =========================================================================
  it('13. Audit log is written when legal user accesses invoice (service is called)', async () => {
    const mockDetail = { id: VALID_UUID, status: 'funded', face_value: '5000000' };
    (invoiceService.getInvoiceDetail as jest.Mock).mockResolvedValue(mockDetail);

    await request(app).get(`/invoices/${VALID_UUID}`).set(AUTH_HEADER);

    // Service was invoked — audit log is the service's responsibility
    expect(invoiceService.getInvoiceDetail).toHaveBeenCalledWith(
      VALID_UUID,
      'legal-user-1',
      'legal',
    );
  });
});
