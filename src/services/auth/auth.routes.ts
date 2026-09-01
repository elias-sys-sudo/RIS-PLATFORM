import { Router } from 'express';
import Joi from 'joi';
import { authRateLimiter, forgotPasswordRateLimiter } from '../../shared/middleware/security';
import { validate } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import {
  loginHandler,
  verifyTwoFactorHandler,
  logoutHandler,
  refreshHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
  changePasswordHandler,
  listSupplierBuyersHandler,
  getLoginActivityHandler,
  getActiveSessionsHandler,
  revokeSessionHandler,
  stepUpHandler,
  verifyEmailHandler,
  resendVerificationHandler,
  generateBackupCodesHandler,
} from './auth.controller';

const router = Router();

// authRateLimiter is mounted per-route below — only on credential-presenting
// endpoints (POST /login, POST /2fa/verify). Applying it at the router level
// locked users out of /logout, /refresh, /sessions, /activity after a few
// minutes of normal SPA use because they all shared the 10/15-min bucket.

const loginSchema = {
  body: Joi.object({
    email: Joi.string().email().required().max(255),
    password: Joi.string().required().min(8).max(128),
  }),
};

const twoFactorSchema = {
  body: Joi.object({
    partialAuthToken: Joi.string().required(),
    code: Joi.string()
      .required()
      .length(6)
      .pattern(/^\d{6}$/),
  }),
};

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{12,}$/;

const forgotPasswordSchema = {
  body: Joi.object({
    email: Joi.string().email().required().max(255),
  }),
};

const resetPasswordSchema = {
  body: Joi.object({
    token: Joi.string().required().hex().length(64),
    new_password: Joi.string().min(12).max(128).pattern(PASSWORD_PATTERN).messages({
      'string.pattern.base':
        'Password must contain at least 1 uppercase, 1 lowercase, 1 digit, and 1 special character',
    }),
    password: Joi.string().min(12).max(128).pattern(PASSWORD_PATTERN),
    confirm_password: Joi.string()
      .valid(Joi.ref('new_password'))
      .messages({ 'any.only': 'Passwords must match' }),
  })
    .rename('password', 'new_password', { override: true, ignoreUndefined: true })
    .or('new_password', 'password'),
};

const changePasswordSchema = {
  body: Joi.object({
    current_password: Joi.string().min(8).max(128),
    currentPassword: Joi.string().min(8).max(128),
    new_password: Joi.string().min(12).max(128).pattern(PASSWORD_PATTERN).messages({
      'string.pattern.base':
        'Password must contain at least 1 uppercase, 1 lowercase, 1 digit, and 1 special character',
    }),
    newPassword: Joi.string().min(12).max(128).pattern(PASSWORD_PATTERN),
    confirm_password: Joi.string()
      .valid(Joi.ref('new_password'))
      .messages({ 'any.only': 'Passwords must match' }),
  })
    .rename('currentPassword', 'current_password', { override: true, ignoreUndefined: true })
    .rename('newPassword', 'new_password', { override: true, ignoreUndefined: true })
    .or('current_password', 'currentPassword')
    .or('new_password', 'newPassword'),
};

const supplierBuyersSchema = {
  params: Joi.object({
    supplier_id: Joi.string().uuid().required(),
  }),
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().max(255).optional().allow(''),
    status: Joi.string().valid('active', 'inactive').optional(),
  }),
};

/**
 * POST /auth/login
 * Public — no JWT required. Rate limited (failed attempts only).
 */
router.post('/login', authRateLimiter, validate(loginSchema), asyncHandler(loginHandler));

/**
 * POST /auth/2fa/verify
 * Public — requires a partial_auth token in body. Rate limited (failed attempts only).
 */
router.post(
  '/2fa/verify',
  authRateLimiter,
  validate(twoFactorSchema),
  asyncHandler(verifyTwoFactorHandler),
);

/**
 * POST /auth/forgot-password
 * Public — rate limited per email (3/hour).
 */
router.post(
  '/forgot-password',
  forgotPasswordRateLimiter,
  validate(forgotPasswordSchema),
  asyncHandler(forgotPasswordHandler),
);

/**
 * POST /auth/reset-password
 * Public — validates token + sets new password.
 */
router.post('/reset-password', validate(resetPasswordSchema), asyncHandler(resetPasswordHandler));

const verifyEmailSchema = {
  body: Joi.object({
    token: Joi.string().required().hex().length(64),
  }),
};

const resendVerificationSchema = {
  body: Joi.object({
    email: Joi.string().email().required().max(255),
  }),
};

/**
 * POST /auth/verify-email
 * Public — consume an email-verification magic link.
 */
router.post('/verify-email', validate(verifyEmailSchema), asyncHandler(verifyEmailHandler));

/**
 * POST /auth/resend-verification
 * Public — rate limited (shared forgot-password bucket, 3/hour per email).
 * Always returns 200 to avoid email enumeration.
 */
router.post(
  '/resend-verification',
  forgotPasswordRateLimiter,
  validate(resendVerificationSchema),
  asyncHandler(resendVerificationHandler),
);

/**
 * PUT /auth/change-password
 * Authenticated — verifies current password then updates.
 */
router.put(
  '/change-password',
  asyncHandler(authenticateJwt),
  validate(changePasswordSchema),
  asyncHandler(changePasswordHandler),
);

/**
 * POST /auth/change-password
 * Alias for PUT — frontend uses POST.
 */
router.post(
  '/change-password',
  asyncHandler(authenticateJwt),
  validate(changePasswordSchema),
  asyncHandler(changePasswordHandler),
);

/**
 * POST /auth/logout
 * Requires valid JWT. Deletes session from Redis.
 */
router.post('/logout', asyncHandler(authenticateJwt), asyncHandler(logoutHandler));

/**
 * POST /auth/refresh
 * Uses httpOnly cookie — no JWT header required.
 */
router.post('/refresh', asyncHandler(refreshHandler));

/**
 * GET /auth/activity
 * Recent login activity for the authenticated user.
 */
router.get('/activity', asyncHandler(authenticateJwt), asyncHandler(getLoginActivityHandler));

/**
 * GET /auth/sessions
 * List all active sessions for the authenticated user.
 */
router.get('/sessions', asyncHandler(authenticateJwt), asyncHandler(getActiveSessionsHandler));

const revokeSessionSchema = {
  params: Joi.object({
    sessionId: Joi.string().uuid().required(),
  }),
};

/**
 * DELETE /auth/sessions/:sessionId
 * Revoke a specific session.
 */
router.delete(
  '/sessions/:sessionId',
  asyncHandler(authenticateJwt),
  validate(revokeSessionSchema),
  asyncHandler(revokeSessionHandler),
);

/**
 * GET /suppliers/:supplier_id/buyers
 * Authenticated — suppliers see only their own buyers.
 * Credit officers and management can see any supplier's buyers.
 */
router.get(
  '/suppliers/:supplier_id/buyers',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier', 'credit_officer', 'finance_manager', 'management', 'legal']),
  validate(supplierBuyersSchema),
  asyncHandler(listSupplierBuyersHandler),
);

const stepUpSchema = {
  body: Joi.object({
    code: Joi.string()
      .required()
      .length(6)
      .pattern(/^\d{6}$/)
      .messages({ 'string.pattern.base': 'Code must be a 6-digit number' }),
  }),
};

/**
 * POST /auth/step-up
 * Authenticated — re-verify TOTP before a sensitive action.
 * Returns { verified: true } on success; 401 on invalid code.
 */
router.post(
  '/step-up',
  asyncHandler(authenticateJwt),
  validate(stepUpSchema),
  asyncHandler(stepUpHandler),
);

/**
 * POST /auth/2fa/backup-codes/generate
 * Authenticated + step-up — issue 8 single-use backup codes. The body
 * must include a fresh TOTP code which is verified inline as step-up.
 */
router.post(
  '/2fa/backup-codes/generate',
  asyncHandler(authenticateJwt),
  validate(stepUpSchema),
  asyncHandler(generateBackupCodesHandler),
);

export { router as authRouter };
