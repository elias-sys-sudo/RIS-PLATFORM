// =============================================================================
// Reporting — Controller (parse request, call service, return response)
// =============================================================================

import type { Request, Response, NextFunction } from 'express';
import { ReportType } from './reporting.types';
import type { ReportFilters, AuditExport } from './reporting.types';
import * as service from './reporting.service';
import { logger } from '../../shared/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract common filter parameters from query string. */
function extractFilters(req: Request): ReportFilters {
  const q = req.query;
  return {
    startDate: typeof q.startDate === 'string' ? q.startDate : undefined,
    endDate: typeof q.endDate === 'string' ? q.endDate : undefined,
    userId: typeof q.userId === 'string' ? q.userId : undefined,
    actionType: typeof q.actionType === 'string' ? q.actionType : undefined,
    buyerId: typeof q.buyerId === 'string' ? q.buyerId : undefined,
    status: typeof q.status === 'string' ? q.status : undefined,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** GET /reports/portfolio */
export async function portfolioHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const filters = extractFilters(req);

    const result = await service.generateReport(
      ReportType.PORTFOLIO_SUMMARY,
      userId,
      role,
      filters,
      ip,
      ua,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /reports/aging */
export async function agingHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const filters = extractFilters(req);

    const result = await service.generateReport(
      ReportType.AGING_ANALYSIS,
      userId,
      role,
      filters,
      ip,
      ua,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /reports/buyer-exposure */
export async function buyerExposureHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const filters = extractFilters(req);

    const result = await service.generateReport(
      ReportType.BUYER_EXPOSURE,
      userId,
      role,
      filters,
      ip,
      ua,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /reports/profit */
export async function profitHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const filters = extractFilters(req);

    const result = await service.generateReport(ReportType.PROFIT, userId, role, filters, ip, ua);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /reports/facilities */
export async function facilityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const filters = extractFilters(req);

    const result = await service.generateReport(ReportType.FACILITY, userId, role, filters, ip, ua);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /reports/audit-export */
export async function auditExportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const filters = extractFilters(req);
    const format = req.query.format as string | undefined;

    const result = await service.generateReport(
      ReportType.AUDIT_EXPORT,
      userId,
      role,
      filters,
      ip,
      ua,
    );

    if (format === 'csv') {
      const csv = service.exportToCsv(result.data as AuditExport);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit_export_${timestamp}.csv"`);
      res.status(200).send(csv);
      return;
    }

    res.status(200).json({ data: result });
  } catch (err) {
    logger.error('Audit export failed', {
      component: 'reporting',
      errorMessage: err instanceof Error ? err.message : 'unknown',
    });
    next(err);
  }
}

/** GET /reports/regulatory */
export async function regulatoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const filters = extractFilters(req);

    const result = await service.generateReport(
      ReportType.REGULATORY,
      userId,
      role,
      filters,
      ip,
      ua,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /reports/applications-received */
export async function applicationsReceivedHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const filters = extractFilters(req);

    const result = await service.generateReport(
      ReportType.APPLICATIONS_RECEIVED,
      userId,
      role,
      filters,
      ip,
      ua,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /reports/applications-pipeline */
export async function applicationsPipelineHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const filters = extractFilters(req);

    const result = await service.generateReport(
      ReportType.APPLICATIONS_PIPELINE,
      userId,
      role,
      filters,
      ip,
      ua,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /reports/applications-incomplete */
export async function applicationsIncompleteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const filters = extractFilters(req);

    const result = await service.generateReport(
      ReportType.APPLICATIONS_INCOMPLETE,
      userId,
      role,
      filters,
      ip,
      ua,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /reports/company-pl */
export async function companyPlHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const filters = extractFilters(req);

    const result = await service.generateReport(
      ReportType.COMPANY_PL,
      userId,
      role,
      filters,
      ip,
      ua,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /reports/disbursed-funds */
export async function disbursedFundsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const filters = extractFilters(req);

    const result = await service.generateReport(
      ReportType.DISBURSED_FUNDS,
      userId,
      role,
      filters,
      ip,
      ua,
    );
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}
