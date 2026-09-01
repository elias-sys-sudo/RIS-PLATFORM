import { Request, Response, NextFunction } from 'express';
import * as adminService from './admin.service';
import type { CreateUserInput, UpdateUserInput } from './admin.types';

// =============================================================================
// Admin Controller — Parse request, call service, return response
// =============================================================================

/**
 * GET /admin/users
 * List users with pagination and optional search.
 */
export async function listUsersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const page_size = parseInt(req.query.page_size as string, 10) || 20;
    const search = req.query.search as string | undefined;

    const result = await adminService.listUsers({ search, page, page_size });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /admin/users
 * Create a new user.
 */
export async function createUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = req.body as CreateUserInput;
    const adminId = req.user!.userId;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await adminService.createUser(input, adminId, ip, ua);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /admin/users/:userId
 * Update user role and/or status.
 */
export async function updateUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { userId } = req.params;
    const input = req.body as UpdateUserInput;
    const adminId = req.user!.userId;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const user = await adminService.updateUser(userId, input, adminId, ip, ua);
    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/risk-config
 * List all risk config entries.
 */
export async function listRiskConfigHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const entries = await adminService.listRiskConfig();
    res.status(200).json(entries);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /admin/risk-config/:key
 * Update a risk config value.
 */
export async function updateRiskConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { key } = req.params;
    const { value } = req.body as { value: number };
    const adminId = req.user!.userId;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const entry = await adminService.updateRiskConfig(key, value, adminId, ip, ua);
    res.status(200).json(entry);
  } catch (err) {
    next(err);
  }
}
