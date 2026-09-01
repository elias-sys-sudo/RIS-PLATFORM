// ============================================================
// complaints.controller.ts — Parse request, call service, return response.
// Zero business logic. Zero SQL.
// ============================================================
import type { Request, Response, NextFunction } from 'express';
import * as service from './complaints.service';
import type {
  CreateComplaintInput,
  UpdateComplaintInput,
  ComplaintFilters,
} from './complaints.types';

/** POST /complaints — file a new complaint. */
export async function fileComplaintHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const result = await service.fileComplaint(userId, req.body as CreateComplaintInput, ip, ua);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/** GET /complaints/:id — get complaint detail. */
export async function getComplaintHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const record = await service.getComplaint(req.params.id);
    res.status(200).json(record);
  } catch (err) {
    next(err);
  }
}

/** GET /complaints — list complaints with filters. */
export async function listComplaintsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const filters: ComplaintFilters = {};
    if (req.query.status !== undefined) filters.status = req.query.status as string;
    if (req.query.category !== undefined) filters.category = req.query.category as string;

    const result = await service.listComplaints(filters, { page, limit });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/** PUT /complaints/:id — update complaint fields. */
export async function updateComplaintHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const updated = await service.updateComplaint(
      req.params.id,
      req.body as UpdateComplaintInput,
      userId,
      ip,
      ua,
    );
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

/** POST /complaints/:id/resolve — resolve a complaint. */
export async function resolveComplaintHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { resolution } = req.body as { resolution: string };
    await service.resolveComplaint(req.params.id, resolution, userId, ip, ua);
    res.status(200).json({ message: 'Complaint resolved' });
  } catch (err) {
    next(err);
  }
}

/** POST /complaints/:id/escalate — escalate a complaint. */
export async function escalateComplaintHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { reason } = req.body as { reason: string };
    await service.escalateComplaint(req.params.id, reason, userId, ip, ua);
    res.status(200).json({ message: 'Complaint escalated' });
  } catch (err) {
    next(err);
  }
}
