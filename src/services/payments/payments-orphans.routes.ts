// =============================================================================
// Payments — Orphaned Approved Invoices Routes
// =============================================================================
// Mounted at /admin/approvals/orphans (BEFORE the /admin router so the literal
// path wins over the param-matching admin handler — same pattern as /admin/aml).

import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import { listOrphans } from './payments-orphans.controller';

const emptyOrphansSchema = {
  body: Joi.object({}),
  query: Joi.object({}),
};

const router = Router();

// GET /admin/approvals/orphans — management / finance_manager (read-only)
router.get(
  '/orphans',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management', 'finance_manager']),
  validate(emptyOrphansSchema),
  asyncHandler(listOrphans),
);

export { router as orphansRouter };
