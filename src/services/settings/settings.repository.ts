import { v4 as uuidv4 } from 'uuid';
import type { PoolClient } from 'pg';
import { query } from '../../shared/database/pool';
import { encrypt } from '../../shared/crypto';
import type {
  UserProfileRow,
  UpdateProfileInput,
  SettingsAction,
  UserSettingsRow,
  UserPiiRow,
  SupplierPiiRow,
  PendingConfigChangeRow,
} from './settings.types';

/**
 * Fetch the profile row for a given user.
 * Returns encrypted fields — caller is responsible for decryption.
 */
export async function fetchProfile(userId: string): Promise<UserProfileRow | null> {
  const result = await query<UserProfileRow>(
    `SELECT id, email, first_name_encrypted, last_name_encrypted, phone_encrypted
     FROM users
     WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Update user profile fields. Encrypts name and phone before storing.
 * Only updates fields that are provided in the input.
 */
export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    const nameParts = splitName(input.name);
    sets.push(`first_name_encrypted = $${String(idx)}`);
    params.push(encrypt(nameParts.first));
    idx++;

    sets.push(`last_name_encrypted = $${String(idx)}`);
    params.push(encrypt(nameParts.last));
    idx++;
  }

  if (input.email !== undefined) {
    sets.push(`email = $${String(idx)}`);
    params.push(input.email);
    idx++;
  }

  if (input.phone !== undefined) {
    sets.push(`phone_encrypted = $${String(idx)}`);
    params.push(encrypt(input.phone));
    idx++;
  }

  if (sets.length === 0) {
    return;
  }

  sets.push(`updated_at = NOW()`);
  params.push(userId);

  await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${String(idx)}`, params);
}

/**
 * Write an audit log entry for a settings action.
 * Never includes PII — only IDs and action metadata.
 */
export async function createAuditEntry(
  userId: string,
  action: SettingsAction,
  ipAddress: string,
  userAgent: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, action, 'users', userId, JSON.stringify(metadata), ipAddress, userAgent],
  );
}

/**
 * Soft-delete a user by setting is_active = false (WithClient variant for transactions).
 */
export async function softDeleteUserWithClient(client: PoolClient, userId: string): Promise<void> {
  await client.query(`UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`, [
    userId,
  ]);
}

/**
 * Write an audit log entry within an existing transaction (WithClient variant).
 */
export async function createAuditEntryWithClient(
  client: PoolClient,
  userId: string,
  action: string,
  ipAddress: string,
  userAgent: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, action, 'users', userId, JSON.stringify(metadata), ipAddress, userAgent],
  );
}

/**
 * Fetch notification preferences for a user.
 * Returns null if no row exists yet (first-time user).
 */
export async function getUserSettings(userId: string): Promise<UserSettingsRow | null> {
  const result = await query<UserSettingsRow>(
    `SELECT id, user_id, email_notifications, sms_notifications, in_app_notifications,
            created_at, updated_at
     FROM user_settings
     WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Insert or update notification preferences for a user.
 * Uses ON CONFLICT (user_id) to upsert in a single statement.
 */
export async function upsertUserSettings(
  userId: string,
  prefs: { emailNotifications: boolean; smsNotifications: boolean; inAppNotifications: boolean },
): Promise<UserSettingsRow> {
  const id = uuidv4();
  const result = await query<UserSettingsRow>(
    `INSERT INTO user_settings (id, user_id, email_notifications, sms_notifications, in_app_notifications)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       email_notifications  = EXCLUDED.email_notifications,
       sms_notifications    = EXCLUDED.sms_notifications,
       in_app_notifications = EXCLUDED.in_app_notifications,
       updated_at           = NOW()
     RETURNING *`,
    [id, userId, prefs.emailNotifications, prefs.smsNotifications, prefs.inAppNotifications],
  );
  return result.rows[0];
}

/**
 * Fetch all PII fields for a user (PDPA data subject access).
 * Returns encrypted fields — caller decrypts in service layer.
 */
export async function fetchUserPii(userId: string): Promise<UserPiiRow | null> {
  const result = await query<UserPiiRow>(
    `SELECT id, email, first_name_encrypted, last_name_encrypted,
            phone_encrypted, role, created_at::text
     FROM users
     WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch supplier PII linked to a user (PDPA data subject access).
 * Returns null if the user is not a supplier.
 */
export async function fetchSupplierPii(userId: string): Promise<SupplierPiiRow | null> {
  const result = await query<SupplierPiiRow>(
    `SELECT id, company_name_encrypted, registration_number,
            bank_account_number_encrypted, bank_account_name_encrypted,
            mobile_money_number_encrypted, kyc_status
     FROM suppliers
     WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// System settings
// =========================================================================

/**
 * Retrieve a system setting value by key.
 */
export async function getSystemSetting(key: string): Promise<string | null> {
  const result = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = $1`,
    [key],
  );
  return result.rows[0]?.value ?? null;
}

/**
 * Update a system setting within a transaction.
 */
export async function setSystemSettingWithClient(
  client: PoolClient,
  key: string,
  value: string,
  userId: string,
): Promise<void> {
  await client.query(
    `UPDATE system_settings SET value = $1, updated_by = $2, updated_at = NOW() WHERE key = $3`,
    [value, userId, key],
  );
}

/**
 * Write an audit log entry for system settings within a transaction.
 */
export async function createSystemAuditEntryWithClient(
  client: PoolClient,
  userId: string,
  action: SettingsAction,
  ipAddress: string,
  userAgent: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, action, 'system_settings', userId, JSON.stringify(metadata), ipAddress, userAgent],
  );
}

// =========================================================================
// Pending config changes (maker-checker)
// =========================================================================

/**
 * Insert a new pending config change record.
 */
export async function createPendingConfigChange(
  id: string,
  configKey: string,
  currentValue: string,
  proposedValue: string,
  proposedBy: string,
): Promise<void> {
  await query(
    `INSERT INTO pending_config_changes
       (id, config_key, current_value, proposed_value, proposed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, configKey, currentValue, proposedValue, proposedBy],
  );
}

/**
 * Retrieve a pending config change by ID.
 */
export async function getPendingConfigChange(
  changeId: string,
): Promise<PendingConfigChangeRow | null> {
  const result = await query<PendingConfigChangeRow>(
    `SELECT * FROM pending_config_changes WHERE id = $1`,
    [changeId],
  );
  return result.rows[0] ?? null;
}

/**
 * Approve a pending config change within a transaction.
 */
export async function approvePendingConfigChangeWithClient(
  client: PoolClient,
  changeId: string,
  approverId: string,
): Promise<void> {
  await client.query(
    `UPDATE pending_config_changes
     SET status = 'approved', approved_by = $1, resolved_at = NOW()
     WHERE id = $2`,
    [approverId, changeId],
  );
}

/**
 * List all pending config changes.
 */
export async function listPendingConfigChanges(): Promise<PendingConfigChangeRow[]> {
  const result = await query<PendingConfigChangeRow>(
    `SELECT * FROM pending_config_changes WHERE status = 'pending' ORDER BY created_at DESC`,
    [],
  );
  return result.rows;
}

/**
 * Split a full name into first and last parts.
 */
function splitName(name: string): { first: string; last: string } {
  const trimmed = name.trim();
  const spaceIndex = trimmed.indexOf(' ');

  if (spaceIndex === -1) {
    return { first: trimmed, last: '' };
  }

  return {
    first: trimmed.slice(0, spaceIndex),
    last: trimmed.slice(spaceIndex + 1).trim(),
  };
}
