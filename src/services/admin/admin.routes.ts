import { Router } from 'express';
import Joi from 'joi';
import { validate } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { adminIpAllowlist } from '../../shared/middleware/admin-ip-allowlist';
import {
  listUsersHandler,
  createUserHandler,
  updateUserHandler,
  listRiskConfigHandler,
  updateRiskConfigHandler,
} from './admin.controller';

const router = Router();

const VALID_ROLES = [
  'supplier',
  'credit_officer',
  'finance_manager',
  'management',
  'compliance_officer',
  'auditor',
  'legal',
];

// All admin routes require authentication + management role + IP allowlist
router.use(asyncHandler(authenticateJwt));
router.use(createRoleGuard(['management']));
router.use(adminIpAllowlist);

// =============================================================================
// User Management Schemas
// =============================================================================

const listUsersSchema = {
  query: Joi.object({
    search: Joi.string().max(255).optional().allow(''),
    page: Joi.number().integer().min(1).default(1),
    page_size: Joi.number().integer().min(1).max(100).default(20),
  }),
};

const createUserSchema = {
  body: Joi.object({
    name: Joi.string().min(1).max(255).required(),
    email: Joi.string().email().required().max(255),
    role: Joi.string()
      .valid(...VALID_ROLES)
      .required(),
  }),
};

const updateUserSchema = {
  params: Joi.object({
    userId: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    role: Joi.string()
      .valid(...VALID_ROLES)
      .optional(),
    status: Joi.string().valid('active', 'inactive').optional(),
  }).min(1),
};

// =============================================================================
// Risk Config Schemas
// =============================================================================

const updateRiskConfigSchema = {
  params: Joi.object({
    key: Joi.string().max(100).required(),
  }),
  body: Joi.object({
    value: Joi.number().required(),
  }),
};

// =============================================================================
// User Management Routes
// =============================================================================

/**
 * GET /admin/users
 * Paginated user list with optional email search.
 */
router.get('/users', validate(listUsersSchema), asyncHandler(listUsersHandler));

/**
 * POST /admin/users
 * Create a new user with a temporary password.
 */
router.post('/users', validate(createUserSchema), asyncHandler(createUserHandler));

/**
 * PATCH /admin/users/:userId
 * Update a user's role and/or status.
 */
router.patch('/users/:userId', validate(updateUserSchema), asyncHandler(updateUserHandler));

// =============================================================================
// Risk Config Routes
// =============================================================================

/**
 * GET /admin/risk-config
 * List all risk config entries.
 */
router.get('/risk-config', asyncHandler(listRiskConfigHandler));

/**
 * PUT /admin/risk-config/:key
 * Update a risk config value.
 */
router.put(
  '/risk-config/:key',
  validate(updateRiskConfigSchema),
  asyncHandler(updateRiskConfigHandler),
);

export { router as adminRouter };
