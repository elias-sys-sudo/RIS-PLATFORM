import { Request, Response, NextFunction } from 'express';
import { query } from '../database/pool';
import { logger } from '../logger';

/**
 * Express user interface for JWT-authenticated requests.
 */
export interface AuthenticatedUser {
  userId: string;
  role: string;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /**
       * Raw request body bytes, captured by the jsonBodyLimit verify callback.
       * Required for webhook HMAC verification against the original wire bytes
       * (as opposed to JSON.stringify of the parsed body, which may differ).
       */
      rawBody?: Buffer;
    }
  }
}

/**
 * Audit middleware that logs every HTTP request to the audit_logs table.
 * Captures: user_id, method, path, ip, user_agent, timestamp, response status, response time.
 * NEVER logs the request body (may contain PII).
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const userId = req.user?.userId ?? null;

    writeAuditLog(
      userId,
      req.method,
      req.path,
      req.ip ?? 'unknown',
      req.get('user-agent') ?? 'unknown',
      res.statusCode,
      duration,
    ).catch((err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error('Failed to write audit log', {
        component: 'audit',
        errorMessage,
      });
    });
  });

  next();
}

/**
 * Write an audit log entry to the database.
 */
async function writeAuditLog(
  userId: string | null,
  method: string,
  path: string,
  ip: string,
  userAgent: string,
  statusCode: number,
  responseTimeMs: number,
): Promise<void> {
  await query(
    `INSERT INTO audit_logs (
      user_id, action, table_name, record_id,
      old_values, new_values, ip_address, user_agent
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      `HTTP_${method}`,
      'http_request',
      path,
      null,
      JSON.stringify({ statusCode, responseTimeMs }),
      ip,
      userAgent,
    ],
  );
}
