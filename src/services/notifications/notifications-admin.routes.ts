// =============================================================================
// Notifications — Admin Routes
// =============================================================================
// Mounted at /admin/email (BEFORE the /admin router so the literal path
// wins — same pattern as /admin/aml and /admin/approvals).
//
// Restricted to management + finance_manager + compliance_officer:
//   * management — needs full visibility into platform issues
//   * finance_manager — must triage suppliers stuck pre-onboarding
//   * compliance_officer — handles supplier escalations / re-verification

import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import { listFailedVerificationsHandler } from './notifications-admin.controller';

const failedVerificationsSchema = {
  query: Joi.object({
    hours: Joi.number().integer().min(1).max(720).optional(),
  }),
  body: Joi.object({}),
};

const router = Router();

// GET /admin/email/failed-verifications — read-only ops triage
router.get(
  '/failed-verifications',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management', 'finance_manager', 'compliance_officer']),
  validate(failedVerificationsSchema),
  asyncHandler(listFailedVerificationsHandler),
);

export { router as notificationsAdminRouter };
