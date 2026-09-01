import type { Request, Response, NextFunction } from 'express';
import * as service from './assignments.service';
import type { CreateAssignmentInput, AssignmentEntityType } from './assignments.types';

// =========================================================================
// POST /assignments
// =========================================================================

export async function createAssignmentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const input = req.body as CreateAssignmentInput;

    const record = await service.createAssignment(input, userId, ip, ua);

    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// GET /assignments/my-queue
// =========================================================================

export async function getMyQueueHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';

    const data = await service.getMyQueue(userId);

    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// GET /assignments/:entity_type/:entity_id
// =========================================================================

export async function getAssignmentsByEntityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { entity_type, entity_id } = req.params as {
      entity_type: AssignmentEntityType;
      entity_id: string;
    };

    const data = await service.getAssignmentsForEntity(entity_type, entity_id);

    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// DELETE /assignments/:id
// =========================================================================

export async function removeAssignmentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await service.removeAssignment(id, userId, ip, ua);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
