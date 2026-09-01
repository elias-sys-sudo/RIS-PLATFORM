process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-tests';

import request from 'supertest';
import express from 'express';
import { notificationsAdminRouter } from '../../../src/services/notifications/notifications-admin.routes';
import { globalErrorHandler } from '../../../src/shared/middleware/error-handler';

jest.mock('../../../src/services/notifications/notifications.service');
jest.mock('../../../src/services/notifications/notifications-admin.controller', () => ({
  listFailedVerificationsHandler: jest.fn(
    (_req: unknown, res: { status: (n: number) => { json: (v: unknown) => void } }) =>
      res.status(200).json({
        failed: [
          {
            userId: '11111111-1111-1111-1111-111111111111',
            email: 'a@b.com',
            attempts: 3,
            lastErrorCode: 'SES_REJECTED',
            lastFailedAt: '2026-05-20T10:00:00Z',
            lastJobId: 'job-1',
          },
        ],
        count: 1,
        lookbackHours: 72,
      }),
  ),
}));
jest.mock('../../../src/services/auth/auth.service', () => ({
  getSession: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'management' }),
}));

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

function setRole(role: string): void {
  jwtPayload.role = role;
}

const app = express();
app.use(express.json());
app.use('/admin/email', notificationsAdminRouter);
app.use(globalErrorHandler);

describe('GET /admin/email/failed-verifications', () => {
  beforeEach(() => {
    setRole('management');
  });

  it('returns 200 with the failed-verifications list for management', async () => {
    setRole('management');
    const res = await request(app)
      .get('/admin/email/failed-verifications')
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    const body = res.body as { count: number; lookbackHours: number };
    expect(body.count).toBe(1);
    expect(body.lookbackHours).toBe(72);
  });

  it('returns 200 for finance_manager', async () => {
    setRole('finance_manager');
    const res = await request(app)
      .get('/admin/email/failed-verifications')
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
  });

  it('returns 200 for compliance_officer', async () => {
    setRole('compliance_officer');
    const res = await request(app)
      .get('/admin/email/failed-verifications')
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
  });

  it('returns 403 for supplier', async () => {
    setRole('supplier');
    const res = await request(app)
      .get('/admin/email/failed-verifications')
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(403);
  });

  it('returns 401 when no JWT is supplied', async () => {
    const res = await request(app).get('/admin/email/failed-verifications');
    expect(res.status).toBe(401);
  });

  it('rejects invalid hours query param via Joi', async () => {
    setRole('management');
    const res = await request(app)
      .get('/admin/email/failed-verifications?hours=notanumber')
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(400);
  });

  it('response keys match the expected non-PII-leaking shape exactly', async () => {
    setRole('management');
    const res = await request(app)
      .get('/admin/email/failed-verifications')
      .set('Authorization', 'Bearer t');
    const body = res.body as {
      failed: Record<string, unknown>[];
      count: number;
      lookbackHours: number;
    };
    expect(Object.keys(body).sort()).toEqual(['count', 'failed', 'lookbackHours']);
    expect(Object.keys(body.failed[0] ?? {}).sort()).toEqual(
      ['attempts', 'email', 'lastErrorCode', 'lastFailedAt', 'lastJobId', 'userId'].sort(),
    );
  });
});
