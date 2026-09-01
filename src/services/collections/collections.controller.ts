import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/logger';
import * as service from './collections.service';
import type { CollectionListFilters, CollectionPaymentMethod } from './collections.types';

// =========================================================================
// GET /collections/overdue (legacy)
// =========================================================================

/**
 * Get all overdue invoices (credit_officer, management).
 */
export async function getOverdueHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await service.getOverdueInvoices();
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// POST /collections/:id/record-payment (legacy)
// =========================================================================

/**
 * Record a payment received from a buyer (legacy endpoint).
 */
export async function recordPaymentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const body = req.body as {
      amount: string;
      paymentDate: string;
      paymentMethod: string;
      paidBy: string;
      paymentReference?: string;
      notes?: string;
    };

    await service.recordPaymentReceived({
      invoiceId: id,
      amount: body.amount,
      paymentDate: body.paymentDate,
      receivedBy: userId,
      paymentMethod: body.paymentMethod as CollectionPaymentMethod,
      paidBy: body.paidBy,
      paymentReference: body.paymentReference,
      notes: body.notes,
    });

    res.status(200).json({
      message: 'Payment recorded successfully',
      invoiceId: id,
    });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// GET /collections/:invoiceId/penalty (legacy)
// =========================================================================

/**
 * Get penalty calculation for a specific invoice.
 */
export async function getPenaltyHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { invoiceId } = req.params;
    const data = await service.getPenaltyByInvoiceId(invoiceId);
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// GET /collections (paginated list with filters + summary_stats)
// =========================================================================

/**
 * List collections with pagination, filters, and summary statistics.
 */
export async function listCollectionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const filters = extractFiltersFromQuery(req);
    const result = await service.listCollections(filters);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Extract collection list filters from query parameters.
 */
function extractFiltersFromQuery(req: Request): CollectionListFilters {
  const q = req.query as Record<string, string | undefined>;
  const filters: CollectionListFilters = {};

  if (q.status !== undefined) filters.status = q.status;
  if (q.escalation_level !== undefined) filters.escalation_level = q.escalation_level;
  if (q.days_overdue_min !== undefined) filters.days_overdue_min = parseInt(q.days_overdue_min, 10);
  if (q.days_overdue_max !== undefined) filters.days_overdue_max = parseInt(q.days_overdue_max, 10);
  if (q.search !== undefined) filters.search = q.search;
  if (q.sort_by !== undefined) filters.sort_by = q.sort_by;
  if (q.sort_dir === 'asc' || q.sort_dir === 'desc') filters.sort_dir = q.sort_dir;
  if (q.page !== undefined) filters.page = parseInt(q.page, 10);
  if (q.page_size !== undefined) filters.page_size = parseInt(q.page_size, 10);

  return filters;
}

// =========================================================================
// GET /collections/:id (detail)
// =========================================================================

/**
 * Get full collection detail including payment and escalation history.
 */
export async function getCollectionDetailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const data = await service.getCollectionDetail(id);
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// POST /collections/:id/payments (frontend-aligned)
// =========================================================================

/**
 * Record a payment against a collection (frontend field names).
 */
export async function recordCollectionPaymentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const body = req.body as {
      amount: number;
      method: CollectionPaymentMethod;
      reference?: string;
      paid_by: string;
      payment_date: string;
      notes?: string;
    };

    await service.recordCollectionPayment(
      id,
      {
        amount: body.amount,
        method: body.method,
        reference: body.reference,
        paid_by: body.paid_by,
        payment_date: body.payment_date,
        notes: body.notes,
      },
      userId,
    );

    res.status(200).json({
      message: 'Payment recorded successfully',
      collectionId: id,
    });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// POST /collections/:id/escalate
// =========================================================================

/**
 * Escalate a collection to the next level.
 */
export async function escalateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const { reason } = req.body as { reason: string };

    await service.escalateCollection(id, userId, reason);

    res.status(200).json({
      message: 'Collection escalated successfully',
      collectionId: id,
    });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// POST /collections/:id/de-escalate
// =========================================================================

/**
 * De-escalate a collection by one level.
 */
export async function deescalateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const { reason } = req.body as { reason: string };

    await service.deescalateCollection(id, userId, reason);

    res.status(200).json({
      message: 'Collection de-escalated successfully',
      collectionId: id,
    });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// POST /collections/:id/resolve
// =========================================================================

/**
 * Resolve/mark a collection as collected.
 */
export async function resolveHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';

    await service.resolveCollectionById(id, userId);

    res.status(200).json({
      message: 'Collection resolved successfully',
      collectionId: id,
    });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// Escalation Documents
// =========================================================================

/** POST /collections/:id/documents/draft */
export async function generateDraftHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const { document_type } = req.body as { document_type: string };
    const userId = req.user?.userId ?? '';
    const documentId = await service.generateDraftDocument(id, document_type, userId);
    res.status(201).json({ documentId, message: 'Draft generated' });
  } catch (err) {
    next(err);
  }
}

/** PATCH /collections/:id/documents/:docId */
export async function updateDraftHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { docId } = req.params;
    const userId = req.user?.userId ?? '';
    const body = req.body as { deadline_days?: number; additional_notes?: string };
    await service.updateDraftParams(
      docId,
      {
        deadlineDays: body.deadline_days,
        additionalNotes: body.additional_notes,
      },
      userId,
    );
    res.status(200).json({ message: 'Draft updated' });
  } catch (err) {
    next(err);
  }
}

/** POST /collections/:id/documents/:docId/send */
export async function sendDocumentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { docId } = req.params;
    const userId = req.user?.userId ?? '';
    await service.finalizeAndSend(docId, userId);
    res.status(200).json({ message: 'Document sent' });
  } catch (err) {
    next(err);
  }
}

/** GET /collections/:id/documents/:docId */
export async function downloadDocumentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { docId } = req.params;
    const { buffer, mimeType } = await service.getDocumentPdf(docId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${docId}.pdf"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

/** GET /collections/:id/documents */
export async function listDocumentsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const data = await service.listDocuments(id);
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// BullMQ job handlers
// =========================================================================

/**
 * Process reminder cron job (called by scheduled BullMQ job).
 */
export async function handleReminderJob(): Promise<void> {
  logger.info('Processing reminder job', {
    component: 'collections',
  });
  await service.processReminders();
  logger.info('Reminder job complete', {
    component: 'collections',
  });
}
