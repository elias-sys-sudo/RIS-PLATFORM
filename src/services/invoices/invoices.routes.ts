import { Router } from 'express';
import Joi from 'joi';
import multer from 'multer';
import { validate } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { invoiceSubmitRateLimiter } from '../../shared/middleware/security';
import {
  submitInvoiceHandler,
  listInvoicesHandler,
  getInvoiceHandler,
  getInvoiceTimelineHandler,
  saveDraftHandler,
  updateDraftHandler,
  submitDraftHandler,
  withdrawHandler,
  setBankDetailsHandler,
  assignInvoiceHandler,
  uploadInvoiceDocumentHandler,
  downloadInvoiceDocumentFileHandler,
} from './invoices.controller';
import {
  createHandler as collateralCreateHandler,
  listHandler as collateralListHandler,
} from '../collateral/collateral.controller';

const router = Router();

// 10 MB matches MAX_INVOICE_DOC_SIZE_BYTES in invoices.service.ts.
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// =========================================================================
// Validation schemas
// =========================================================================

const invoiceSubmissionSchema = {
  body: Joi.object({
    invoice_number: Joi.string().required().max(100),
    buyer_id: Joi.string().uuid().required(),
    face_value: Joi.number().positive().required(),
    due_date: Joi.string().isoDate().required(),
    description: Joi.string().required().max(1000),
    // G1 — URA EFRIS reference, required for e-invoice authenticity check
    ura_efris_ref: Joi.string().required().max(50),
    // G9 — optional: days supplier needs funding for, triggers reminder email
    funding_timeline_days: Joi.number().integer().positive().max(365).optional(),
  }),
};

const invoiceIdSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

const invoiceListSchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    page_size: Joi.number().integer().min(1).max(100).optional(),
    // Accept either a single status or an array — the finance_manager view
    // filters by all post-approval statuses at once via repeated `status`
    // query params, which Express parses to an array.
    status: Joi.array().items(Joi.string()).single().optional(),
    buyer_id: Joi.string().uuid().optional(),
    date_from: Joi.string().isoDate().optional(),
    date_to: Joi.string().isoDate().optional(),
    search: Joi.string().max(200).optional(),
    supplier: Joi.string().max(200).optional(),
    sort_by: Joi.string().optional(),
    sort_dir: Joi.string().valid('asc', 'desc').optional(),
  }),
};

// =========================================================================
// Routes
// =========================================================================

/**
 * POST /invoices — supplier creates a draft invoice
 */
router.post(
  '/',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier']),
  validate(invoiceSubmissionSchema),
  asyncHandler(saveDraftHandler),
);

/**
 * PUT /invoices/:id — supplier updates a draft invoice
 */
router.put(
  '/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier']),
  validate({
    params: Joi.object({ id: Joi.string().uuid().required() }),
    body: Joi.object({
      invoice_number: Joi.string().max(100).optional(),
      buyer_id: Joi.string().uuid().optional(),
      face_value: Joi.number().positive().optional(),
      due_date: Joi.string().isoDate().optional(),
      description: Joi.string().max(1000).optional(),
    }),
  }),
  asyncHandler(updateDraftHandler),
);

/**
 * POST /invoices/:id/submit — supplier submits a draft through the validation chain
 */
router.post(
  '/:id/submit',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier']),
  invoiceSubmitRateLimiter,
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
  asyncHandler(submitDraftHandler),
);

/**
 * POST /invoices/submit — supplier role only
 */
router.post(
  '/submit',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier']),
  invoiceSubmitRateLimiter,
  validate(invoiceSubmissionSchema),
  asyncHandler(submitInvoiceHandler),
);

/**
 * POST /invoices/:id/withdraw — supplier withdraws during cooling-off period
 */
router.post(
  '/:id/withdraw',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier']),
  validate({
    params: Joi.object({ id: Joi.string().uuid().required() }),
    body: Joi.object({
      reason: Joi.string().required().max(2000),
    }),
  }),
  asyncHandler(withdrawHandler),
);

/**
 * POST /invoices/:id/assign — G11 assign a reviewer. Body: { user_id: UUID | null }.
 */
router.post(
  '/:id/assign',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'finance_manager', 'management']),
  validate({
    params: Joi.object({ id: Joi.string().uuid().required() }),
    body: Joi.object({
      user_id: Joi.string().uuid().allow(null).required(),
    }),
  }),
  asyncHandler(assignInvoiceHandler),
);

/**
 * POST /invoices/:id/bank-details — G6 supplier captures bank details after approval.
 * Backend guard: service enforces status === 'approved' AND supplier_id ownership.
 */
router.post(
  '/:id/bank-details',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier']),
  validate({
    params: Joi.object({ id: Joi.string().uuid().required() }),
    body: Joi.object({
      bank_account_number: Joi.string().required().min(5).max(50),
      bank_account_name: Joi.string().required().min(2).max(255),
      bank_name: Joi.string().required().min(2).max(100),
    }),
  }),
  asyncHandler(setBankDetailsHandler),
);

/**
 * GET /invoices — supplier sees own, staff (credit_officer/finance_manager/management)
 * see all; compliance_officer + legal read-only. finance_manager needs read access
 * here so they can navigate from /payments back to invoice context during dual-auth.
 */
router.get(
  '/',
  asyncHandler(authenticateJwt),
  createRoleGuard([
    'supplier',
    'credit_officer',
    'finance_manager',
    'management',
    'compliance_officer',
    'legal',
  ]),
  validate(invoiceListSchema),
  asyncHandler(listInvoicesHandler),
);

/**
 * GET /invoices/:id — supplier sees own, staff see any; compliance + legal read-only.
 * finance_manager included so the dual-auth flow can deep-link from
 * /payments/:id back to the underlying /invoices/:id detail page.
 */
router.get(
  '/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard([
    'supplier',
    'credit_officer',
    'finance_manager',
    'management',
    'compliance_officer',
    'legal',
  ]),
  validate(invoiceIdSchema),
  asyncHandler(getInvoiceHandler),
);

/**
 * GET /invoices/:id/timeline — staff only
 */
router.get(
  '/:id/timeline',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management', 'compliance_officer', 'auditor']),
  validate(invoiceIdSchema),
  asyncHandler(getInvoiceTimelineHandler),
);

// =========================================================================
// Nested collateral routes: /invoices/:invoiceId/collateral
// Delegates to collateral controller, injecting invoice_id from params.
// =========================================================================

const collateralListInvoiceSchema = {
  params: Joi.object({ invoiceId: Joi.string().uuid().required() }),
};

const collateralCreateInvoiceSchema = {
  params: Joi.object({ invoiceId: Joi.string().uuid().required() }),
  body: Joi.object({
    type: Joi.string().required(),
    description: Joi.string().max(2000).required(),
    estimated_value: Joi.number().integer().positive().required(),
    expiry_date: Joi.string().isoDate().optional(),
  }),
};

/**
 * GET /invoices/:invoiceId/collateral
 * Injects invoice_id into query so the collateral listHandler can find it.
 */
router.get(
  '/:invoiceId/collateral',
  asyncHandler(authenticateJwt),
  validate(collateralListInvoiceSchema),
  asyncHandler(async (req, res, next) => {
    req.query.invoice_id = req.params.invoiceId;
    return collateralListHandler(req, res, next);
  }),
);

/**
 * POST /invoices/:invoiceId/collateral
 * Injects invoice_id into body so the collateral createHandler can find it.
 */
router.post(
  '/:invoiceId/collateral',
  asyncHandler(authenticateJwt),
  validate(collateralCreateInvoiceSchema),
  asyncHandler(async (req, res, next) => {
    (req.body as Record<string, unknown>).invoice_id = req.params.invoiceId;
    return collateralCreateHandler(req, res, next);
  }),
);

// =========================================================================
// Invoice document upload
// =========================================================================

const invoiceDocUploadParamsSchema = {
  params: Joi.object({ id: Joi.string().uuid().required() }),
};

const invoiceDocBodySchema = {
  body: Joi.object({
    document_type: Joi.string()
      .valid('tax_invoice', 'proforma_invoice', 'purchase_order', 'delivery_note', 'contract')
      .required(),
  }),
};

/**
 * POST /invoices/:id/documents — supplier owners + admin roles
 * multipart/form-data: file + document_type. Multer parses the file before
 * the body-validation middleware runs.
 */
router.post(
  '/:id/documents',
  asyncHandler(authenticateJwt),
  validate(invoiceDocUploadParamsSchema),
  documentUpload.single('file'),
  validate(invoiceDocBodySchema),
  asyncHandler(uploadInvoiceDocumentHandler),
);

const invoiceDocFileParamsSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
    docId: Joi.string().uuid().required(),
  }),
};

/**
 * GET /invoices/:id/documents/:docId/file — stream decrypted bytes for inline
 * preview / download. Supplier owners + staff/oversight roles. Service layer
 * enforces both ownership (for suppliers) and (id, invoice_id) scope, AND
 * narrows the role set via VIEWER_ROLES. finance_manager included so
 * dual-auth signers can view supporting docs (delivery notes, invoices) before
 * authorising payment.
 */
router.get(
  '/:id/documents/:docId/file',
  asyncHandler(authenticateJwt),
  createRoleGuard([
    'supplier',
    'credit_officer',
    'finance_manager',
    'management',
    'compliance_officer',
    'legal',
    'auditor',
  ]),
  validate(invoiceDocFileParamsSchema),
  asyncHandler(downloadInvoiceDocumentFileHandler),
);

export { router as invoicesRouter };
