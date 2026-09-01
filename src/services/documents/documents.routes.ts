// =============================================================================
// Documents — Routes (Express router + auth/validation middleware)
// =============================================================================

import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { validate } from '../../shared/middleware/validate';
import { downloadHandler, addCommentHandler, listCommentsHandler } from './documents.controller';

// =========================================================================
// Joi Schemas
// =========================================================================

const documentIdSchema = {
  params: Joi.object({
    document_id: Joi.string().uuid().required(),
  }),
};

const addCommentSchema = {
  params: Joi.object({ document_id: Joi.string().uuid().required() }),
  body: Joi.object({ comment_text: Joi.string().min(5).max(2000).required() }),
};

// =========================================================================
// Express Router
// =========================================================================

const router = Router();

// GET /documents/:document_id/download — any authenticated user
router.get(
  '/:document_id/download',
  asyncHandler(authenticateJwt),
  validate(documentIdSchema),
  asyncHandler(downloadHandler),
);

// POST /documents/:document_id/comments — any authenticated user (access enforced in service)
router.post(
  '/:document_id/comments',
  asyncHandler(authenticateJwt),
  validate(addCommentSchema),
  asyncHandler(addCommentHandler),
);

// GET /documents/:document_id/comments — any authenticated user (access enforced in service)
router.get(
  '/:document_id/comments',
  asyncHandler(authenticateJwt),
  validate(documentIdSchema),
  asyncHandler(listCommentsHandler),
);

export { router as documentsRouter };
