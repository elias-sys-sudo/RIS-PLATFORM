// Set env vars BEFORE any imports so module-level constants pick them up
const JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';
process.env.JWT_SECRET = JWT_SECRET;

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);

jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  })),
}));

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  rlsStore: {
    run: jest.fn((_ctx: unknown, callback: () => void) => callback()),
    getStore: jest.fn(() => undefined),
  },
}));

jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
  },
}));

jest.mock('../../../src/services/auth/auth.repository', () => ({
  findUserByEmail: jest.fn(),
  incrementFailedLogin: jest.fn(),
  resetFailedLogin: jest.fn(),
  lockAccount: jest.fn(),
  recordLogin: jest.fn(),
  createAuditEntry: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { authenticateJwt } from '../../../src/shared/middleware/auth.middleware';
import { createRoleGuard } from '../../../src/shared/middleware/role.middleware';
import { setRedisClient } from '../../../src/services/auth/auth.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    get: jest.fn(),
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  setRedisClient({
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  } as never);
});

// ---------------------------------------------------------------------------
// authenticateJwt
// ---------------------------------------------------------------------------

describe('authenticateJwt', () => {
  it('attaches user to req when JWT and session are valid', async () => {
    const sessionData = {
      sessionId: 'sess-1',
      userId: 'user-001',
      role: 'credit_officer',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };

    mockRedisGet.mockResolvedValue(JSON.stringify(sessionData));

    const token = jwt.sign(
      { userId: 'user-001', role: 'credit_officer', sessionId: 'sess-1', type: 'full' },
      JWT_SECRET,
      { expiresIn: '15m' },
    );

    const req = mockReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await authenticateJwt(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({
      userId: 'user-001',
      role: 'credit_officer',
      sessionId: 'sess-1',
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Expired JWT returns 401
  // ---------------------------------------------------------------------------

  it('returns 401 for expired JWT', async () => {
    const token = jwt.sign(
      { userId: 'user-001', role: 'supplier', sessionId: 'sess-1', type: 'full' },
      JWT_SECRET,
      { expiresIn: '0s' },
    );

    await new Promise((r) => setTimeout(r, 50));

    const req = mockReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await authenticateJwt(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'AUTH_ERROR' }));
  });

  it('returns 401 when no Authorization header', async () => {
    const req = mockReq();
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await authenticateJwt(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Authentication required' }),
    );
  });

  it('returns 401 for malformed Bearer token', async () => {
    const req = mockReq({
      headers: { authorization: 'Bearer invalid.token.here' },
    });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await authenticateJwt(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when Authorization header is not Bearer scheme', async () => {
    const req = mockReq({
      headers: { authorization: 'Basic abc123' },
    });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await authenticateJwt(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 for partial_auth token type', async () => {
    const token = jwt.sign(
      { userId: 'user-001', role: 'supplier', sessionId: 'sess-1', type: 'partial_auth' },
      JWT_SECRET,
      { expiresIn: '5m' },
    );

    const req = mockReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await authenticateJwt(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Full authentication required' }),
    );
  });

  // ---------------------------------------------------------------------------
  // 10 (cont). Blacklisted JWT (session deleted) returns 401
  // ---------------------------------------------------------------------------

  it('returns 401 when session has been revoked (logged out)', async () => {
    mockRedisGet.mockResolvedValue(null); // session was deleted

    const token = jwt.sign(
      { userId: 'user-001', role: 'supplier', sessionId: 'deleted-sess', type: 'full' },
      JWT_SECRET,
      { expiresIn: '15m' },
    );

    const req = mockReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await authenticateJwt(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Session expired or revoked' }),
    );
  });

  it('returns 401 for JWT signed with wrong secret', async () => {
    const token = jwt.sign(
      { userId: 'user-001', role: 'supplier', sessionId: 'sess-1', type: 'full' },
      'wrong-secret-key-that-is-also-long-enough-for-testing',
      { expiresIn: '15m' },
    );

    const req = mockReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next: NextFunction = jest.fn();

    await authenticateJwt(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ---------------------------------------------------------------------------
// 12 & 13. Role guard
// ---------------------------------------------------------------------------

describe('createRoleGuard', () => {
  // ---------------------------------------------------------------------------
  // 12. Unauthorized role returns 403
  // ---------------------------------------------------------------------------

  it('returns 403 when supplier tries to access credit_officer endpoint', () => {
    const guard = createRoleGuard(['credit_officer', 'management']);
    const req = mockReq();
    req.user = { userId: 'user-001', role: 'supplier', sessionId: 'sess-1' };
    const res = mockRes();
    const next: NextFunction = jest.fn();

    guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'FORBIDDEN' }));
  });

  // ---------------------------------------------------------------------------
  // 13. Authorized role passes through
  // ---------------------------------------------------------------------------

  it('calls next() when user role is in allowed list', () => {
    const guard = createRoleGuard(['credit_officer', 'management']);
    const req = mockReq();
    req.user = { userId: 'user-002', role: 'credit_officer', sessionId: 'sess-2' };
    const res = mockRes();
    const next: NextFunction = jest.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows management role for management-guarded endpoint', () => {
    const guard = createRoleGuard(['management']);
    const req = mockReq();
    req.user = { userId: 'user-003', role: 'management', sessionId: 'sess-3' };
    const res = mockRes();
    const next: NextFunction = jest.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when no user is attached to request', () => {
    const guard = createRoleGuard(['credit_officer']);
    const req = mockReq();
    const res = mockRes();
    const next: NextFunction = jest.fn();

    guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects finance_manager from credit_officer-only endpoint', () => {
    const guard = createRoleGuard(['credit_officer']);
    const req = mockReq();
    req.user = { userId: 'user-004', role: 'finance_manager', sessionId: 'sess-4' };
    const res = mockRes();
    const next: NextFunction = jest.fn();

    guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
