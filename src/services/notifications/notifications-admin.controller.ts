// =============================================================================
// Notifications — Admin Controller
// =============================================================================
// GET /admin/email/failed-verifications — surfaces suppliers whose email
// verification job exhausted retries. Parses query, calls service,
// returns the camelCase shape from the repo.

import type { Request, Response, NextFunction } from 'express';
import * as service from './notifications.service';

const DEFAULT_LOOKBACK_HOURS = 72;

export async function listFailedVerificationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const lookbackHours = parseLookback(req.query.hours);
    const failed = await service.listFailedVerifications(lookbackHours);
    res.status(200).json({ failed, count: failed.length, lookbackHours });
  } catch (err) {
    next(err);
  }
}

function parseLookback(raw: unknown): number {
  if (typeof raw !== 'string') return DEFAULT_LOOKBACK_HOURS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LOOKBACK_HOURS;
  return Math.min(n, 720); // hard cap 30 days
}
