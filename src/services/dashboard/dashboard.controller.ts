// =============================================================================
// Dashboard — Controller (parse request, call service, return response)
// =============================================================================

import type { Request, Response, NextFunction } from 'express';
import * as service from './dashboard.service';
import type {
  DashboardPeriod,
  DashboardPaymentFilters,
  PaymentHistoryFilters,
} from './dashboard.types';

// ---------------------------------------------------------------------------
// GET /dashboard/summary
// ---------------------------------------------------------------------------

/** Dashboard summary endpoint handler. */
export async function summaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const period = (req.query.period as DashboardPeriod) ?? 'all';

    const supplierId = role === 'supplier' ? userId : null;

    const result = await service.getDashboardSummary(userId, supplierId, period, ip, ua);

    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /payments?supplier_id=xxx
// ---------------------------------------------------------------------------

/** Payment history endpoint handler. */
export async function paymentHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const filters: PaymentHistoryFilters = {
      supplierId: req.query.supplier_id as string,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      method: req.query.method as string | undefined,
      minAmount: req.query.min_amount as string | undefined,
      sort: req.query.sort as string | undefined,
      order: req.query.order as 'asc' | 'desc' | undefined,
      page: req.query.page !== undefined ? Number(req.query.page) : undefined,
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
    };

    const result = await service.getPaymentHistory(userId, role, filters, ip, ua);

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /dashboard/payments
// ---------------------------------------------------------------------------

/** Dashboard payments list handler. */
export async function dashboardPaymentsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const filters: DashboardPaymentFilters = {
      status: req.query.status as string | undefined,
      method: req.query.method as string | undefined,
      direction: req.query.direction as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      page: req.query.page !== undefined ? Number(req.query.page) : undefined,
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
    };

    const result = await service.getDashboardPayments(userId, filters, ip, ua);
    res.status(200).json({ data: result.data, pagination: result.pagination });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /dashboard/approval-queue
// ---------------------------------------------------------------------------

/** Approval queue handler. */
export async function approvalQueueHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const data = await service.getApprovalQueue(userId, ip, ua);
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /dashboard/funding-pipeline
// ---------------------------------------------------------------------------

/** Funding pipeline handler. */
export async function fundingPipelineHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const data = await service.getFundingPipeline(userId, ip, ua);
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /dashboard/supplier/summary
// ---------------------------------------------------------------------------

/** Supplier dashboard summary handler. */
export async function supplierSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const period = (req.query.period as DashboardPeriod) ?? 'all';

    const data = await service.getSupplierSummary(userId, period, ip, ua);
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /dashboard/legal/summary
// ---------------------------------------------------------------------------

/** Legal dashboard summary handler. */
export async function legalSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const data = await service.getLegalSummary(userId, ip, ua);
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /dashboard/risk-distribution
// ---------------------------------------------------------------------------

/** Risk distribution handler. */
export async function riskDistributionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const period = (req.query.period as DashboardPeriod) ?? 'all';

    const data = await service.getRiskDistribution(userId, period, ip, ua);
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}
