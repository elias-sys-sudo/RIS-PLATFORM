import type { PoolClient } from 'pg';
import { query, pool } from '../../shared/database/pool';
import type {
  UserRecord,
  AuthAction,
  PasswordResetTokenRecord,
  EmailVerificationTokenRecord,
  BackupCodeRecord,
  UserProfileRow,
  LoginHistoryRecord,
  PasswordHistoryRecord,
} from './auth.types';

/**
 * Acquire a client from the pool for transactional operations.
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/**
 * Find a user by email address. Returns null if not found.
 * Used during login — caller must never reveal whether user exists.
 */
export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `SELECT id, email, password_hash, role, is_active, email_verified,
            two_factor_enabled, two_factor_secret,
            failed_login_count, locked_until
     FROM users
     WHERE email = $1`,
    [email],
  );
  return result.rows[0] ?? null;
}

/**
 * Increment the failed login counter for a user.
 */
export async function incrementFailedLogin(userId: string): Promise<number> {
  const result = await query<{ failed_login_count: number }>(
    `UPDATE users
     SET failed_login_count = failed_login_count + 1
     WHERE id = $1
     RETURNING failed_login_count`,
    [userId],
  );
  return result.rows[0]?.failed_login_count ?? 0;
}

/**
 * Reset the failed login counter to 0 after a successful login.
 */
export async function resetFailedLogin(userId: string): Promise<void> {
  await query(
    `UPDATE users
     SET failed_login_count = 0, locked_until = NULL
     WHERE id = $1`,
    [userId],
  );
}

/**
 * Lock a user account until the given timestamp.
 */
export async function lockAccount(userId: string, lockedUntil: Date): Promise<void> {
  await query(
    `UPDATE users
     SET locked_until = $1
     WHERE id = $2`,
    [lockedUntil, userId],
  );
}

/**
 * Record the last login timestamp for a user.
 */
export async function recordLogin(userId: string): Promise<void> {
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [userId]);
}

/**
 * Write an audit log entry for an authentication event.
 * Never includes PII — only IDs, actions, and non-sensitive metadata.
 */
export async function createAuditEntry(
  userId: string | null,
  action: AuthAction,
  ipAddress?: string | null,
  userAgent?: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      action,
      'users',
      userId,
      JSON.stringify(metadata ?? {}),
      ipAddress ?? null,
      userAgent ?? null,
    ],
  );
}

// =========================================================================
// Password reset token queries
// =========================================================================

/**
 * Invalidate all existing password reset tokens for a user.
 */
export async function invalidateResetTokens(userId: string): Promise<void> {
  await query(
    `UPDATE password_reset_tokens
     SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
}

/**
 * Store a hashed password reset token with expiry.
 */
export async function createResetToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
}

/**
 * Find a valid (unused, not expired) reset token by its hash.
 */
export async function findValidResetToken(
  tokenHash: string,
): Promise<PasswordResetTokenRecord | null> {
  const result = await query<PasswordResetTokenRecord>(
    `SELECT id, user_id, token_hash, expires_at, used_at, created_at
     FROM password_reset_tokens
     WHERE token_hash = $1
       AND used_at IS NULL
       AND expires_at > NOW()`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

/**
 * Mark a reset token as used.
 */
export async function markResetTokenUsed(tokenId: string): Promise<void> {
  await query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [tokenId]);
}

/**
 * Mark a reset token as used (within a transaction).
 */
export async function markResetTokenUsedWithClient(
  client: PoolClient,
  tokenId: string,
): Promise<void> {
  await client.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [tokenId]);
}

// =========================================================================
// Email verification token queries
// =========================================================================

/**
 * Invalidate all existing email verification tokens for a user.
 * Called before issuing a fresh token (registration or resend) so only the
 * most recent link is live — prevents two parallel links being valid at once.
 */
export async function invalidateEmailVerificationTokens(userId: string): Promise<void> {
  await query(
    `UPDATE email_verification_tokens
     SET verified_at = NOW()
     WHERE user_id = $1 AND verified_at IS NULL`,
    [userId],
  );
}

/**
 * Store a hashed email verification token with expiry.
 */
export async function createEmailVerificationToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
}

/**
 * Find a pending (not verified, not expired) email verification token by hash.
 */
export async function findValidEmailVerificationToken(
  tokenHash: string,
): Promise<EmailVerificationTokenRecord | null> {
  const result = await query<EmailVerificationTokenRecord>(
    `SELECT id, user_id, token_hash, expires_at, verified_at, created_at
     FROM email_verification_tokens
     WHERE token_hash = $1
       AND verified_at IS NULL
       AND expires_at > NOW()`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

/**
 * Mark an email verification token as consumed (within a transaction).
 */
export async function markEmailVerificationTokenUsedWithClient(
  client: PoolClient,
  tokenId: string,
): Promise<void> {
  await client.query(`UPDATE email_verification_tokens SET verified_at = NOW() WHERE id = $1`, [
    tokenId,
  ]);
}

/**
 * Flip users.email_verified = true (within a transaction).
 */
export async function markUserEmailVerifiedWithClient(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(`UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1`, [
    userId,
  ]);
}

// =========================================================================
// TOTP backup codes — REQ-AUTH-008
// =========================================================================

/**
 * Mark all unused backup codes for a user as used. Called before issuing a
 * fresh batch so only the latest set of 8 codes is live.
 */
export async function invalidateBackupCodesWithClient(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(
    `UPDATE totp_backup_codes
     SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
}

/**
 * Insert a single backup code hash within a transaction (called 8 times).
 */
export async function createBackupCodeWithClient(
  client: PoolClient,
  userId: string,
  codeHash: string,
): Promise<void> {
  await client.query(`INSERT INTO totp_backup_codes (user_id, code_hash) VALUES ($1, $2)`, [
    userId,
    codeHash,
  ]);
}

/**
 * Look up an unused backup code by hash for the given user. Returns the row
 * id when found so the caller can mark it used in the same transaction.
 */
export async function findUnusedBackupCode(
  userId: string,
  codeHash: string,
): Promise<BackupCodeRecord | null> {
  const result = await query<BackupCodeRecord>(
    `SELECT id, user_id, code_hash, used_at, created_at
     FROM totp_backup_codes
     WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
    [userId, codeHash],
  );
  return result.rows[0] ?? null;
}

/**
 * Mark a backup code as consumed (within a transaction).
 */
export async function markBackupCodeUsedWithClient(
  client: PoolClient,
  codeId: string,
): Promise<void> {
  await client.query(`UPDATE totp_backup_codes SET used_at = NOW() WHERE id = $1`, [codeId]);
}

// =========================================================================
// New-device detection — REQ-AUTH-007
// =========================================================================

/**
 * Returns true when this user has logged in successfully from the same
 * user_agent in the last `daysAgo` days. Used to suppress duplicate
 * new-device emails for a returning device.
 */
export async function hasRecentLoginWithSameUserAgent(
  userId: string,
  userAgent: string,
  daysAgo: number,
): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM login_history
       WHERE user_id = $1
         AND user_agent = $2
         AND success = true
         AND created_at > NOW() - ($3::int * INTERVAL '1 day')
     ) AS exists`,
    [userId, userAgent, daysAgo],
  );
  return rows[0]?.exists ?? false;
}

/**
 * Update a user's password hash.
 */
export async function updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
  await query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
    passwordHash,
    userId,
  ]);
}

/**
 * Update a user's password hash (within a transaction).
 */
export async function updatePasswordHashWithClient(
  client: PoolClient,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await client.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
    passwordHash,
    userId,
  ]);
}

/**
 * Fetch user profile fields (id, email, role, encrypted name) for a given user.
 * Used to build the AuthUserResponse returned to the frontend after login.
 */
export async function fetchUserProfile(userId: string): Promise<UserProfileRow | null> {
  const result = await query<UserProfileRow>(
    `SELECT id, email, role::TEXT AS role,
            first_name_encrypted, last_name_encrypted
     FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Find a user by ID. Returns null if not found.
 */
export async function findUserById(userId: string): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `SELECT id, email, password_hash, role, is_active, email_verified,
            two_factor_enabled, two_factor_secret,
            failed_login_count, locked_until
     FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Supplier buyer queries
// =========================================================================

/**
 * List buyers associated with a supplier via invoices.
 * Returns paginated buyers with invoice counts and outstanding totals.
 */
export async function listBuyersForSupplier(
  supplierId: string,
  params: { page: number; limit: number; search?: string; status?: string },
): Promise<{ rows: SupplierBuyerRow[]; total: number }> {
  const offset = (params.page - 1) * params.limit;
  const conditions: string[] = ['i.supplier_id = $1'];
  const queryParams: unknown[] = [supplierId];
  let paramIdx = 2;

  if (params.search !== undefined && params.search !== '') {
    conditions.push(`b.company_name ILIKE $${String(paramIdx)}`);
    queryParams.push(`%${params.search}%`);
    paramIdx++;
  }

  if (params.status !== undefined && params.status !== '') {
    const isActive = params.status === 'active';
    conditions.push(`b.is_active = $${String(paramIdx)}`);
    queryParams.push(isActive);
    paramIdx++;
  }

  const whereClause = conditions.join(' AND ');

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT b.id) AS count
     FROM buyers b
     INNER JOIN invoices i ON i.buyer_id = b.id
     WHERE ${whereClause}`,
    queryParams,
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const dataResult = await query<SupplierBuyerRow>(
    `SELECT
       b.id,
       b.company_name,
       b.contact_email_encrypted,
       b.contact_phone_encrypted,
       b.is_active,
       COUNT(i.id)::INTEGER AS total_invoices,
       COALESCE(SUM(
         CASE WHEN i.status NOT IN ('collected', 'defaulted', 'cancelled', 'rejected')
         THEN i.face_value ELSE 0 END
       ), 0)::BIGINT AS total_outstanding
     FROM buyers b
     INNER JOIN invoices i ON i.buyer_id = b.id
     WHERE ${whereClause}
     GROUP BY b.id
     ORDER BY b.company_name ASC
     LIMIT $${String(paramIdx)} OFFSET $${String(paramIdx + 1)}`,
    [...queryParams, params.limit, offset],
  );

  return { rows: dataResult.rows, total };
}

export interface SupplierBuyerRow {
  id: string;
  company_name: string;
  contact_email_encrypted: string;
  contact_phone_encrypted: string;
  is_active: boolean;
  total_invoices: number;
  total_outstanding: string;
}

// =========================================================================
// Failed auth burst detection
// =========================================================================

/**
 * Count recent failed login attempts from a specific IP address.
 * Uses audit_logs where LOGIN_FAILED events are recorded with ip_address.
 */
export async function getRecentFailedLoginsByIp(
  ipAddress: string,
  windowMinutes: number,
): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM audit_logs
     WHERE ip_address = $1
       AND action = $2
       AND created_at >= NOW() - ($3 * interval '1 minute')`,
    [ipAddress, 'LOGIN_FAILED', windowMinutes],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

// =========================================================================
// Transaction-aware variants (WithClient)
// =========================================================================

/**
 * Increment failed login counter within a transaction.
 */
export async function incrementFailedLoginWithClient(
  client: PoolClient,
  userId: string,
): Promise<number> {
  const result = await client.query<{ failed_login_count: number }>(
    `UPDATE users
     SET failed_login_count = failed_login_count + 1
     WHERE id = $1
     RETURNING failed_login_count`,
    [userId],
  );
  return result.rows[0]?.failed_login_count ?? 0;
}

/**
 * Lock account within a transaction.
 */
export async function lockAccountWithClient(
  client: PoolClient,
  userId: string,
  lockedUntil: Date,
): Promise<void> {
  await client.query(`UPDATE users SET locked_until = $1 WHERE id = $2`, [lockedUntil, userId]);
}

/**
 * Write an audit log entry within a transaction.
 */
export async function createAuditEntryWithClient(
  client: PoolClient,
  userId: string | null,
  action: AuthAction,
  ipAddress?: string | null,
  userAgent?: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      action,
      'users',
      userId,
      JSON.stringify(metadata ?? {}),
      ipAddress ?? null,
      userAgent ?? null,
    ],
  );
}

// =========================================================================
// Password history
// =========================================================================

/**
 * Store a password hash in history for reuse prevention.
 */
export async function createPasswordHistoryEntry(
  userId: string,
  passwordHash: string,
): Promise<void> {
  await query(
    `INSERT INTO password_history (user_id, password_hash)
     VALUES ($1, $2)`,
    [userId, passwordHash],
  );
}

/**
 * Store a password hash in history for reuse prevention (within a transaction).
 */
export async function createPasswordHistoryEntryWithClient(
  client: PoolClient,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await client.query(
    `INSERT INTO password_history (user_id, password_hash)
     VALUES ($1, $2)`,
    [userId, passwordHash],
  );
}

/**
 * Retrieve the last N password hashes for a user.
 */
export async function getLastNPasswords(
  userId: string,
  n: number,
): Promise<PasswordHistoryRecord[]> {
  const result = await query<PasswordHistoryRecord>(
    `SELECT id, user_id, password_hash, created_at
     FROM password_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, n],
  );
  return result.rows;
}

// =========================================================================
// Login history
// =========================================================================

/**
 * Record a login attempt (success or failure).
 */
export async function createLoginHistoryEntry(
  userId: string | null,
  ipAddress: string | null,
  userAgent: string | null,
  country: string | null,
  success: boolean,
): Promise<void> {
  await query(
    `INSERT INTO login_history (user_id, ip_address, user_agent, country, success)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, ipAddress, userAgent, country, success],
  );
}

/**
 * Retrieve recent login history for a user.
 */
export async function getLoginHistory(
  userId: string,
  limit: number,
): Promise<LoginHistoryRecord[]> {
  const result = await query<LoginHistoryRecord>(
    `SELECT id, user_id, ip_address, user_agent, country, success, created_at
     FROM login_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return result.rows;
}

/**
 * Get the country of the last successful login.
 */
export async function getLastLoginCountry(userId: string): Promise<string | null> {
  const result = await query<{ country: string | null }>(
    `SELECT country
     FROM login_history
     WHERE user_id = $1 AND success = true
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0]?.country ?? null;
}

// =========================================================================
// Inactive account queries
// =========================================================================

/**
 * Find active users who have been inactive for the specified number of days.
 */
export async function findInactiveUsers(
  inactiveDays: number,
): Promise<Array<{ id: string; email: string }>> {
  const result = await query<{ id: string; email: string }>(
    `SELECT id, email FROM users
     WHERE is_active = true
       AND last_active_at < NOW() - INTERVAL '1 day' * $1`,
    [inactiveDays],
  );
  return result.rows;
}

/**
 * Disable a user account by setting is_active to false.
 */
export async function disableUserAccount(userId: string): Promise<void> {
  await query(`UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`, [userId]);
}

/**
 * Find users approaching inactivity threshold who haven't been warned.
 */
export async function findUsersForInactiveWarning(
  warningDays: number,
): Promise<Array<{ id: string; email: string }>> {
  const result = await query<{ id: string; email: string }>(
    `SELECT id, email FROM users
     WHERE is_active = true
       AND last_active_at < NOW() - INTERVAL '1 day' * $1
       AND inactive_warning_sent_at IS NULL`,
    [warningDays],
  );
  return result.rows;
}

/**
 * Mark that an inactive warning was sent to a user.
 */
export async function markInactiveWarningSent(userId: string): Promise<void> {
  await query(`UPDATE users SET inactive_warning_sent_at = NOW() WHERE id = $1`, [userId]);
}
