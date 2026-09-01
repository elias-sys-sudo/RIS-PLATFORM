// =============================================================================
// Payments — Orphaned Approved Invoices Controller
// =============================================================================
// GET /admin/approvals/orphans — parse req → call service → next(err).

import type { Request, Response, NextFunction } from 'express';
import * as service from './payments-orphans.service';
import type { OrphanedApprovedInvoice } from './payments.types';

interface OrphanResponse {
  invoiceId: string;
  supplierId: string;
  faceValue: string;
  approvedAt: string;
  ageHours: number;
}

function toCamel(row: OrphanedApprovedInvoice): OrphanResponse {
  return {
    invoiceId: row.invoice_id,
    supplierId: row.supplier_id,
    faceValue: row.face_value,
    approvedAt: row.approved_at,
    ageHours: Number(row.age_hours),
  };
}

/**
 * GET /admin/approvals/orphans — list invoices stuck in 'approved' with no
 * payments row. PII-free response: identifiers + numerics only.
 */
export async function listOrphans(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await service.listOrphanedApprovedInvoices();
    const orphans = rows.map(toCamel);
    res.status(200).json({ orphans, count: orphans.length });
  } catch (err) {
    next(err);
  }
}
