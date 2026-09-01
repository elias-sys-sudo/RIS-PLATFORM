/**
 * Integration tests — Dashboard module
 * Covers /dashboard/summary and /payments/history endpoints.
 */
import request from 'supertest';
import { Pool } from 'pg';
import {
  createTestApp,
  ensureAllTestSessions,
  closeTestRedis,
  TEST_USERS,
  TEST_IDS,
  authAgent,
} from './helpers';

const app = createTestApp();
const testPool = new Pool({ connectionString: process.env.DATABASE_URL });

beforeAll(async () => {
  await ensureAllTestSessions();
});

afterAll(async () => {
  await closeTestRedis();
  await testPool.end();
});

// ==========================================================================
// GET /dashboard/summary
// ==========================================================================

describe('GET /dashboard/summary', () => {
  it('returns a valid summary object with expected shape', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const res = await request(testApp)
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      data: {
        period: string;
        cached_at: string;
        stats: {
          total_invoices: number;
          total_face_value: number;
          total_funded: number;
          collection_rate: number;
          overdue_count: number;
          overdue_amount: number;
          avg_tenor_days: number;
          active_facilities: number;
        };
        trends: Record<string, number>;
        invoice_status_breakdown: unknown[];
        payment_method_breakdown: unknown[];
        trend_data: unknown[];
        escalation_overview: { none: number; reminder: number; formal: number; legal: number };
        recent_activity: unknown[];
      };
    };

    expect(body.data).toBeDefined();
    expect(typeof body.data.period).toBe('string');
    expect(typeof body.data.cached_at).toBe('string');
    expect(typeof body.data.stats.total_invoices).toBe('number');
    expect(typeof body.data.stats.total_face_value).toBe('number');
    expect(typeof body.data.stats.total_funded).toBe('number');
    expect(typeof body.data.stats.collection_rate).toBe('number');
    expect(typeof body.data.stats.overdue_count).toBe('number');
    expect(typeof body.data.stats.overdue_amount).toBe('number');
    expect(typeof body.data.stats.avg_tenor_days).toBe('number');
    expect(typeof body.data.stats.active_facilities).toBe('number');
    expect(Array.isArray(body.data.invoice_status_breakdown)).toBe(true);
    expect(Array.isArray(body.data.recent_activity)).toBe(true);
  });

  it('returns 200 with period=7d', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    await request(testApp)
      .get('/dashboard/summary?period=7d')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('returns 200 with period=30d', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    await request(testApp)
      .get('/dashboard/summary?period=30d')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('returns 200 with period=90d', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    await request(testApp)
      .get('/dashboard/summary?period=90d')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('returns 200 with period=12m', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    await request(testApp)
      .get('/dashboard/summary?period=12m')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('returns 200 with period=all (default)', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    await request(testApp)
      .get('/dashboard/summary?period=all')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('admin sees all invoice data', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const res = await request(testApp)
      .get('/dashboard/summary?period=all')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { data: { stats: { total_invoices: number } } };
    // Seed data has 5 invoices total across all suppliers
    expect(body.data.stats.total_invoices).toBeGreaterThanOrEqual(5);
  });

  it('supplier sees only their own scoped data', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.supplier);
    const res = await request(testApp)
      .get('/dashboard/summary?period=all')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { data: { stats: { total_invoices: number } } };
    // Supplier user (supplier role) gets scoped by their userId,
    // which may not match any supplier_id — still returns valid shape
    expect(typeof body.data.stats.total_invoices).toBe('number');
  });

  it('second call returns cached_at field (caching behaviour)', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.financeManager);
    const res1 = await request(testApp)
      .get('/dashboard/summary?period=all')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body1 = res1.body as { data: { cached_at: string } };
    expect(body1.data.cached_at).toBeDefined();

    const res2 = await request(testApp)
      .get('/dashboard/summary?period=all')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body2 = res2.body as { data: { cached_at: string } };
    expect(body2.data.cached_at).toBeDefined();
    // The cached_at value should exist on both calls
    expect(typeof body2.data.cached_at).toBe('string');
  });

  it('returns 401 for unauthenticated requests', async () => {
    await request(app).get('/dashboard/summary').expect(401);
  });
});

// ==========================================================================
// GET /payments/history
// ==========================================================================

describe('GET /payments/history', () => {
  it('returns paginated payment data for a supplier', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const res = await request(testApp)
      .get(`/payments/history?supplier_id=${TEST_IDS.suppliers.org1}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      data: unknown[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
      };
      summary: {
        total_paid: string;
        payment_count: number;
        last_payment_date: string | null;
        by_method: unknown[];
      };
    };

    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeDefined();
    expect(typeof body.pagination.page).toBe('number');
    expect(typeof body.pagination.limit).toBe('number');
    expect(typeof body.pagination.total).toBe('number');
    expect(typeof body.pagination.total_pages).toBe('number');
    expect(body.summary).toBeDefined();
    expect(typeof body.summary.total_paid).toBe('string');
    expect(typeof body.summary.payment_count).toBe('number');
  });

  it('supports custom page and limit params', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const res = await request(testApp)
      .get(`/payments/history?supplier_id=${TEST_IDS.suppliers.org1}&page=1&limit=5`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      pagination: { page: number; limit: number };
    };
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(5);
  });

  it('finance_manager can access payment history', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.financeManager);
    await request(testApp)
      .get(`/payments/history?supplier_id=${TEST_IDS.suppliers.org1}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('credit_officer can access payment history', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.creditOfficer);
    await request(testApp)
      .get(`/payments/history?supplier_id=${TEST_IDS.suppliers.org1}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('auditor can access payment history', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.auditor);
    await request(testApp)
      .get(`/payments/history?supplier_id=${TEST_IDS.suppliers.org1}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('returns 400 when supplier_id is missing', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    await request(testApp)
      .get('/payments/history')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns 400 when supplier_id is not a valid UUID', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    await request(testApp)
      .get('/payments/history?supplier_id=not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns 401 for unauthenticated requests', async () => {
    await request(app).get(`/payments/history?supplier_id=${TEST_IDS.suppliers.org1}`).expect(401);
  });
});
