import { Request, Response, NextFunction } from 'express';
import * as invoiceService from './invoices.service';
import type { InvoiceSubmission, InvoiceFilters, InvoiceBankDetailsInput } from './invoices.types';

/**
 * POST /invoices — supplier creates a new draft invoice.
 */
export async function saveDraftHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const result = await invoiceService.saveDraft(userId, req.body as InvoiceSubmission, ip, ua);
    res.status(201).json({ invoiceId: result.invoiceId, message: 'Draft saved' });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /invoices/:id — supplier updates a draft invoice.
 */
export async function updateDraftHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoiceId = req.params.id;
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const detail = await invoiceService.updateDraft(
      invoiceId,
      userId,
      req.body as Partial<InvoiceSubmission>,
      ip,
      ua,
    );
    res.status(200).json(detail);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /invoices/:id/submit — supplier submits a draft invoice through the validation chain.
 */
export async function submitDraftHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoiceId = req.params.id;
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const detail = await invoiceService.submitDraft(invoiceId, userId, ip, ua);
    res.status(200).json(detail);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /invoices/submit
 * Supplier submits an invoice through the 5-validation chain.
 */
export async function submitInvoiceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const data = req.body as InvoiceSubmission;

    const result = await invoiceService.submitInvoice(userId, data, ip, ua);

    res.status(201).json({
      invoiceId: result.invoiceId,
      message: 'Invoice submitted successfully',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /invoices
 * List invoices — supplier sees own, staff see all.
 */
export async function listInvoicesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const page = parseInt(req.query.page as string, 10) || 1;
    // Accept either page_size (canonical) or limit (legacy); cap at 100.
    const requestedSize =
      parseInt((req.query.page_size as string) ?? (req.query.limit as string), 10) || 20;
    const limit = Math.min(requestedSize, 100);

    const filters: InvoiceFilters = {};
    if (req.query.status !== undefined) {
      // Joi `.single()` keeps a single value as scalar and arrays as arrays.
      // The repository handles both — `= $1` for string, `= ANY($1::text[])` for arrays.
      filters.status = req.query.status as string | string[];
    }
    if (req.query.buyer_id !== undefined) {
      filters.buyer_id = req.query.buyer_id as string;
    }
    if (req.query.date_from !== undefined) {
      filters.date_from = req.query.date_from as string;
    }
    if (req.query.date_to !== undefined) {
      filters.date_to = req.query.date_to as string;
    }

    const result = await invoiceService.listInvoices(userId, role, filters, { page, limit });

    // Re-shape envelope so frontend Type matches: page_size + total_pages on the wire.
    res.status(200).json({
      data: result.data,
      total: result.total,
      page: result.page,
      page_size: result.limit,
      total_pages: result.totalPages,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /invoices/:id
 * Invoice detail — supplier sees own, staff see any.
 */
export async function getInvoiceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoiceId = req.params.id;
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';

    const detail = await invoiceService.getInvoiceDetail(invoiceId, userId, role);

    res.status(200).json(detail);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /invoices/:id/withdraw — supplier withdraws during cooling-off.
 */
export async function withdrawHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoiceId = req.params.id;
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { reason } = req.body as { reason: string };
    await invoiceService.withdrawInvoice(invoiceId, userId, reason, ip, ua);
    res.status(200).json({ message: 'Invoice withdrawn' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /invoices/:id/assign — G11: assign/unassign an invoice to a reviewer.
 */
export async function assignInvoiceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoiceId = req.params.id;
    const assignerUserId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const body = req.body as { user_id?: string | null };
    await invoiceService.assignInvoice(invoiceId, body.user_id ?? null, assignerUserId, ip, ua);
    res.status(200).json({ message: 'Invoice assignment updated' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /invoices/:id/bank-details — G6 post-approval capture.
 */
export async function setBankDetailsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoiceId = req.params.id;
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    await invoiceService.setInvoiceBankDetails(
      userId,
      invoiceId,
      req.body as InvoiceBankDetailsInput,
      ip,
      ua,
    );
    res.status(200).json({ message: 'Bank details captured' });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /invoices/:id/timeline
 * All audit events for this invoice (staff only).
 */
export async function getInvoiceTimelineHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoiceId = req.params.id;
    const role = req.user?.role ?? '';

    const timeline = await invoiceService.getInvoiceTimeline(invoiceId, role);

    res.status(200).json({ timeline });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /invoices/:id/documents
 * Upload a document (delivery_note / proforma_invoice / purchase_order /
 * contract) attached to this invoice. multipart/form-data: file + document_type.
 * Supplier owners + admin roles only — service layer enforces ownership.
 */
export async function uploadInvoiceDocumentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoiceId = req.params.id;
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { document_type: documentType } = req.body as { document_type?: string };

    const file = req.file;
    if (file === undefined) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'No file provided' });
      return;
    }
    if (typeof documentType !== 'string' || documentType.length === 0) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'document_type is required' });
      return;
    }

    const result = await invoiceService.uploadInvoiceDocument(
      invoiceId,
      userId,
      role,
      file,
      documentType,
      ip,
      ua,
    );

    res.status(200).json({
      documentId: result.documentId,
      message: 'Document uploaded successfully',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /invoices/:id/documents/:docId/file
 * Stream decrypted bytes of an invoice document. Inline preview by default
 * (so PDFs/images render in the dialog), never cached on intermediate proxies.
 */
export async function downloadInvoiceDocumentFileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoiceId = req.params.id;
    const docId = req.params.docId;
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';

    const result = await invoiceService.getInvoiceDocumentFile(invoiceId, docId, userId, role);

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(result.buffer.length));
    res.status(200).end(result.buffer);
  } catch (err) {
    next(err);
  }
}
