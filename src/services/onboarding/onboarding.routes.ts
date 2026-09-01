import { Router } from 'express';
import Joi from 'joi';
import multer from 'multer';
import { validate } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import {
  documentUploadRateLimiter,
  eligibilityRateLimiter,
  registrationRateLimiter,
} from '../../shared/middleware/security';
import { PASSWORD_REGEX } from '../auth/auth.service';
import {
  checkEligibilityHandler,
  registerSupplierHandler,
  getSupplierHandler,
  getSupplierKycStatusHandler,
  uploadDocumentHandler,
  listDocumentsHandler,
  downloadDocumentFileHandler,
  updateKycStatusHandler,
  sendSupplierFeedbackHandler,
  listSuppliersHandler,
  createBuyerHandler,
  listBuyersHandler,
  getBuyerHandler,
  updateBuyerHandler,
  ursbVerifyHandler,
  litigationCheckHandler,
  createBuyerRequestHandler,
  reviewBuyerRequestHandler,
  listBuyerRequestsHandler,
  listSupplierBuyerRequestsHandler,
  createUboHandler,
  listUbosHandler,
  updateUboHandler,
  deleteUboHandler,
  reviewDocumentHandler,
} from './onboarding.controller';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// =========================================================================
// Validation schemas
// =========================================================================

const eligibilityCheckSchema = {
  body: Joi.object({
    registered_company: Joi.boolean().required(),
    authorized_person: Joi.boolean().required(),
    // D1 — bucket string from the dropdown (or legacy raw number for back-compat).
    years_in_business: Joi.alternatives()
      .try(Joi.string().valid('0-1', '2-5', '6-10', '10+'), Joi.number().integer().min(0).max(200))
      .required(),
    // G8 — revenue over the past 2 years (was a single annual_revenue).
    revenue_year1: Joi.number().integer().min(0).optional(),
    revenue_year2: Joi.number().integer().min(0).optional(),
    funding_requirement: Joi.number().integer().min(0).optional(),
    // REQ-ELIG-006 — drives the 30-day re-attempt throttle when supplied.
    email: Joi.string().email().max(255).optional(),
  }),
};

const supplierRegistrationSchema = {
  body: Joi.object({
    email: Joi.string().email().required().max(255),
    password: Joi.string().required().min(8).max(128).pattern(PASSWORD_REGEX).messages({
      'string.pattern.base':
        'Password must include uppercase, lowercase, number, and special character',
    }),
    company_name: Joi.string().required().max(255),
    registration_number: Joi.string().required().max(100),
    tax_id: Joi.string().required().max(100),
    directors: Joi.array()
      .items(
        Joi.object({
          name: Joi.string().required().max(255),
          id_type: Joi.string().required().max(50),
          id_number: Joi.string().required().max(100),
        }),
      )
      .min(1)
      .required(),
    bank_name: Joi.string().required().max(255),
    bank_account_number: Joi.string().required().max(50),
    bank_account_name: Joi.string().required().max(255),
    bank_branch: Joi.string().required().max(255),
    preferred_payment_method: Joi.string().valid('EFT').required(),
    eligibility_session_token: Joi.string().uuid().required(),
    consent_ursb_check: Joi.boolean().valid(true).required(),
    consent_supplier_refs: Joi.boolean().valid(true).required(),
    consent_litigation_check: Joi.boolean().valid(true).required(),
    // G3: optional free-text declaration of any known ongoing litigation.
    // Empty string allowed (supplier has nothing to disclose).
    litigation_disclosure: Joi.string().max(2000).optional().allow(''),
    required_financing_amount: Joi.number().integer().min(1_000_000).max(10_000_000_000).optional(),
  }),
};

const ursbVerifySchema = {
  params: Joi.object({ id: Joi.string().uuid().required() }),
  body: Joi.object({ verified: Joi.boolean().required() }),
};

const litigationCheckSchema = {
  params: Joi.object({ id: Joi.string().uuid().required() }),
  body: Joi.object({ flag: Joi.boolean().required() }),
};

const documentUploadSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

const documentBodySchema = {
  body: Joi.object({
    // Aligned with the 8 KycDocumentType values the frontend's KYC page
    // sends — matches the UI labels: Certificate of Incorporation,
    // Directors & Shareholders, Tax Registration (TIN), Bank Account
    // Details, Signed RIS Supplier Agreement, Board Resolution,
    // Director ID Document, Additional.
    document_type: Joi.string()
      .valid(
        'certificate_of_incorporation',
        'directors_shareholders',
        'tax_registration',
        'bank_account_details',
        'supplier_agreement',
        'board_resolution',
        'id_document',
        'additional',
      )
      .required(),
  }),
};

const supplierIdSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

const documentDownloadSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
    docId: Joi.string().uuid().required(),
  }),
};

const kycStatusSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    status: Joi.string()
      .valid('pending', 'documents_submitted', 'under_review', 'approved', 'rejected')
      .required(),
    comments: Joi.string().required().min(10).max(2000),
  }),
};

const documentReviewSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
    docId: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    decision: Joi.string().valid('approved', 'rejected').required(),
    // Comments required on rejection (so the supplier knows what to fix);
    // optional on approval but enforce a sensible upper bound either way.
    comments: Joi.string()
      .max(2000)
      .when('decision', {
        is: 'rejected',
        then: Joi.string().min(1).required(),
        otherwise: Joi.string().allow('').optional(),
      }),
  }),
};

const buyerCreationSchema = {
  body: Joi.object({
    company_name: Joi.string().required().max(255),
    registration_number: Joi.string().required().max(100),
    credit_rating: Joi.string().valid('A', 'B', 'C', 'D').required(),
    approved_limit: Joi.number().integer().positive().required(),
    payment_score: Joi.number().integer().min(0).max(100).required(),
    contact_email: Joi.string().email().required().max(255),
    contact_phone: Joi.string().required().max(20),
    ris_margin_rate: Joi.number().min(0).max(1).optional(),
  }),
};

const buyerIdSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

const buyerUpdateSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    company_name: Joi.string().max(255).optional(),
    credit_rating: Joi.string().valid('A', 'B', 'C', 'D').optional(),
    approved_limit: Joi.number().integer().positive().optional(),
    payment_score: Joi.number().integer().min(0).max(100).optional(),
    contact_email: Joi.string().email().max(255).optional(),
    contact_phone: Joi.string().max(20).optional(),
    ris_margin_rate: Joi.number().min(0).max(1).optional(),
    is_active: Joi.boolean().optional(),
  }).min(1),
};

// =========================================================================
// Eligibility pre-qualification
// =========================================================================

/**
 * POST /eligibility/check — public
 */
router.post(
  '/eligibility/check',
  eligibilityRateLimiter,
  validate(eligibilityCheckSchema),
  asyncHandler(checkEligibilityHandler),
);

// =========================================================================
// Supplier routes
// =========================================================================

/**
 * POST /suppliers/register — public
 */
router.post(
  '/suppliers/register',
  registrationRateLimiter,
  validate(supplierRegistrationSchema),
  asyncHandler(registerSupplierHandler),
);

/**
 * GET /suppliers/:id — authenticated, ownership enforced in service
 */
router.get(
  '/suppliers/:id',
  asyncHandler(authenticateJwt),
  validate(supplierIdSchema),
  asyncHandler(getSupplierHandler),
);

/**
 * GET /suppliers/:id/kyc — authenticated, ownership/role enforced in service.
 * Returns aggregate KYC status + documents for the KYC page.
 */
router.get(
  '/suppliers/:id/kyc',
  asyncHandler(authenticateJwt),
  validate(supplierIdSchema),
  asyncHandler(getSupplierKycStatusHandler),
);

/**
 * POST /suppliers/:id/documents — authenticated, ownership in service
 */
router.post(
  '/suppliers/:id/documents',
  asyncHandler(authenticateJwt),
  documentUploadRateLimiter,
  validate(documentUploadSchema),
  upload.single('file'),
  validate(documentBodySchema),
  asyncHandler(uploadDocumentHandler),
);

/**
 * GET /suppliers/:id/documents — authenticated, ownership in service
 */
router.get(
  '/suppliers/:id/documents',
  asyncHandler(authenticateJwt),
  validate(supplierIdSchema),
  asyncHandler(listDocumentsHandler),
);

/**
 * GET /suppliers/:id/documents/:docId/file — authenticated, ownership/role
 * enforced in service. Streams the decrypted KYC document bytes back for
 * inline preview (PDF/JPEG/PNG). Never cached upstream (PII).
 */
router.get(
  '/suppliers/:id/documents/:docId/file',
  asyncHandler(authenticateJwt),
  validate(documentDownloadSchema),
  asyncHandler(downloadDocumentFileHandler),
);

// =========================================================================
// Admin supplier routes
// =========================================================================

/**
 * PUT /admin/suppliers/:id/kyc-status — credit_officer, compliance_officer
 */
router.put(
  '/admin/suppliers/:id/kyc-status',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'compliance_officer']),
  validate(kycStatusSchema),
  asyncHandler(updateKycStatusHandler),
);

/**
 * PUT /admin/suppliers/:id/documents/:docId/review — per-document review
 * (approve / reject). Reviewer roles only. Maker-checker enforcement
 * (uploader != reviewer) lives in the service layer.
 */
router.put(
  '/admin/suppliers/:id/documents/:docId/review',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'compliance_officer', 'management']),
  validate(documentReviewSchema),
  asyncHandler(reviewDocumentHandler),
);

/**
 * POST /admin/suppliers/:id/feedback — Checkers §5b: staff sends free-text
 * feedback to the supplier outside of approve/reject.
 */
router.post(
  '/admin/suppliers/:id/feedback',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'compliance_officer', 'management']),
  validate({
    params: Joi.object({ id: Joi.string().uuid().required() }),
    body: Joi.object({
      message: Joi.string().min(10).max(2000).required(),
    }),
  }),
  asyncHandler(sendSupplierFeedbackHandler),
);

/**
 * POST /admin/suppliers/:id/ursb-verify — compliance_officer, management
 */
router.post(
  '/admin/suppliers/:id/ursb-verify',
  asyncHandler(authenticateJwt),
  createRoleGuard(['compliance_officer', 'management']),
  validate(ursbVerifySchema),
  asyncHandler(ursbVerifyHandler),
);

/**
 * POST /admin/suppliers/:id/litigation-check — compliance_officer, management
 */
router.post(
  '/admin/suppliers/:id/litigation-check',
  asyncHandler(authenticateJwt),
  createRoleGuard(['compliance_officer', 'management']),
  validate(litigationCheckSchema),
  asyncHandler(litigationCheckHandler),
);

/**
 * GET /admin/suppliers — credit_officer, compliance_officer, management, legal (read-only)
 */
router.get(
  '/admin/suppliers',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'compliance_officer', 'management', 'legal']),
  asyncHandler(listSuppliersHandler),
);

// =========================================================================
// Admin buyer routes
// =========================================================================

/**
 * POST /admin/buyers — credit_officer only
 */
router.post(
  '/admin/buyers',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer']),
  validate(buyerCreationSchema),
  asyncHandler(createBuyerHandler),
);

/**
 * GET /admin/buyers — credit_officer, management, legal (read-only)
 */
router.get(
  '/admin/buyers',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management', 'legal']),
  asyncHandler(listBuyersHandler),
);

/**
 * GET /admin/buyers/:id — credit_officer, management, legal (read-only)
 */
router.get(
  '/admin/buyers/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management', 'legal']),
  validate(buyerIdSchema),
  asyncHandler(getBuyerHandler),
);

/**
 * PUT /admin/buyers/:id — credit_officer only
 */
router.put(
  '/admin/buyers/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer']),
  validate(buyerUpdateSchema),
  asyncHandler(updateBuyerHandler),
);

// =========================================================================
// Buyer onboarding request schemas
// =========================================================================

const createBuyerRequestSchema = {
  body: Joi.object({
    company_name: Joi.string().max(255).required(),
    registration_number: Joi.string().max(100).optional(),
    contact_name: Joi.string().max(255).optional(),
    contact_email: Joi.string().email().optional(),
    contact_phone: Joi.string().max(20).optional(),
    reason: Joi.string().min(10).max(1000).required(),
  }),
};

const reviewBuyerRequestSchema = {
  params: Joi.object({ id: Joi.string().uuid().required() }),
  body: Joi.object({
    status: Joi.string().valid('approved', 'rejected').required(),
    reviewer_comments: Joi.string().max(1000).optional(),
    linked_buyer_id: Joi.string().uuid().optional(),
  }),
};

// =========================================================================
// Buyer onboarding request routes (Stage 4)
// =========================================================================

/**
 * POST /buyer-requests — supplier requests buyer onboarding
 */
router.post(
  '/buyer-requests',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier']),
  validate(createBuyerRequestSchema),
  asyncHandler(createBuyerRequestHandler),
);

/**
 * GET /buyer-requests/mine — supplier lists own requests
 */
router.get(
  '/buyer-requests/mine',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier']),
  asyncHandler(listSupplierBuyerRequestsHandler),
);

/**
 * GET /admin/buyer-requests — credit_officer, management review list
 */
router.get(
  '/admin/buyer-requests',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management']),
  asyncHandler(listBuyerRequestsHandler),
);

/**
 * PUT /admin/buyer-requests/:id — credit_officer reviews request
 */
router.put(
  '/admin/buyer-requests/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer']),
  validate(reviewBuyerRequestSchema),
  asyncHandler(reviewBuyerRequestHandler),
);

// =========================================================================
// Beneficial Ownership (UBO) schemas
// =========================================================================

const createUboSchema = {
  params: Joi.object({ supplier_id: Joi.string().uuid().required() }),
  body: Joi.object({
    full_name: Joi.string().required().max(255),
    nationality: Joi.string().required().max(100),
    id_type: Joi.string().required().max(50),
    id_number: Joi.string().required().max(100),
    ownership_percentage: Joi.number().greater(0).max(100).required(),
    is_pep: Joi.boolean().required(),
  }),
};

const updateUboSchema = {
  params: Joi.object({
    supplier_id: Joi.string().uuid().required(),
    ubo_id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    full_name: Joi.string().required().max(255),
    nationality: Joi.string().required().max(100),
    id_type: Joi.string().required().max(50),
    id_number: Joi.string().required().max(100),
    ownership_percentage: Joi.number().greater(0).max(100).required(),
    is_pep: Joi.boolean().required(),
  }),
};

const uboSupplierIdSchema = {
  params: Joi.object({ supplier_id: Joi.string().uuid().required() }),
};

const deleteUboSchema = {
  params: Joi.object({
    supplier_id: Joi.string().uuid().required(),
    ubo_id: Joi.string().uuid().required(),
  }),
};

// =========================================================================
// Beneficial Ownership (UBO) routes
// =========================================================================

/**
 * POST /suppliers/:supplier_id/beneficial-owners — supplier, compliance_officer
 */
router.post(
  '/suppliers/:supplier_id/beneficial-owners',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier', 'compliance_officer']),
  validate(createUboSchema),
  asyncHandler(createUboHandler),
);

/**
 * GET /suppliers/:supplier_id/beneficial-owners — supplier, compliance_officer, management, auditor
 */
router.get(
  '/suppliers/:supplier_id/beneficial-owners',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier', 'compliance_officer', 'management', 'auditor']),
  validate(uboSupplierIdSchema),
  asyncHandler(listUbosHandler),
);

/**
 * PUT /suppliers/:supplier_id/beneficial-owners/:ubo_id — supplier, compliance_officer
 */
router.put(
  '/suppliers/:supplier_id/beneficial-owners/:ubo_id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier', 'compliance_officer']),
  validate(updateUboSchema),
  asyncHandler(updateUboHandler),
);

/**
 * DELETE /suppliers/:supplier_id/beneficial-owners/:ubo_id — supplier, compliance_officer
 */
router.delete(
  '/suppliers/:supplier_id/beneficial-owners/:ubo_id',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier', 'compliance_officer']),
  validate(deleteUboSchema),
  asyncHandler(deleteUboHandler),
);

export { router as onboardingRouter };
