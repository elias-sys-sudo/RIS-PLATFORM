/**
 * Unit tests for src/shared/middleware/auth.middleware.ts
 *
 * Coverage targets:
 *   - line 8:        JWT_SECRET missing → throws at module load time
 *   - line 7 branch 0: JWT_SECRET is undefined/null/empty → error thrown
 *   - line 71 branch 1: err is NOT a jwt error (generic Error) → no debug log
 */

// ---------------------------------------------------------------------------
// Set required env vars before any import that reads them at module load time
// ---------------------------------------------------------------------------
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-256-bits-long-for-testing-purposes-1234';
process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

// ---------------------------------------------------------------------------
// Mocks — declared before module imports
// ---------------------------------------------------------------------------
const mockGetSession = jest.fn();

jest.mock('../../../../src/services/auth/auth.service', () => ({
  getSession: mockGetSession,
}));

jest.mock('../../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
  rlsStore: {
    run: jest.fn((_ctx: unknown, callback: () => void) => callback()),
    getStore: jest.fn(() => undefined),
  },
}));

jest.mock('../../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    audit: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticateJwt } from '../../../../src/shared/middleware/auth.middleware';
import { logger } from '../../../../src/shared/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createMockRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

function makeToken(
  payload: Record<string, unknown>,
  secret = process.env.JWT_SECRET as string,
): string {
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '1h' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authenticateJwt', () => {
  let mockNext: jest.Mock<void, []>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNext = jest.fn<void, []>();
  });

  // -------------------------------------------------------------------------
  // Missing / malformed Authorization header
  // -------------------------------------------------------------------------
  it('returns 401 when Authorization header is absent', async () => {
    const req = { headers: {} } as Request;
    const res = createMockRes();

    await authenticateJwt(req, res, mockNext as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json as jest.Mock).toHaveBeenCalledWith({
      error: 'AUTH_ERROR',
      message: 'Authentication required',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header does not start with "Bearer "', async () => {
    const req = { headers: { authorization: 'Basic abc123' } } as Request;
    const res = createMockRes();

    await authenticateJwt(req, res, mockNext as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Token with type !== 'full'
  // -------------------------------------------------------------------------
  it('returns 401 when token type is "partial_auth"', async () => {
    const token = makeToken({
      userId: 'u-1',
      role: 'supplier',
      sessionId: 's-1',
      type: 'partial_auth',
    });
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    const res = createMockRes();

    await authenticateJwt(req, res, mockNext as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json as jest.Mock).toHaveBeenCalledWith({
      error: 'AUTH_ERROR',
      message: 'Full authentication required',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Session revoked / expired
  // -------------------------------------------------------------------------
  it('returns 401 when session is not found in Redis', async () => {
    mockGetSession.mockResolvedValue(null);

    const token = makeToken({ userId: 'u-1', role: 'supplier', sessionId: 's-1', type: 'full' });
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    const res = createMockRes();

    await authenticateJwt(req, res, mockNext as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json as jest.Mock).toHaveBeenCalledWith({
      error: 'AUTH_ERROR',
      message: 'Session expired or revoked',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  it('calls next() and sets req.user when token and session are valid', async () => {
    mockGetSession.mockResolvedValue({ userId: 'u-1', role: 'supplier' });

    const token = makeToken({ userId: 'u-1', role: 'supplier', sessionId: 's-1', type: 'full' });
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    const res = createMockRes();

    await authenticateJwt(req, res, mockNext as unknown as NextFunction);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect((req as Request & { user: unknown }).user).toEqual({
      userId: 'u-1',
      role: 'supplier',
      sessionId: 's-1',
    });
  });

  // -------------------------------------------------------------------------
  // JWT verification errors — JsonWebTokenError (line 71 branch 0)
  // -------------------------------------------------------------------------
  it('returns 401 and logs debug for JsonWebTokenError (invalid signature)', async () => {
    const token = makeToken(
      { userId: 'u-1', role: 'supplier', sessionId: 's-1', type: 'full' },
      'wrong-secret-that-will-fail-verification',
    );
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    const res = createMockRes();

    await authenticateJwt(req, res, mockNext as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json as jest.Mock).toHaveBeenCalledWith({
      error: 'AUTH_ERROR',
      message: 'Invalid or expired token',
    });
    // JsonWebTokenError IS a jwt error → debug should be called
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      'JWT verification failed',
      expect.objectContaining({ component: 'auth-middleware' }),
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 401 and logs debug for TokenExpiredError', async () => {
    // Create an already-expired token
    const expiredToken = jwt.sign(
      { userId: 'u-1', role: 'supplier', sessionId: 's-1', type: 'full' },
      process.env.JWT_SECRET as string,
      { algorithm: 'HS256', expiresIn: -1 }, // expired in the past
    );
    const req = { headers: { authorization: `Bearer ${expiredToken}` } } as Request;
    const res = createMockRes();

    await authenticateJwt(req, res, mockNext as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      'JWT verification failed',
      expect.objectContaining({ component: 'auth-middleware' }),
    );
  });

  // Covers line 71 branch 1: err is NOT a jwt error → no debug log
  it('returns 401 without debug log for a non-JWT error thrown during verify', async () => {
    // Make jwt.verify throw a plain Error (not a JsonWebTokenError/TokenExpiredError)
    jest.spyOn(jwt, 'verify').mockImplementationOnce(() => {
      throw new Error('Unexpected internal failure');
    });

    const token = makeToken({ userId: 'u-1', role: 'supplier', sessionId: 's-1', type: 'full' });
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    const res = createMockRes();

    await authenticateJwt(req, res, mockNext as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json as jest.Mock).toHaveBeenCalledWith({
      error: 'AUTH_ERROR',
      message: 'Invalid or expired token',
    });
    // NOT a jwt error → debug should NOT be called
    expect(mockedLogger.debug).not.toHaveBeenCalled();
    expect(mockNext).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Module load guard: JWT_SECRET missing → throws
// Covers line 8 and line 7 branch 0
// ---------------------------------------------------------------------------
describe('auth.middleware module load guard', () => {
  it('throws when JWT_SECRET is undefined at module load time', () => {
    const originalSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;

    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../../src/shared/middleware/auth.middleware');
      });
    }).toThrow('JWT_SECRET environment variable is required');

    process.env.JWT_SECRET = originalSecret;
  });

  it('throws when JWT_SECRET is empty string at module load time', () => {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = '';

    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../../src/shared/middleware/auth.middleware');
      });
    }).toThrow('JWT_SECRET environment variable is required');

    process.env.JWT_SECRET = originalSecret;
  });
});
