import { Request, Response, NextFunction } from 'express';
import * as settingsService from './settings.service';
import type { UpdateProfileInput } from './settings.types';

// =========================================================================
// POST /settings/kill-switch
// =========================================================================

/**
 * Toggle payment kill switch. Management only.
 */
export async function toggleKillSwitchHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const { enabled } = req.body as { enabled: boolean };
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await settingsService.toggleKillSwitch(enabled, userId, ip, ua);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// POST /settings/config-changes
// =========================================================================

/**
 * Propose a config change. Management only.
 */
export async function proposeConfigChangeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId ?? '';
    const { key, value } = req.body as { key: string; value: string };
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await settingsService.proposeConfigChange(key, value, userId, ip, ua);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// POST /settings/config-changes/:id/approve
// =========================================================================

/**
 * Approve a pending config change. Management only.
 */
export async function approveConfigChangeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const changeId = req.params.id;
    const approverId = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await settingsService.approveConfigChange(changeId, approverId, ip, ua);
    res.status(200).json({ data: { success: true } });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// GET /settings/config-changes/pending
// =========================================================================

/**
 * List all pending config changes. Management only.
 */
export async function listPendingConfigChangesHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await settingsService.listPendingConfigChanges();
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /settings/profile
 * Return the authenticated user's decrypted profile.
 */
export async function getProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (userId === undefined) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }

    const profile = await settingsService.getProfile(userId);
    res.status(200).json(profile);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /settings/profile
 * Update the authenticated user's name, email, or phone.
 */
export async function updateProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (userId === undefined) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }

    const input = req.body as UpdateProfileInput;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const updated = await settingsService.updateProfile(userId, input, ip, ua);
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /settings/notifications
 * Return the user's notification preferences.
 */
export async function getNotificationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (userId === undefined) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }

    const prefs = await settingsService.getNotificationPreferences(userId);
    res.status(200).json(prefs);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /settings/my-data
 * PDPA data subject access — return all personal data for the authenticated user.
 */
export async function getMyDataHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (userId === undefined) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }

    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const data = await settingsService.getMyData(userId, ip, ua);
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /settings/delete-account
 * PDPA right-to-delete — soft-delete the user and schedule permanent removal.
 */
export async function requestDeletionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (userId === undefined) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }

    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await settingsService.requestDataDeletion(userId, ip, ua);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /settings/notifications
 * Persist notification preferences for the user.
 */
export async function updateNotificationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (userId === undefined) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }

    const body = req.body as {
      emailNotifications: boolean;
      smsNotifications: boolean;
      inAppNotifications: boolean;
    };
    await settingsService.updateNotificationPreferences(userId, body);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
