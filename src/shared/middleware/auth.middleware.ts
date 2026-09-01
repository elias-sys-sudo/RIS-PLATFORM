import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getSession } from '../../services/auth/auth.service';
import { logger } from '../logger';
import { rlsStore } from '../database/pool';

const JWT_SECRET = process.env.JWT_SECRET;
if (JWT_SECRET === null || JWT_SECRET === undefined || JWT_SECRET === '') {
  throw new Error('JWT_SECRET environment variable is required');
}

interface JwtPayload {
  userId: string;
  role: string;
  sessionId: string;
  type: 'full' | 'partial_auth';
}

/**
 * JWT authentication middleware.
 * Verifies token signature, checks session exists in Redis (not blacklisted),
 * and attaches user info to req.user.
 * Returns 401 if token is invalid, expired, or session has been revoked.
 */
export async function authenticateJwt(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader === undefined || authHeader === null || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'AUTH_ERROR',
      message: 'Authentication required',
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET as string, {
      algorithms: ['HS256'],
    }) as JwtPayload;

    if (payload.type !== 'full') {
      res.status(401).json({
        error: 'AUTH_ERROR',
        message: 'Full authentication required',
      });
      return;
    }

    const session = await getSession(payload.sessionId);
    if (!session) {
      res.status(401).json({
        error: 'AUTH_ERROR',
        message: 'Session expired or revoked',
      });
      return;
    }

    req.user = {
      userId: payload.userId,
      role: payload.role,
      sessionId: payload.sessionId,
    };

    // Propagate authenticated identity through the async call chain so that
    // beginWithRls() can activate PostgreSQL RLS for every transaction started
    // during this request, without threading userId/role through every repo call.
    rlsStore.run({ userId: payload.userId, role: payload.role }, () => {
      next();
    });
  } catch (err: unknown) {
    const isJwtError = err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError;

    if (isJwtError) {
      logger.debug('JWT verification failed', {
        component: 'auth-middleware',
        errorName: (err as Error).name,
      });
    }

    res.status(401).json({
      error: 'AUTH_ERROR',
      message: 'Invalid or expired token',
    });
  }
}
