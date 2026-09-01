import { v4 as uuidv4 } from 'uuid';
import { decrypt } from '../../shared/crypto';
import { pool, beginWithRls } from '../../shared/database/pool';
import { BusinessRuleError, NotFoundError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import * as settingsRepo from './settings.repository';
import type {
  UserProfile,
  UserProfileRow,
  UpdateProfileInput,
  NotificationPreferences,
  PersonalDataExport,
  DeletionRequestResult,
  PendingConfigChangeRow,
} from './settings.types';

/**
 * Default notification preferences returned for first-time users (no DB row yet).
 */
const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  email_notifications: true,
  sms_notifications: true,
  in_app_notifications: true,
};

/**
 * Fetch and decrypt the authenticated user's profile.
 */
export async function getProfile(userId: string): Promise<UserProfile> {
  const row = await settingsRepo.fetchProfile(userId);

  if (!row) {
    throw new NotFoundError('User', userId);
  }

  return decryptProfileRow(row);
}

/**
 * Update the user's profile, encrypt PII, and write an audit log.
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
  ipAddress: string,
  userAgent: string,
): Promise<UserProfile> {
  await settingsRepo.updateProfile(userId, input);

  await settingsRepo.createAuditEntry(userId, 'PROFILE_UPDATED', ipAddress, userAgent, {
    fieldsUpdated: Object.keys(input),
  });

  logger.audit('PROFILE_UPDATED', {
    component: 'settings',
    userId,
    fieldsUpdated: Object.keys(input),
  });

  return getProfile(userId);
}

/**
 * Return notification preferences for the user.
 * Returns stored values if a row exists, otherwise returns defaults without writing.
 */
export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const row = await settingsRepo.getUserSettings(userId);

  if (row === null) {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }

  return {
    email_notifications: row.email_notifications,
    sms_notifications: row.sms_notifications,
    in_app_notifications: row.in_app_notifications,
  };
}

/**
 * Persist notification preferences for the user and write an audit log entry.
 */
export async function updateNotificationPreferences(
  userId: string,
  prefs: { emailNotifications: boolean; smsNotifications: boolean; inAppNotifications: boolean },
): Promise<NotificationPreferences> {
  const row = await settingsRepo.upsertUserSettings(userId, prefs);

  logger.audit('NOTIFICATION_PREFERENCES_UPDATED', { component: 'settings', userId });

  return {
    email_notifications: row.email_notifications,
    sms_notifications: row.sms_notifications,
    in_app_notifications: row.in_app_notifications,
  };
}

/**
 * PDPA data subject access: return all personal data for the authenticated user.
 * Decrypts all encrypted fields and logs the access request.
 */
export async function getMyData(
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<PersonalDataExport> {
  const userRow = await settingsRepo.fetchUserPii(userId);
  if (!userRow) {
    throw new NotFoundError('User', userId);
  }

  const supplierRow = await settingsRepo.fetchSupplierPii(userId);

  await settingsRepo.createAuditEntry(userId, 'DATA_SUBJECT_ACCESS_REQUEST', ipAddress, userAgent, {
    hasSupplierData: supplierRow !== null,
  });

  logger.audit('DATA_SUBJECT_ACCESS_REQUEST', { component: 'settings', userId });

  return buildPersonalDataExport(userRow, supplierRow);
}

// =========================================================================
// Kill switch toggle
// =========================================================================

/**
 * Toggle the payment kill switch. Management only.
 * Writes audit log inside transaction.
 */
export async function toggleKillSwitch(
  enabled: boolean,
  userId: string,
  ip: string,
  ua: string,
): Promise<{ enabled: boolean }> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await settingsRepo.setSystemSettingWithClient(
      client,
      'payment_kill_switch',
      String(enabled),
      userId,
    );
    await settingsRepo.createSystemAuditEntryWithClient(
      client,
      userId,
      'KILL_SWITCH_TOGGLED',
      ip,
      ua,
      { enabled },
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  logger.audit('KILL_SWITCH_TOGGLED', { component: 'settings', userId, enabled });
  return { enabled };
}

// =========================================================================
// Config change propose/approve (maker-checker)
// =========================================================================

/**
 * Propose a config change. Creates a pending record for another user to approve.
 */
export async function proposeConfigChange(
  key: string,
  newValue: string,
  userId: string,
  ip: string,
  ua: string,
): Promise<{ changeId: string }> {
  const current = await settingsRepo.getSystemSetting(key);
  const changeId = uuidv4();
  await settingsRepo.createPendingConfigChange(changeId, key, current ?? '', newValue, userId);
  await settingsRepo.createAuditEntry(userId, 'CONFIG_CHANGE_PROPOSED', ip, ua, { key, changeId });
  logger.audit('CONFIG_CHANGE_PROPOSED', { component: 'settings', userId, key });
  return { changeId };
}

/**
 * Approve a pending config change. Enforces maker != checker.
 */
export async function approveConfigChange(
  changeId: string,
  approverId: string,
  ip: string,
  ua: string,
): Promise<void> {
  const change = await settingsRepo.getPendingConfigChange(changeId);
  validateConfigChangeForApproval(change, changeId, approverId);

  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await settingsRepo.approvePendingConfigChangeWithClient(client, changeId, approverId);
    await settingsRepo.setSystemSettingWithClient(
      client,
      change.config_key,
      change.proposed_value,
      approverId,
    );
    await settingsRepo.createSystemAuditEntryWithClient(
      client,
      approverId,
      'CONFIG_CHANGE_APPROVED',
      ip,
      ua,
      {
        changeId,
        key: change.config_key,
      },
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  logger.audit('CONFIG_CHANGE_APPROVED', { component: 'settings', approverId, changeId });
}

/**
 * Validate that a config change can be approved.
 */
function validateConfigChangeForApproval(
  change: PendingConfigChangeRow | null,
  changeId: string,
  approverId: string,
): asserts change is PendingConfigChangeRow {
  if (!change) {
    throw new NotFoundError('ConfigChange', changeId);
  }
  if (change.status !== 'pending') {
    throw new BusinessRuleError('CONFIG_CHANGE_NOT_PENDING', 'Change is not pending');
  }
  if (change.proposed_by === approverId) {
    throw new BusinessRuleError('SAME_USER_CANNOT_APPROVE', 'Proposer cannot approve own change');
  }
}

/**
 * List all pending config changes.
 */
export async function listPendingConfigChanges(): Promise<PendingConfigChangeRow[]> {
  return settingsRepo.listPendingConfigChanges();
}

// =========================================================================
// Private helpers
// =========================================================================

function buildPersonalDataExport(
  userRow: {
    id: string;
    email: string;
    first_name_encrypted: string | null;
    last_name_encrypted: string | null;
    phone_encrypted: string | null;
    role: string;
    created_at: string;
  },
  supplierRow: {
    id: string;
    company_name_encrypted: string | null;
    registration_number: string;
    bank_account_number_encrypted: string | null;
    bank_account_name_encrypted: string | null;
    mobile_money_number_encrypted: string | null;
    kyc_status: string;
  } | null,
): PersonalDataExport {
  const name = decryptName(userRow.first_name_encrypted, userRow.last_name_encrypted);
  const phone = safeDecrypt(userRow.phone_encrypted);

  const supplier =
    supplierRow !== null
      ? {
          id: supplierRow.id,
          company_name: safeDecrypt(supplierRow.company_name_encrypted),
          registration_number: supplierRow.registration_number,
          bank_account_number: safeDecrypt(supplierRow.bank_account_number_encrypted),
          bank_account_name: safeDecrypt(supplierRow.bank_account_name_encrypted),
          mobile_money_number: safeDecrypt(supplierRow.mobile_money_number_encrypted),
          kyc_status: supplierRow.kyc_status,
        }
      : null;

  return {
    user: {
      id: userRow.id,
      email: userRow.email,
      name,
      phone,
      role: userRow.role,
      created_at: userRow.created_at,
    },
    supplier,
    exported_at: new Date().toISOString(),
  };
}

const COOLING_OFF_DAYS = 30;

/**
 * PDPA right-to-delete: soft-delete the user and schedule permanent removal.
 * Audit entry is written inside the same transaction as the soft delete.
 */
export async function requestDataDeletion(
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<DeletionRequestResult> {
  const row = await settingsRepo.fetchProfile(userId);
  if (!row) {
    throw new NotFoundError('User', userId);
  }

  await executeSoftDelete(userId, ipAddress, userAgent);

  logger.audit('DATA_DELETION_REQUEST', { component: 'settings', userId });

  return buildDeletionResult();
}

async function executeSoftDelete(
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await settingsRepo.softDeleteUserWithClient(client, userId);
    await settingsRepo.createAuditEntryWithClient(
      client,
      userId,
      'DATA_DELETION_REQUEST',
      ipAddress,
      userAgent,
      { coolingOffDays: COOLING_OFF_DAYS },
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function buildDeletionResult(): DeletionRequestResult {
  const scheduledAt = new Date(Date.now() + COOLING_OFF_DAYS * 86_400_000).toISOString();
  return {
    message:
      'Account deletion requested. Data will be permanently removed after the cooling-off period.',
    deletion_scheduled_at: scheduledAt,
    cooling_off_days: COOLING_OFF_DAYS,
  };
}

function decryptName(firstEnc: string | null, lastEnc: string | null): string {
  const first = safeDecrypt(firstEnc);
  const last = safeDecrypt(lastEnc);
  return `${first} ${last}`.trim();
}

function safeDecrypt(value: string | null): string {
  if (value === null) return '';
  try {
    return decrypt(value);
  } catch {
    return '';
  }
}

/**
 * Decrypt a raw profile row into a frontend-friendly UserProfile.
 */
function decryptProfileRow(row: UserProfileRow): UserProfile {
  let name = row.email.split('@')[0];
  let phone = '';

  if (row.first_name_encrypted !== null) {
    const first = decrypt(row.first_name_encrypted);
    const last = row.last_name_encrypted !== null ? decrypt(row.last_name_encrypted) : '';
    name = `${first} ${last}`.trim();
  }

  if (row.phone_encrypted !== null) {
    phone = decrypt(row.phone_encrypted);
  }

  return { id: row.id, name, email: row.email, phone };
}
