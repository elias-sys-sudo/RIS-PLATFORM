import { Request, Response, NextFunction } from 'express';
import * as onboardingService from './onboarding.service';
import type {
  SupplierRegistration,
  KycStatusUpdate,
  BuyerCreation,
  BuyerUpdate,
  EligibilityCheckInput,
  CreateBuyerRequestInput,
  ReviewBuyerRequestInput,
  CreateUboInput,
} from './onboarding.types';

/**
 * POST /eligibility/check
 * Public — run pre-qualification questionnaire before registration.
 */
export async function checkEligibilityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = req.body as EligibilityCheckInput;
    const ip = req.ip ?? 'unknown';

    const result = await onboardingService.checkEligibility(data, ip);

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /admin/suppliers/:id/ursb-verify
 * Record URSB company verification outcome (compliance_officer, management).
 */
export async function ursbVerifyHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.params.id;
    const { verified } = req.body as { verified: boolean };
    const reviewerId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await onboardingService.recordUrsbVerification(supplierId, verified, reviewerId, ip, ua);

    res.status(200).json({ message: 'URSB verification recorded' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /admin/suppliers/:id/litigation-check
 * Record litigation screening outcome (compliance_officer, management).
 */
export async function litigationCheckHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.params.id;
    const { flag } = req.body as { flag: boolean };
    const reviewerId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await onboardingService.recordLitigationCheck(supplierId, flag, reviewerId, ip, ua);

    res.status(200).json({ message: 'Litigation check recorded' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /suppliers/register
 * Public — creates supplier account + profile.
 */
export async function registerSupplierHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = req.body as SupplierRegistration;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await onboardingService.registerSupplier(data, ip, ua);

    res.status(201).json({
      userId: result.userId,
      supplierId: result.supplierId,
      message: 'Supplier registered successfully',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /suppliers/:id
 * Supplier sees own, staff see any.
 */
export async function getSupplierHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.params.id;
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';

    const profile = await onboardingService.getSupplierProfile(supplierId, userId, role);

    res.status(200).json(profile);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /suppliers/:id/kyc
 * Read aggregate KYC status + documents for the KYC page (supplier own,
 * review-roles any). Read-only — no audit log.
 */
export async function getSupplierKycStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.params.id;
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';

    const status = await onboardingService.getSupplierKycStatus(supplierId, userId, role);

    res.status(200).json(status);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /suppliers/:id/documents
 * Upload document (supplier own only, staff any).
 */
export async function uploadDocumentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.params.id;
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { document_type: documentType } = req.body as { document_type: string };

    const file = req.file;
    if (file === undefined) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'No file provided',
      });
      return;
    }

    const result = await onboardingService.uploadDocument(
      supplierId,
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
 * GET /suppliers/:id/documents/:docId/file
 * Stream the decrypted bytes of a single uploaded KYC document. Suppliers
 * see their own; admin/auditor roles see any. Inline preview by default
 * (so PDFs/images render in the dialog), never cached on intermediate
 * proxies (PII).
 */
export async function downloadDocumentFileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.params.id;
    const docId = req.params.docId;
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';

    const result = await onboardingService.getSupplierDocumentFile(supplierId, docId, userId, role);

    // Quote the filename to be safe with non-ASCII / spaces, mirroring the
    // RFC 6266 "inline" content disposition. nosniff to stop browsers from
    // second-guessing the Content-Type we set explicitly. private+no-store
    // so PII never lands in any shared cache.
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

/**
 * PUT /admin/suppliers/:id/documents/:docId/review
 * Approve or reject a single KYC document. Reviewer roles only
 * (credit_officer / compliance_officer / management). Maker-checker:
 * reviewer must not be the uploader.
 */
export async function reviewDocumentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.params.id;
    const docId = req.params.docId;
    const reviewerId = req.user?.userId ?? '';
    const reviewerRole = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const body = req.body as { decision?: string; comments?: string };
    await onboardingService.reviewSupplierDocument(
      supplierId,
      docId,
      {
        decision: body.decision as 'approved' | 'rejected',
        comments: body.comments ?? '',
      },
      reviewerId,
      reviewerRole,
      ip,
      ua,
    );

    res.status(200).json({ message: 'Document review recorded' });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /suppliers/:id/documents
 * List documents (supplier own, staff any).
 */
export async function listDocumentsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.params.id;
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';

    const documents = await onboardingService.listDocuments(supplierId, userId, role);

    res.status(200).json({ documents });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /admin/suppliers/:id/kyc-status
 * Update KYC status (credit_officer, compliance_officer).
 */
export async function updateKycStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.params.id;
    const reviewerId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const update = req.body as KycStatusUpdate;

    await onboardingService.updateKycStatus(supplierId, update, reviewerId, ip, ua);

    res.status(200).json({ message: 'KYC status updated' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /admin/suppliers/:id/feedback — Checkers §5b.
 * Staff sends a free-text feedback message to the supplier. Emails the
 * supplier and writes an audit entry. Does not change KYC status.
 */
export async function sendSupplierFeedbackHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.params.id;
    const reviewerId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';
    const { message } = req.body as { message: string };
    await onboardingService.sendSupplierFeedback(supplierId, reviewerId, message, ip, ua);
    res.status(200).json({ message: 'Feedback sent to supplier' });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/suppliers
 * List all suppliers (credit_officer, compliance_officer, management).
 */
export async function listSuppliersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const kycStatus = req.query.kyc_status as string | undefined;

    const result = await onboardingService.listSuppliersForStaff({ page, limit }, kycStatus);

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /admin/buyers
 * Create buyer (credit_officer only).
 */
export async function createBuyerHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = req.body as BuyerCreation;
    const createdBy = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await onboardingService.createBuyer(data, createdBy, ip, ua);

    res.status(201).json({
      buyerId: result.buyerId,
      message: 'Buyer created successfully',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/buyers
 * List buyers (credit_officer, management).
 */
export async function listBuyersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);

    const result = await onboardingService.listBuyersForStaff({ page, limit });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/buyers/:id
 * Buyer detail (credit_officer, management).
 */
export async function getBuyerHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const buyerId = req.params.id;
    const profile = await onboardingService.getBuyerProfile(buyerId);
    res.status(200).json(profile);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /admin/buyers/:id
 * Update buyer (credit_officer only).
 */
export async function updateBuyerHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const buyerId = req.params.id;
    const data = req.body as BuyerUpdate;
    const updatedBy = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await onboardingService.updateBuyerProfile(buyerId, data, updatedBy, ip, ua);

    res.status(200).json({ message: 'Buyer updated successfully' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /buyer-requests
 * Supplier requests buyer onboarding.
 */
export async function createBuyerRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.user?.userId ?? '';
    const data = req.body as CreateBuyerRequestInput;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await onboardingService.createBuyerOnboardingRequest(supplierId, data, ip, ua);

    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /admin/buyer-requests/:id
 * Credit officer reviews a buyer onboarding request.
 */
export async function reviewBuyerRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const requestId = req.params.id;
    const reviewerId = req.user?.userId ?? '';
    const data = req.body as ReviewBuyerRequestInput;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await onboardingService.reviewBuyerOnboardingRequest(requestId, reviewerId, data, ip, ua);

    res.status(200).json({ data: { success: true } });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/buyer-requests
 * List buyer requests for staff review.
 */
export async function listBuyerRequestsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const status = req.query.status as string | undefined;

    const result = await onboardingService.listBuyerOnboardingRequestsForReview({
      page,
      limit,
      status,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /buyer-requests/mine
 * Supplier lists their own buyer requests.
 */
export async function listSupplierBuyerRequestsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.user?.userId ?? '';
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);

    const result = await onboardingService.listSupplierBuyerRequests(supplierId, { page, limit });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// Beneficial Ownership (UBO) handlers
// =========================================================================

/**
 * POST /suppliers/:supplier_id/beneficial-owners
 */
export async function createUboHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.params.supplier_id;
    const data = req.body as CreateUboInput;
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await onboardingService.addBeneficialOwner(supplierId, data, userId, ip, ua);

    res.status(201).json({ uboId: result.uboId, message: 'Beneficial owner added' });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /suppliers/:supplier_id/beneficial-owners
 */
export async function listUbosHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const supplierId = req.params.supplier_id;

    const owners = await onboardingService.listBeneficialOwners(supplierId);

    res.status(200).json({ beneficialOwners: owners });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /suppliers/:supplier_id/beneficial-owners/:ubo_id
 */
export async function updateUboHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { supplier_id: supplierId, ubo_id: uboId } = req.params;
    const data = req.body as CreateUboInput;
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await onboardingService.updateBeneficialOwner(uboId, supplierId, data, userId, ip, ua);

    res.status(200).json({ message: 'Beneficial owner updated' });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /suppliers/:supplier_id/beneficial-owners/:ubo_id
 */
export async function deleteUboHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { supplier_id: supplierId, ubo_id: uboId } = req.params;
    const userId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await onboardingService.removeBeneficialOwner(uboId, supplierId, userId, ip, ua);

    res.status(200).json({ message: 'Beneficial owner removed' });
  } catch (err) {
    next(err);
  }
}
