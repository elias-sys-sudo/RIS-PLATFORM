/**
 * Integration tests for security middleware: auth, role guard, XSS sanitisation,
 * security headers, validation.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
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

describe('Auth middleware', () => {
  it('returns 401 with AUTH_ERROR when no Authorization header is sent', async () => {
    const res = await request(app)
      .get('/collateral')
      .query({ invoice_id: TEST_IDS.invoices.funded })
      .expect(401);

    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('AUTH_ERROR');
  });

  it('returns 401 for malformed JWT (random string)', async () => {
    const res = await request(app)
      .get('/collateral')
      .query({ invoice_id: TEST_IDS.invoices.funded })
      .set('Authorization', 'Bearer this-is-not-a-valid-jwt')
      .expect(401);

    const body = res.body as { error: string };
    expect(body.error).toBe('AUTH_ERROR');
  });

  it('returns 401 for expired JWT', async () => {
    const secret = process.env.JWT_SECRET;
    if (secret === undefined || secret === '') {
      throw new Error('JWT_SECRET not set');
    }

    const expiredToken = jwt.sign(
      {
        userId: TEST_USERS.admin.userId,
        role: TEST_USERS.admin.role,
        sessionId: `test-session-${TEST_USERS.admin.userId}`,
        type: 'full',
      },
      secret,
      { algorithm: 'HS256', expiresIn: '-1h' },
    );

    const res = await request(app)
      .get('/collateral')
      .query({ invoice_id: TEST_IDS.invoices.funded })
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);

    const body = res.body as { error: string };
    expect(body.error).toBe('AUTH_ERROR');
  });

  it('returns 401 for JWT with type=partial_auth (requires full auth)', async () => {
    const secret = process.env.JWT_SECRET;
    if (secret === undefined || secret === '') {
      throw new Error('JWT_SECRET not set');
    }

    const partialToken = jwt.sign(
      {
        userId: TEST_USERS.admin.userId,
        role: TEST_USERS.admin.role,
        sessionId: `test-session-${TEST_USERS.admin.userId}`,
        type: 'partial_auth',
      },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' },
    );

    const res = await request(app)
      .get('/collateral')
      .query({ invoice_id: TEST_IDS.invoices.funded })
      .set('Authorization', `Bearer ${partialToken}`)
      .expect(401);

    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('AUTH_ERROR');
    expect(body.message).toContain('Full authentication required');
  });
});

describe('Role guard middleware', () => {
  it('returns 200 for valid JWT with correct role', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    const res = await request(testApp)
      .get('/collateral')
      .query({ invoice_id: TEST_IDS.invoices.funded })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns 403 for valid JWT with insufficient role (supplier accessing /reports/portfolio)', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.supplier);

    const res = await request(testApp)
      .get('/reports/portfolio')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const body = res.body as { error: string };
    expect(body.error).toBe('FORBIDDEN');
  });
});

describe('XSS sanitisation middleware', () => {
  it('sanitises script tags from request body', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    const res = await request(testApp)
      .post('/collateral')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_id: TEST_IDS.invoices.funded,
        type: 'bank_guarantee',
        description: '<script>alert(1)</script>Safe description',
        estimated_value: 50000000,
        currency: 'UGX',
      })
      .expect(201);

    const body = res.body as { data: { description: string } };
    // The script tag should be removed by XSS middleware
    expect(body.data.description).not.toContain('<script>');
    expect(body.data.description).toContain('Safe description');
  });
});

describe('Security headers', () => {
  it('includes X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('includes X-Frame-Options: DENY', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});

describe('Health endpoint', () => {
  it('GET /health returns 200 with no auth required', async () => {
    const res = await request(app).get('/health').expect(200);

    const body = res.body as { status: string; database: string };
    expect(body.status).toBe('ok');
    expect(body.database).toBe('connected');
  });
});

describe('Validation middleware', () => {
  it('returns 400 with VALIDATION_ERROR when email is missing from login', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ password: 'TestPassword123!' })
      .expect(400);

    const body = res.body as {
      error: string;
      message: string;
      fields: Array<{ field: string; message: string }>;
    };
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.fields).toBeDefined();
    expect(body.fields.length).toBeGreaterThan(0);
  });
});
