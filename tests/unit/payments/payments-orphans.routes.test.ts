process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-tests';

import request from 'supertest';
import express from 'express';
import { orphansRouter } from '../../../src/services/payments/payments-orphans.routes';
import { globalErrorHandler } from '../../../src/shared/middleware/error-handler';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/payments/payments-orphans.service');

jest.mock('../../../src/services/auth/auth.service', () => ({
  getSession: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'management' }),
}));

// Mutable JWT payload — each test can override the role before calling.
const jwtPayload = {
  userId: 'user-1',
  role: 'management',
  sessionId: 'sess-1',
  type: 'full' as const,
};

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(() => jwtPayload),
  JsonWebTokenError: class JsonWebTokenError extends Error {},
  TokenExpiredError: class TokenExpiredError extends Error {},
}));

const app = express();
app.use(express.json());
app.use('/admin/approvals', orphansRouter);
app.use(globalErrorHandler);

const MOCK_ROWS = [
  {
    invoice_id: '11111111-1111-1111-1111-111111111111',
    supplier_id: '22222222-2222-2222-2222-222222222222',
    face_value: '5000000',
    approved_at: '2026-05-20T10:00:00.000Z',
    age_hours: 1.5,
  },
  {
    invoice_id: '33333333-3333-3333-3333-333333333333',
    supplier_id: '44444444-4444-4444-4444-444444444444',
    face_value: '7500000',
    approved_at: '2026-05-20T09:00:00.000Z',
    age_hours: 2.5,
  },
];

const EXPECTED_KEYS = ['invoiceId', 'supplierId', 'faceValue', 'approvedAt', 'ageHours'].sort();

interface OrphanResponse {
  invoiceId: string;
  supplierId: string;
  faceValue: string;
  approvedAt: string;
  ageHours: number;
}

interface OrphansBody {
  orphans: OrphanResponse[];
  count: number;
}

beforeEach(() => {
  jest.clearAllMocks();
  jwtPayload.role = 'management';
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GET /admin/approvals/orphans', () => {
  it('returns 200 with mocked rows when role=management', async () => {
    const service = await import('../../../src/services/payments/payments-orphans.service');
    (service.listOrphanedApprovedInvoices as jest.Mock).mockResolvedValue(MOCK_ROWS);
    jwtPayload.role = 'management';

    const res = await request(app)
      .get('/admin/approvals/orphans')
      .set('Authorization', 'Bearer valid-token');
    const body = res.body as OrphansBody;

    expect(res.status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.orphans).toHaveLength(2);
    expect(service.listOrphanedApprovedInvoices).toHaveBeenCalledTimes(1);
  });

  it('returns 200 with mocked rows when role=finance_manager', async () => {
    const service = await import('../../../src/services/payments/payments-orphans.service');
    (service.listOrphanedApprovedInvoices as jest.Mock).mockResolvedValue(MOCK_ROWS);
    jwtPayload.role = 'finance_manager';

    const res = await request(app)
      .get('/admin/approvals/orphans')
      .set('Authorization', 'Bearer valid-token');
    const body = res.body as OrphansBody;

    expect(res.status).toBe(200);
    expect(body.count).toBe(2);
    expect(service.listOrphanedApprovedInvoices).toHaveBeenCalledTimes(1);
  });

  it('returns 403 when role=supplier', async () => {
    const service = await import('../../../src/services/payments/payments-orphans.service');
    jwtPayload.role = 'supplier';

    const res = await request(app)
      .get('/admin/approvals/orphans')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
    expect(service.listOrphanedApprovedInvoices).not.toHaveBeenCalled();
  });

  it('returns 401 when no JWT is supplied', async () => {
    const service = await import('../../../src/services/payments/payments-orphans.service');

    const res = await request(app).get('/admin/approvals/orphans');

    expect(res.status).toBe(401);
    expect(service.listOrphanedApprovedInvoices).not.toHaveBeenCalled();
  });

  it('response body has EXACTLY { orphans, count } and each orphan has only camelCase non-PII keys', async () => {
    const service = await import('../../../src/services/payments/payments-orphans.service');
    (service.listOrphanedApprovedInvoices as jest.Mock).mockResolvedValue(MOCK_ROWS);
    jwtPayload.role = 'management';

    const res = await request(app)
      .get('/admin/approvals/orphans')
      .set('Authorization', 'Bearer valid-token');
    const body = res.body as OrphansBody;

    expect(res.status).toBe(200);

    // Top-level keys exact
    expect(Object.keys(body).sort()).toEqual(['count', 'orphans']);
    expect(body.count).toBe(2);

    // Each orphan exposes exactly the camelCase shape — no PII fields.
    for (const orphan of body.orphans) {
      expect(Object.keys(orphan).sort()).toEqual(EXPECTED_KEYS);
      expect(typeof orphan.invoiceId).toBe('string');
      expect(typeof orphan.supplierId).toBe('string');
      expect(typeof orphan.faceValue).toBe('string');
      expect(typeof orphan.approvedAt).toBe('string');
      expect(typeof orphan.ageHours).toBe('number');
    }

    // First-row mapping correctness (snake → camel conversion)
    expect(body.orphans[0]).toEqual({
      invoiceId: MOCK_ROWS[0].invoice_id,
      supplierId: MOCK_ROWS[0].supplier_id,
      faceValue: MOCK_ROWS[0].face_value,
      approvedAt: MOCK_ROWS[0].approved_at,
      ageHours: MOCK_ROWS[0].age_hours,
    });
  });

  it('calls the service exactly once per request', async () => {
    const service = await import('../../../src/services/payments/payments-orphans.service');
    (service.listOrphanedApprovedInvoices as jest.Mock).mockResolvedValue([]);
    jwtPayload.role = 'management';

    await request(app).get('/admin/approvals/orphans').set('Authorization', 'Bearer valid-token');

    expect(service.listOrphanedApprovedInvoices).toHaveBeenCalledTimes(1);
  });
});
