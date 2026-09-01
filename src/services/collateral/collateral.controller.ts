// =============================================================================
// Collateral — Controller (parse request, call service, return response)
// =============================================================================

import type { Request, Response, NextFunction } from 'express';
import * as service from './collateral.service';
import type { CreateCollateralInput, UpdateCollateralInput } from './collateral.types';

// ---------------------------------------------------------------------------
// POST /collateral
// ---------------------------------------------------------------------------

/** Create collateral handler. */
export async function createHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const body = req.body as Record<string, unknown>;
    const input: CreateCollateralInput = {
      invoice_id: body.invoice_id as string,
      type: body.type as CreateCollateralInput['type'],
      description: body.description as string,
      estimated_value: String(body.estimated_value as string | number),
      currency: (body.currency as string | undefined) ?? 'UGX',
      documents: (body.documents as string[] | undefined) ?? [],
      expiry_date: body.expiry_date as string | undefined,
    };

    const result = await service.createCollateral(userId, role, input, ip, ua);

    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /collateral?invoice_id=xxx
// ---------------------------------------------------------------------------

/** List collateral handler. */
export async function listHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const invoiceId = req.query.invoice_id as string;
    const page = req.query.page !== undefined ? Number(req.query.page) : 1;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20;

    const result = await service.listCollateral(
      userId,
      role,
      invoiceId,
      page,
      Math.min(limit, 100),
    );

    res.status(200).json({
      data: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        total_pages: Math.ceil(result.total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /collateral/:id
// ---------------------------------------------------------------------------

/** Get single collateral handler. */
export async function getHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const { id } = req.params;

    const result = await service.getCollateral(userId, role, id);

    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// PUT /collateral/:id
// ---------------------------------------------------------------------------

/** Update collateral handler. */
export async function updateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { id } = req.params;

    const body = req.body as Record<string, unknown>;
    const input: UpdateCollateralInput = {};
    if (body.type !== undefined) {
      input.type = body.type as UpdateCollateralInput['type'];
    }
    if (body.description !== undefined) {
      input.description = body.description as string;
    }
    if (body.estimated_value !== undefined) {
      input.estimated_value = String(body.estimated_value as string | number);
    }
    if (body.currency !== undefined) {
      input.currency = body.currency as string;
    }
    if (body.documents !== undefined) {
      input.documents = body.documents as string[];
    }
    if (body.expiry_date !== undefined) {
      input.expiry_date = body.expiry_date as string | null;
    }

    const result = await service.updateCollateral(userId, role, id, input, ip, ua);

    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// DELETE /collateral/:id
// ---------------------------------------------------------------------------

/** Soft delete collateral handler. */
export async function deleteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { id } = req.params;

    await service.deleteCollateral(userId, role, id, ip, ua);

    res.status(200).json({ message: 'Collateral deleted' });
  } catch (err) {
    next(err);
  }
}
