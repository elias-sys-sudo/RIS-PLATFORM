// =============================================================================
// Collateral — Routes (Express router + auth/role/validation middleware)
// =============================================================================

import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { validate } from '../../shared/middleware/validate';
import {
  createHandler,
  listHandler,
  getHandler,
  updateHandler,
  deleteHandler,
} from './collateral.controller';

// =========================================================================
// Joi Schemas
// =========================================================================

const createSchema = {
  body: Joi.object({
    invoice_id: Joi.string().uuid().required(),
    type: Joi.string()
      .valid(
        'bank_guarantee',
        'fixed_deposit_lien',
        'post_dated_cheque_full_value',
        'corporate_guarantee',
        'assignment_of_receivables',
        'performance_bond',
        'none',
      )
      .required(),
    description: Joi.string().max(2000).required(),
    estimated_value: Joi.number().integer().positive().required(),
    currency: Joi.string().valid('UGX').default('UGX'),
    documents: Joi.array().items(Joi.string().uuid()).default([]),
    expiry_date: Joi.string().isoDate().optional(),
  }),
};

const listSchema = {
  query: Joi.object({
    invoice_id: Joi.string().uuid().required(),
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
  }).unknown(true),
};

const idParamSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

const updateSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    type: Joi.string()
      .valid(
        'bank_guarantee',
        'fixed_deposit_lien',
        'post_dated_cheque_full_value',
        'corporate_guarantee',
        'assignment_of_receivables',
        'performance_bond',
        'none',
      )
      .optional(),
    description: Joi.string().max(2000).optional(),
    estimated_value: Joi.number().integer().positive().optional(),
    currency: Joi.string().valid('UGX').optional(),
    documents: Joi.array().items(Joi.string().uuid()).optional(),
    expiry_date: Joi.string().isoDate().allow(null).optional(),
  }).min(1),
};

// =========================================================================
// Express Router
// =========================================================================

const router = Router();

// POST /collateral — authenticated users
router.post(
  '/',
  asyncHandler(authenticateJwt),
  validate(createSchema),
  asyncHandler(createHandler),
);

// GET /collateral?invoice_id=xxx — authenticated users
router.get('/', asyncHandler(authenticateJwt), validate(listSchema), asyncHandler(listHandler));

// GET /collateral/:id — authenticated users
router.get(
  '/:id',
  asyncHandler(authenticateJwt),
  validate(idParamSchema),
  asyncHandler(getHandler),
);

// PUT /collateral/:id — authenticated users
router.put(
  '/:id',
  asyncHandler(authenticateJwt),
  validate(updateSchema),
  asyncHandler(updateHandler),
);

// PATCH /collateral/:id — alias for PUT (frontend uses PATCH)
router.patch(
  '/:id',
  asyncHandler(authenticateJwt),
  validate(updateSchema),
  asyncHandler(updateHandler),
);

// DELETE /collateral/:id — authenticated users
router.delete(
  '/:id',
  asyncHandler(authenticateJwt),
  validate(idParamSchema),
  asyncHandler(deleteHandler),
);

export { router as collateralRouter };
