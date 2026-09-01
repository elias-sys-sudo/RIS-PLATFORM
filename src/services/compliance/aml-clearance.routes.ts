// =============================================================================
// AML Clearance — Routes (auth → role → validate → controller)
// =============================================================================
// Refinement: compliance_officer ONLY — not management, not auditor. The role
// gate is enforced before any controller code runs.

import { Router } from 'express';
import Joi from 'joi';
import { validate } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import {
  clearInvoiceHandler,
  listQueueHandler,
  getDetailHandler,
} from './aml-clearance.controller';

const router = Router();

// =============================================================================
// All routes require authentication + compliance_officer role.
// No supplier_id ownership filter — compliance officers see all suppliers
// (Rule 5/7 carve-out for compliance review queues).
// =============================================================================

router.use(asyncHandler(authenticateJwt));
router.use(createRoleGuard(['compliance_officer']));

// =============================================================================
// Validation schemas
// =============================================================================

const clearAmlSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    reason: Joi.string().min(10).max(2000).required(),
    sanctions_check_complete: Joi.boolean().valid(true).required(),
  }),
};

const queueIdSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /admin/aml/queue
 * List AML-flagged invoices awaiting clearance (non-PII columns only).
 */
router.get('/queue', asyncHandler(listQueueHandler));

/**
 * GET /admin/aml/queue/:id
 * Detail view — emits AML_DETAIL_VIEWED audit entry on decryption.
 */
router.get('/queue/:id', validate(queueIdSchema), asyncHandler(getDetailHandler));

/**
 * POST /admin/aml/clear/:id
 * Apply the three-column atomic clearance.
 */
router.post('/clear/:id', validate(clearAmlSchema), asyncHandler(clearInvoiceHandler));

export { router as amlClearanceRouter };
