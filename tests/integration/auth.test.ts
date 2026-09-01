/**
 * Integration tests for auth endpoints.
 * Covers login, forgot-password, change-password, logout, supplier buyers.
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

describe('POST /auth/login', () => {
  it('returns 200 with accessToken for valid credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@mmstest.ug', password: 'TestPassword123!' })
      .expect(200);

    const body = res.body as {
      accessToken: string;
      tokenType: string;
      expiresIn: string;
      requiresTwoFactor: boolean;
    };
    expect(body.accessToken).toBeDefined();
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(0);
    expect(body.tokenType).toBe('full');
    expect(body.requiresTwoFactor).toBe(false);
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@mmstest.ug', password: 'WrongPassword1!' })
      .expect(401);

    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('AUTH_ERROR');
  });

  it('returns 401 for non-existent email', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nonexistent@mmstest.ug', password: 'TestPassword123!' })
      .expect(401);

    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('AUTH_ERROR');
  });
});

describe('POST /auth/forgot-password', () => {
  it('returns 200 for valid email (no information leakage)', async () => {
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'admin@mmstest.ug' })
      .expect(200);

    const body = res.body as { message: string };
    expect(body.message).toContain('If an account exists');
  });

  it('returns 200 for non-existent email (same response, no leakage)', async () => {
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'nobody@mmstest.ug' })
      .expect(200);

    const body = res.body as { message: string };
    expect(body.message).toContain('If an account exists');
  });
});

describe('PUT /auth/change-password', () => {
  it('requires authentication — returns 401 without token', async () => {
    const res = await request(app)
      .put('/auth/change-password')
      .send({
        current_password: 'TestPassword123!',
        new_password: 'NewSecurePass1!',
        confirm_password: 'NewSecurePass1!',
      })
      .expect(401);

    const body = res.body as { error: string };
    expect(body.error).toBe('AUTH_ERROR');
  });

  it('changes password for authenticated user', async () => {
    // Use the credit officer for this test so we don't break admin login
    const { token, app: testApp } = authAgent(TEST_USERS.creditOfficer);

    const res = await request(testApp)
      .put('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        current_password: 'TestPassword123!',
        new_password: 'NewSecurePass1!',
        confirm_password: 'NewSecurePass1!',
      })
      .expect(200);

    const body = res.body as { message: string };
    expect(body.message).toBe('Password changed successfully');

    // Restore the original password so other tests are not affected
    const { token: token2, app: testApp2 } = authAgent(TEST_USERS.creditOfficer);
    await request(testApp2)
      .put('/auth/change-password')
      .set('Authorization', `Bearer ${token2}`)
      .send({
        current_password: 'NewSecurePass1!',
        new_password: 'TestPassword123!',
        confirm_password: 'TestPassword123!',
      })
      .expect(200);
  });
});

describe('GET /auth/suppliers/:supplier_id/buyers', () => {
  it('returns 200 with buyer list for admin user', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    const res = await request(testApp)
      .get(`/auth/suppliers/${TEST_IDS.suppliers.org1}/buyers`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      data: unknown[];
      pagination: { page: number; limit: number; total: number };
    };
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeDefined();
  });
});

describe('POST /auth/logout', () => {
  it('returns 200 for authenticated user', async () => {
    // Login first to create a real session
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: 'auditor@mmstest.ug', password: 'TestPassword123!' })
      .expect(200);

    const loginBody = loginRes.body as { accessToken: string };

    const res = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${loginBody.accessToken}`)
      .expect(200);

    const body = res.body as { message: string };
    expect(body.message).toBe('Logged out');
  });
});

// =========================================================================
// Additional coverage tests
// =========================================================================

describe('POST /auth/login — response shape and lockout', () => {
  afterAll(async () => {
    // Always reset lockout state for admin user
    await testPool.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE email = 'admin@mmstest.ug'`,
    );
  });

  it('returns accessToken, tokenType, expiresIn, requiresTwoFactor in response', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@mmstest.ug', password: 'TestPassword123!' })
      .expect(200);

    const body = res.body as {
      accessToken: string;
      tokenType: string;
      expiresIn: string;
      requiresTwoFactor: boolean;
    };
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(10);
    expect(body.tokenType).toBe('full');
    expect(typeof body.expiresIn).toBe('string');
    expect(body.requiresTwoFactor).toBe(false);
  });

  it('sets a refreshToken cookie on successful login', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@mmstest.ug', password: 'TestPassword123!' })
      .expect(200);

    const rawCookie = res.headers['set-cookie'] as unknown;
    const setCookieHeaders = Array.isArray(rawCookie)
      ? (rawCookie as string[])
      : typeof rawCookie === 'string'
        ? [rawCookie]
        : [];
    expect(setCookieHeaders.length).toBeGreaterThan(0);
    const refreshCookie = setCookieHeaders.find((c: string) => c.startsWith('ris_refresh_token='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toContain('HttpOnly');
  });

  it('locks account after 5 failed attempts and rejects correct password', async () => {
    // Reset failed count first
    await testPool.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE email = 'admin@mmstest.ug'`,
    );

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/auth/login')
        .send({ email: 'admin@mmstest.ug', password: `WrongPass${String(i)}!` })
        .expect(401);
    }

    // Now even correct password should fail with lockout
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@mmstest.ug', password: 'TestPassword123!' })
      .expect(401);

    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('AUTH_ERROR');
    expect(body.message).toContain('locked');
  });

  it('returns 400 for missing email field', async () => {
    await request(app).post('/auth/login').send({ password: 'TestPassword123!' }).expect(400);
  });

  it('returns 400 for missing password field', async () => {
    await request(app).post('/auth/login').send({ email: 'admin@mmstest.ug' }).expect(400);
  });

  it('returns 400 for invalid email format', async () => {
    await request(app)
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'TestPassword123!' })
      .expect(400);
  });
});

describe('POST /auth/reset-password — validation branches', () => {
  it('returns 400 for invalid/missing token format', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({
        token: 'not-a-hex-token',
        new_password: 'NewSecure123!',
        confirm_password: 'NewSecure123!',
      })
      .expect(400);

    const body = res.body as { error: string };
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for password mismatch', async () => {
    // 64-char hex token to pass Joi hex().length(64) validation
    const fakeToken = 'a'.repeat(64);
    const res = await request(app)
      .post('/auth/reset-password')
      .send({
        token: fakeToken,
        new_password: 'NewSecure123!',
        confirm_password: 'DifferentPass1!',
      })
      .expect(400);

    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 401 for valid-format but non-existent token', async () => {
    const fakeToken = 'ab'.repeat(32);
    const res = await request(app)
      .post('/auth/reset-password')
      .send({
        token: fakeToken,
        new_password: 'NewSecure123!',
        confirm_password: 'NewSecure123!',
      })
      .expect(401);

    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('AUTH_ERROR');
    expect(body.message).toContain('Invalid or expired');
  });

  it('returns 400 when new_password does not meet policy', async () => {
    const fakeToken = 'ab'.repeat(32);
    const res = await request(app)
      .post('/auth/reset-password')
      .send({
        token: fakeToken,
        new_password: 'weakpass',
        confirm_password: 'weakpass',
      })
      .expect(400);

    const body = res.body as { error: string };
    expect(body.error).toBe('VALIDATION_ERROR');
  });
});

describe('PUT /auth/change-password — error branches', () => {
  it('returns 401 for wrong current password', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    const res = await request(testApp)
      .put('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        current_password: 'WrongCurrent1!',
        new_password: 'BrandNewPass1!',
        confirm_password: 'BrandNewPass1!',
      })
      .expect(401);

    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('AUTH_ERROR');
    expect(body.message).toContain('incorrect');
  });

  it('returns 400 when new password matches current password', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    const res = await request(testApp)
      .put('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        current_password: 'TestPassword123!',
        new_password: 'TestPassword123!',
        confirm_password: 'TestPassword123!',
      })
      .expect(400);

    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.message).toContain('differ');
  });

  it('returns 400 when new_password and confirm_password do not match', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    const res = await request(testApp)
      .put('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        current_password: 'TestPassword123!',
        new_password: 'BrandNewPass1!',
        confirm_password: 'MismatchPass1!',
      })
      .expect(400);

    const body = res.body as { error: string };
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when new_password does not meet policy', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    const res = await request(testApp)
      .put('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        current_password: 'TestPassword123!',
        new_password: 'weak',
        confirm_password: 'weak',
      })
      .expect(400);

    const body = res.body as { error: string };
    expect(body.error).toBe('VALIDATION_ERROR');
  });
});

describe('GET /auth/suppliers/:supplier_id/buyers — pagination and filters', () => {
  it('returns paginated results with custom page and limit', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    const res = await request(testApp)
      .get(`/auth/suppliers/${TEST_IDS.suppliers.org1}/buyers?page=1&limit=5`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      data: unknown[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(5);
    expect(typeof body.pagination.total).toBe('number');
    expect(typeof body.pagination.totalPages).toBe('number');
  });

  it('returns empty data for non-existent supplier', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);
    const nonExistentId = '00000000-0000-4000-b000-000000000099';

    const res = await request(testApp)
      .get(`/auth/suppliers/${nonExistentId}/buyers`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      data: unknown[];
      pagination: { total: number };
    };
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it('accepts search query parameter', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    const res = await request(testApp)
      .get(`/auth/suppliers/${TEST_IDS.suppliers.org1}/buyers?search=MTN`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('accepts status filter parameter', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    const res = await request(testApp)
      .get(`/auth/suppliers/${TEST_IDS.suppliers.org1}/buyers?status=active`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns 400 for invalid supplier_id format', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    await request(testApp)
      .get('/auth/suppliers/not-a-uuid/buyers')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns 400 for invalid status filter value', async () => {
    const { token, app: testApp } = authAgent(TEST_USERS.admin);

    await request(testApp)
      .get(`/auth/suppliers/${TEST_IDS.suppliers.org1}/buyers?status=bogus`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('requires authentication — returns 401 without token', async () => {
    await request(app).get(`/auth/suppliers/${TEST_IDS.suppliers.org1}/buyers`).expect(401);
  });
});

describe('POST /auth/forgot-password — validation', () => {
  it('returns 400 for missing email', async () => {
    await request(app).post('/auth/forgot-password').send({}).expect(400);
  });

  it('returns 400 for invalid email format', async () => {
    await request(app).post('/auth/forgot-password').send({ email: 'not-valid' }).expect(400);
  });
});

describe('POST /auth/refresh — branches', () => {
  it('returns 401 when no refresh cookie is present', async () => {
    const res = await request(app).post('/auth/refresh').expect(401);

    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('AUTH_ERROR');
    expect(body.message).toContain('No refresh token');
  });

  it('returns 401 for an invalid refresh token cookie', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', 'mms_refresh_token=invalid.jwt.token')
      .expect(401);

    const body = res.body as { error: string };
    expect(body.error).toBe('AUTH_ERROR');
  });
});
