import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../errors';
import { logger } from '../logger';

/**
 * Middleware to restrict admin endpoints to a set of allowed IP addresses.
 * Reads from ADMIN_ALLOWED_IPS env var (comma-separated).
 * Skips check if env var is not set (dev mode).
 */
export function adminIpAllowlist(req: Request, _res: Response, next: NextFunction): void {
  const allowedIps = process.env.ADMIN_ALLOWED_IPS;

  if (!allowedIps) {
    next();
    return;
  }

  const list = allowedIps.split(',').map((ip) => ip.trim());
  const clientIp = req.ip ?? 'unknown';

  if (!list.includes(clientIp)) {
    logger.warn('Admin access denied — IP not in allowlist', {
      component: 'admin',
      ip: clientIp,
    });
    throw new ForbiddenError('Access denied');
  }

  next();
}
