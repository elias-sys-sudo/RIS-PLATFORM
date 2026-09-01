// ============================================================
// settlements.controller.ts — parse req, call service, next(err)
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as service from './settlements.service';

// POST /settlements/:invoiceId/initiate
export async function initiateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const body = req.body as Record<string, unknown>;

    // HTTP-initiated path uses a fresh uuid; the unique constraint on
    // invoice_id (plus the service-layer exists check) is the duplicate guard
    // for this path. The BullMQ worker uses a deterministic key instead so
    // retried jobs replay rather than duplicate.
    const result = await service.initiateSettlement(
      req.params.invoiceId,
      body.collection_id as string,
      String(body.buyer_payment_amount),
      typeof body.penalty_income === 'number' ? body.penalty_income.toString() : '0',
      userId,
      ip,
      ua,
      uuidv4(),
    );
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

// POST /settlements/:id/repay-facility
export async function repayFacilityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const body = req.body as Record<string, unknown>;

    const result = await service.repayFacility(
      req.params.id,
      String(body.facility_repayment_amount),
      String(body.accrued_interest),
      userId,
      ip,
      ua,
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

// POST /settlements/:id/book-profit
export async function bookProfitHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const body = req.body as Record<string, unknown>;

    const result = await service.bookProfit(
      req.params.id,
      String(body.discount_earned),
      String(body.bank_cost_paid),
      userId,
      ip,
      ua,
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

// POST /settlements/:id/close
export async function closeHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await service.closeSettlement(req.params.id, userId, ip, ua);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

// GET /settlements/:id
export async function getHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.getSettlement(req.params.id);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

// GET /settlements
export async function listHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const result = await service.getSettlementList(page, limit);
    res.json({
      data: result.data,
      total: result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
    });
  } catch (err) {
    next(err);
  }
}

// GET /settlements/dashboard
export async function dashboardHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const startParam = req.query.period_start as string | undefined;
    const endParam = req.query.period_end as string | undefined;
    const periodStart = startParam !== undefined ? new Date(startParam) : undefined;
    const periodEnd = endParam !== undefined ? new Date(endParam) : undefined;

    const result = await service.getDashboard(periodStart, periodEnd);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}
