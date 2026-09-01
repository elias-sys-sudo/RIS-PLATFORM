import type { Request, Response, NextFunction } from 'express';
import * as verificationService from './verification.service';
import type { BuyerConfirmationRequest, RaiseDisputeInput } from './verification.types';

/**
 * GET /verify/:token — Public confirmation page.
 * Returns invoice details for buyer to review before confirming.
 */
export async function getConfirmationPageHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = req.params;

    const data = await verificationService.getConfirmationPageData(token);

    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /verify/:token/confirm — Buyer submits confirmation.
 * All four confirmation fields must be true.
 */
export async function confirmInvoiceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = req.params;
    const confirmation = req.body as BuyerConfirmationRequest;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await verificationService.confirmInvoice(token, confirmation, ip, ua);

    res.status(200).json({
      invoiceId: result.invoiceId,
      message: 'Invoice confirmed successfully',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /verify/:token/dispute — Buyer raises a dispute.
 */
export async function raiseDisputeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = req.params;
    const input = req.body as RaiseDisputeInput;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const dispute = await verificationService.raiseDispute(token, input, ip, ua);

    res.status(201).json({
      disputeId: dispute.id,
      message: 'Dispute raised successfully',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /verify/admin/invoices/:id/resend-confirmation
 * Credit officer resends confirmation email.
 */
export async function resendConfirmationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await verificationService.resendConfirmation(id, userId, ip, ua);

    res.status(200).json({
      message: 'Confirmation email resent',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /verify/admin/invoices/pending-confirmation
 * Lists invoices awaiting buyer confirmation.
 */
export async function listPendingConfirmationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);

    const result = await verificationService.listPendingConfirmations({ page, limit });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
