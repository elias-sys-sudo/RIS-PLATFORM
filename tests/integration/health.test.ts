/**
 * Smoke test — validates the integration test infrastructure works:
 * DB created, migrations ran, seed data present, Express app serves requests.
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

describe('Integration infrastructure smoke test', () => {
  it('connects to the test database', async () => {
    const result = await testPool.query<{ ok: number }>('SELECT 1 AS ok');
    expect(result.rows[0].ok).toBe(1);
  });

  it('seed data: users exist', async () => {
    const result = await testPool.query<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM users');
    expect(result.rows[0].cnt).toBeGreaterThanOrEqual(7);
  });

  it('seed data: invoices exist in expected statuses', async () => {
    const result = await testPool.query<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*)::int AS cnt FROM invoices GROUP BY status ORDER BY status`,
    );
    const statusMap = new Map(result.rows.map((r) => [r.status, r.cnt]));
    expect(statusMap.get('draft')).toBeGreaterThanOrEqual(1);
    expect(statusMap.get('funded')).toBeGreaterThanOrEqual(1);
    expect(statusMap.get('overdue')).toBeGreaterThanOrEqual(1);
  });

  it('seed data: risk_config entries exist', async () => {
    const result = await testPool.query<{ cnt: number }>(
      'SELECT COUNT(*)::int AS cnt FROM risk_config',
    );
    expect(result.rows[0].cnt).toBeGreaterThanOrEqual(14);
  });

  it('GET /health returns 200 with database connected', async () => {
    const res = await request(app).get('/health').expect(200);
    const body = res.body as { status: string; database: string };
    expect(body.status).toBe('ok');
    expect(body.database).toBe('connected');
  });

  it('GET /ready returns 200 with both database and redis connected', async () => {
    const res = await request(app).get('/ready').expect(200);
    const body = res.body as {
      ready: boolean;
      checks: { database: string; redis: string };
      timestamp: string;
    };
    expect(body.ready).toBe(true);
    expect(body.checks.database).toBe('connected');
    expect(body.checks.redis).toBe('connected');
    expect(typeof body.timestamp).toBe('string');
  });

  it('unauthenticated request to protected endpoint returns 401', async () => {
    await request(app).get('/collateral').expect(401);
  });

  it('authenticated request with valid JWT reaches the handler', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const res = await request(testApp)
      .get(`/collateral?invoice_id=${TEST_IDS.invoices.funded}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});
