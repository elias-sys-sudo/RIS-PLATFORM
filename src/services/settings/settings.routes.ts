import { Router } from 'express';
import Joi from 'joi';
import { validate } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import {
  getProfileHandler,
  updateProfileHandler,
  getNotificationsHandler,
  updateNotificationsHandler,
  getMyDataHandler,
  requestDeletionHandler,
  toggleKillSwitchHandler,
  proposeConfigChangeHandler,
  approveConfigChangeHandler,
  listPendingConfigChangesHandler,
} from './settings.controller';

const router = Router();

// All settings routes require authentication
router.use(asyncHandler(authenticateJwt));

const updateProfileSchema = {
  body: Joi.object({
    name: Joi.string().min(1).max(200).optional(),
    email: Joi.string().email().max(255).optional(),
    phone: Joi.string().min(7).max(20).optional(),
  }).min(1),
};

const updateNotificationsSchema = {
  body: Joi.object({
    emailNotifications: Joi.boolean().optional(),
    smsNotifications: Joi.boolean().optional(),
    inAppNotifications: Joi.boolean().optional(),
  }).min(1),
};

/**
 * GET /settings/my-data
 * PDPA data subject access — returns all personal data for the authenticated user.
 */
router.get('/my-data', asyncHandler(getMyDataHandler));

/**
 * GET /settings/profile
 * Returns the authenticated user's decrypted profile.
 */
router.get('/profile', asyncHandler(getProfileHandler));

/**
 * PUT /settings/profile
 * Updates name, email, or phone for the authenticated user.
 */
router.put('/profile', validate(updateProfileSchema), asyncHandler(updateProfileHandler));

/**
 * GET /settings/notifications
 * Returns notification preferences.
 */
router.get('/notifications', asyncHandler(getNotificationsHandler));

/**
 * PUT /settings/notifications
 * Persists notification preferences to user_settings table.
 */
router.put(
  '/notifications',
  validate(updateNotificationsSchema),
  asyncHandler(updateNotificationsHandler),
);

/**
 * POST /settings/delete-account
 * PDPA right-to-delete — soft-deletes the user and schedules permanent removal.
 */
router.post('/delete-account', asyncHandler(requestDeletionHandler));

// =========================================================================
// Operational controls — management only
// =========================================================================

const killSwitchSchema = {
  body: Joi.object({
    enabled: Joi.boolean().required(),
  }),
};

const proposeConfigChangeSchema = {
  body: Joi.object({
    key: Joi.string().max(100).required(),
    value: Joi.string().max(1000).required(),
  }),
};

const approveConfigChangeSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

/**
 * POST /settings/kill-switch
 * Toggle payment kill switch. Management only.
 */
router.post(
  '/kill-switch',
  createRoleGuard(['management']),
  validate(killSwitchSchema),
  asyncHandler(toggleKillSwitchHandler),
);

/**
 * POST /settings/config-changes
 * Propose a config change. Management only.
 */
router.post(
  '/config-changes',
  createRoleGuard(['management']),
  validate(proposeConfigChangeSchema),
  asyncHandler(proposeConfigChangeHandler),
);

/**
 * GET /settings/config-changes/pending
 * List pending config changes. Management only.
 */
router.get(
  '/config-changes/pending',
  createRoleGuard(['management']),
  asyncHandler(listPendingConfigChangesHandler),
);

/**
 * POST /settings/config-changes/:id/approve
 * Approve a pending config change. Management only.
 */
router.post(
  '/config-changes/:id/approve',
  createRoleGuard(['management']),
  validate(approveConfigChangeSchema),
  asyncHandler(approveConfigChangeHandler),
);

export { router as settingsRouter };
