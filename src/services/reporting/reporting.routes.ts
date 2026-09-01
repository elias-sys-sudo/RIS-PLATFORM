// =============================================================================
// Reporting — Routes (Express router + auth/role middleware)
// =============================================================================

import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import {
  portfolioHandler,
  agingHandler,
  buyerExposureHandler,
  profitHandler,
  facilityHandler,
  auditExportHandler,
  regulatoryHandler,
  applicationsReceivedHandler,
  applicationsPipelineHandler,
  applicationsIncompleteHandler,
  companyPlHandler,
  disbursedFundsHandler,
} from './reporting.controller';

// =========================================================================
// Joi Schemas (query string validation)
// =========================================================================

const dateRangeSchema = {
  query: Joi.object({
    startDate: Joi.string().isoDate().optional(),
    endDate: Joi.string().isoDate().optional(),
    buyerId: Joi.string().uuid().optional(),
    status: Joi.string().optional(),
  }).unknown(true),
};

const auditExportSchema = {
  query: Joi.object({
    startDate: Joi.string().isoDate().optional(),
    endDate: Joi.string().isoDate().optional(),
    userId: Joi.string().uuid().optional(),
    actionType: Joi.string().optional(),
    format: Joi.string().valid('csv', 'json').optional(),
  }).unknown(true),
};

// =========================================================================
// Express Router
// =========================================================================

const router = Router();

// GET /reports/portfolio — management, auditor, legal (read-only)
router.get(
  '/portfolio',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management', 'auditor', 'legal']),
  validate(dateRangeSchema),
  asyncHandler(portfolioHandler),
);

// GET /reports/aging — credit_officer, management, auditor, legal (read-only)
router.get(
  '/aging',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management', 'auditor', 'legal']),
  validate(dateRangeSchema),
  asyncHandler(agingHandler),
);

// GET /reports/buyer-exposure — credit_officer, management
router.get(
  '/buyer-exposure',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management']),
  validate(dateRangeSchema),
  asyncHandler(buyerExposureHandler),
);

// GET /reports/profit — finance_manager, management
router.get(
  '/profit',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager', 'management']),
  validate(dateRangeSchema),
  asyncHandler(profitHandler),
);

// GET /reports/facilities — finance_manager, management
router.get(
  '/facilities',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager', 'management']),
  validate(dateRangeSchema),
  asyncHandler(facilityHandler),
);

// GET /reports/audit-export — auditor, legal (read-only)
router.get(
  '/audit-export',
  asyncHandler(authenticateJwt),
  createRoleGuard(['auditor', 'legal']),
  validate(auditExportSchema),
  asyncHandler(auditExportHandler),
);

// GET /reports/regulatory — compliance_officer, management, legal (read-only)
router.get(
  '/regulatory',
  asyncHandler(authenticateJwt),
  createRoleGuard(['compliance_officer', 'management', 'legal']),
  validate(dateRangeSchema),
  asyncHandler(regulatoryHandler),
);

// GET /reports/applications-received — management, credit_officer, auditor
router.get(
  '/applications-received',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management', 'credit_officer', 'auditor']),
  validate(dateRangeSchema),
  asyncHandler(applicationsReceivedHandler),
);

// GET /reports/applications-pipeline — management, credit_officer, compliance_officer
router.get(
  '/applications-pipeline',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management', 'credit_officer', 'compliance_officer']),
  asyncHandler(applicationsPipelineHandler),
);

// GET /reports/applications-incomplete — management, credit_officer, compliance_officer
router.get(
  '/applications-incomplete',
  asyncHandler(authenticateJwt),
  createRoleGuard(['management', 'credit_officer', 'compliance_officer']),
  asyncHandler(applicationsIncompleteHandler),
);

// GET /reports/company-pl — finance_manager, management
router.get(
  '/company-pl',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager', 'management']),
  validate(dateRangeSchema),
  asyncHandler(companyPlHandler),
);

// GET /reports/disbursed-funds — finance_manager, management, auditor
router.get(
  '/disbursed-funds',
  asyncHandler(authenticateJwt),
  createRoleGuard(['finance_manager', 'management', 'auditor']),
  validate(dateRangeSchema),
  asyncHandler(disbursedFundsHandler),
);

export { router as reportingRouter };
