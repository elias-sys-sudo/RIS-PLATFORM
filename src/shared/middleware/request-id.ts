import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';
import { runWithRequestContext } from '../context';

/**
 * Assigns a unique request ID to every inbound request and binds it to the
 * AsyncLocalStorage so every downstream log line and every BullMQ job
 * enqueued during the request can be correlated back to it.
 *
 * If the client sends an X-Request-Id header, it is preserved for tracing;
 * otherwise a new UUID v4 is generated. The ID is also echoed on the
 * response header for client-side correlation.
 *
 * MUST run before any middleware that logs or queues work (audit, validate,
 * controller), so the context is active by the time those frames execute.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
  req.headers['x-request-id'] = requestId;
  res.setHeader('x-request-id', requestId);
  runWithRequestContext({ requestId }, () => {
    next();
  });
}
