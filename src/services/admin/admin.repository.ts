import { query } from '../../shared/database/pool';
import type { AdminUserRow, RiskConfigRow } from './admin.types';

// =============================================================================
// Admin Repository — All SQL queries for user management and risk config
// =============================================================================

/**
 * Count total users matching an optional search filter.
 */
export async function countUsers(search?: string): Promise<number> {
  if (search !== undefined && search.trim() !== '') {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users WHERE email ILIKE $1`,
      [`%${search}%`],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  const result = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users`, []);
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * List users with pagination and optional email search.
 */
export async function listUsers(
  search: string | undefined,
  page: number,
  pageSize: number,
): Promise<AdminUserRow[]> {
  const offset = (page - 1) * pageSize;

  if (search !== undefined && search.trim() !== '') {
    const result = await query<AdminUserRow>(
      `SELECT id, email, role, is_active,
              first_name_encrypted, last_name_encrypted,
              last_login_at, created_at
       FROM users
       WHERE email ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [`%${search}%`, pageSize, offset],
    );
    return result.rows;
  }

  const result = await query<AdminUserRow>(
    `SELECT id, email, role, is_active,
            first_name_encrypted, last_name_encrypted,
            last_login_at, created_at
     FROM users
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [pageSize, offset],
  );
  return result.rows;
}

/**
 * Find a user by ID for admin operations.
 */
export async function findUserById(userId: string): Promise<AdminUserRow | null> {
  const result = await query<AdminUserRow>(
    `SELECT id, email, role, is_active,
            first_name_encrypted, last_name_encrypted,
            last_login_at, created_at
     FROM users
     WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Check if an email already exists in the users table.
 */
export async function emailExists(email: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM users WHERE email = $1) AS exists`,
    [email],
  );
  return result.rows[0]?.exists ?? false;
}

/**
 * Insert a new user into the users table.
 */
export async function createUser(
  email: string,
  passwordHash: string,
  role: string,
  firstNameEnc: string,
  lastNameEnc: string,
): Promise<AdminUserRow> {
  const result = await query<AdminUserRow>(
    `INSERT INTO users
       (email, password_hash, role,
        first_name_encrypted, last_name_encrypted, is_active)
     VALUES ($1, $2, $3::user_role, $4, $5, true)
     RETURNING id, email, role, is_active,
               first_name_encrypted, last_name_encrypted,
               last_login_at, created_at`,
    [email, passwordHash, role, firstNameEnc, lastNameEnc],
  );
  return result.rows[0];
}

/**
 * Update a user's role.
 */
export async function updateUserRole(userId: string, role: string): Promise<AdminUserRow> {
  const result = await query<AdminUserRow>(
    `UPDATE users
     SET role = $2::user_role, updated_at = NOW()
     WHERE id = $1
     RETURNING id, email, role, is_active,
               first_name_encrypted, last_name_encrypted,
               last_login_at, created_at`,
    [userId, role],
  );
  return result.rows[0];
}

/**
 * Update a user's active status.
 */
export async function updateUserStatus(userId: string, isActive: boolean): Promise<AdminUserRow> {
  const result = await query<AdminUserRow>(
    `UPDATE users
     SET is_active = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, email, role, is_active,
               first_name_encrypted, last_name_encrypted,
               last_login_at, created_at`,
    [userId, isActive],
  );
  return result.rows[0];
}

/**
 * Update both role and active status for a user.
 */
export async function updateUserRoleAndStatus(
  userId: string,
  role: string,
  isActive: boolean,
): Promise<AdminUserRow> {
  const result = await query<AdminUserRow>(
    `UPDATE users
     SET role = $2::user_role, is_active = $3, updated_at = NOW()
     WHERE id = $1
     RETURNING id, email, role, is_active,
               first_name_encrypted, last_name_encrypted,
               last_login_at, created_at`,
    [userId, role, isActive],
  );
  return result.rows[0];
}

// =============================================================================
// Risk Config
// =============================================================================

/**
 * List all risk config entries ordered by key.
 */
export async function listRiskConfig(): Promise<RiskConfigRow[]> {
  const result = await query<RiskConfigRow>(
    `SELECT key, value, description, updated_at, updated_by
     FROM risk_config
     ORDER BY key`,
    [],
  );
  return result.rows;
}

/**
 * Find a single risk config entry by key.
 */
export async function findRiskConfigByKey(key: string): Promise<RiskConfigRow | null> {
  const result = await query<RiskConfigRow>(
    `SELECT key, value, description, updated_at, updated_by
     FROM risk_config
     WHERE key = $1`,
    [key],
  );
  return result.rows[0] ?? null;
}

/**
 * Update a risk config value and return the updated row.
 */
export async function updateRiskConfig(
  key: string,
  value: string,
  updatedBy: string,
): Promise<RiskConfigRow> {
  const result = await query<RiskConfigRow>(
    `UPDATE risk_config
     SET value = $2, updated_by = $3, updated_at = NOW()
     WHERE key = $1
     RETURNING key, value, description, updated_at, updated_by`,
    [key, value, updatedBy],
  );
  return result.rows[0];
}

// =============================================================================
// Audit Log
// =============================================================================

/**
 * Insert an audit log entry for admin actions.
 */
export async function insertAuditLog(
  userId: string,
  action: string,
  tableName: string,
  recordId: string,
  oldValues: string | null,
  newValues: string | null,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id,
        old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, action, tableName, recordId, oldValues, newValues, ipAddress, userAgent],
  );
}
