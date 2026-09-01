// =============================================================================
// AML Clearance — Controller (parse request, call service, return response)
// =============================================================================
// No SQL, no business logic. Joi validation happens in the route layer.

import { Request, Response, NextFunction } from 'express';
import * as service from './aml-clearance.service';
import type { ClearAmlInput } from './aml-clearance.types';

/**
 * POST /admin/aml/clear/:id
 * Compliance officer clears an AML-flagged invoice.
 */
export async function clearInvoiceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const input = req.body as ClearAmlInput;
    const officerId = req.user!.userId;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await service.clearInvoice(id, officerId, input, ip, ua);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/aml/queue
 * List AML-flagged invoices awaiting clearance — non-PII columns only.
 */
export async function listQueueHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rows = await service.listQueue();
    res.status(200).json({ data: rows });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/aml/queue/:id
 * Detail view — decrypts PII and writes an AML_DETAIL_VIEWED audit entry.
 */
export async function getDetailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const viewerId = req.user!.userId;
    const viewerRole = req.user!.role;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const detail = await service.getDetail(id, viewerId, viewerRole, ip, ua);
    res.status(200).json(detail);
  } catch (err) {
    next(err);
  }
}
