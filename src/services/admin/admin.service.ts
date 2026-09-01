import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { logger } from '../../shared/logger';
import { encrypt, decrypt } from '../../shared/crypto';
import { invalidateRiskConfigCache } from '../../shared/risk-config';
import { ValidationError, NotFoundError, BusinessRuleError } from '../../shared/errors';
import * as adminRepo from './admin.repository';
import type {
  AdminUser,
  AdminUserRow,
  AdminUserListResponse,
  CreateUserInput,
  UpdateUserInput,
  ListUsersParams,
  RiskConfigEntry,
  RiskConfigRow,
} from './admin.types';

const BCRYPT_COST = 12;

const VALID_ROLES = [
  'supplier',
  'credit_officer',
  'finance_manager',
  'management',
  'compliance_officer',
  'auditor',
  'legal',
];

// =============================================================================
// Helpers
// =============================================================================

/**
 * Derive the risk config category from the key prefix.
 */
function deriveCategory(key: string): 'weight' | 'threshold' | 'limit' | 'rate' {
  if (key.startsWith('weight_')) return 'weight';
  if (key.startsWith('threshold_')) return 'threshold';
  if (key.startsWith('advance_pct_')) return 'limit';
  return 'rate';
}

/**
 * Map a raw DB row to an AdminUser response object.
 * Decrypts first/last name fields.
 */
function mapRowToAdminUser(row: AdminUserRow): AdminUser {
  const firstName = decryptSafe(row.first_name_encrypted);
  const lastName = decryptSafe(row.last_name_encrypted);
  const name = buildName(firstName, lastName);

  return {
    id: row.id,
    name,
    email: row.email,
    role: row.role,
    status: row.is_active ? 'active' : 'inactive',
    last_login: row.last_login_at,
    created_at: row.created_at,
  };
}

/**
 * Safely decrypt a value, returning empty string on failure.
 */
function decryptSafe(value: string | null): string {
  if (value === null || value === '') return '';
  try {
    return decrypt(value);
  } catch {
    logger.warn('PII decryption failed — field returned as empty', { component: 'admin' });
    return '';
  }
}

/**
 * Build a display name from first and last name.
 */
function buildName(first: string, last: string): string {
  return [first, last].filter(Boolean).join(' ') || 'Unnamed';
}

/**
 * Map a raw risk config DB row to a RiskConfigEntry.
 */
function mapRowToRiskConfig(row: RiskConfigRow): RiskConfigEntry {
  return {
    key: row.key,
    value: row.value,
    description: row.description,
    category: deriveCategory(row.key),
    last_updated: row.updated_at,
    updated_by: row.updated_by,
  };
}

/**
 * Split a full name into first and last parts.
 */
function splitName(name: string): { first: string; last: string } {
  const trimmed = name.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { first: trimmed, last: '' };
  }
  return {
    first: trimmed.slice(0, spaceIdx),
    last: trimmed.slice(spaceIdx + 1),
  };
}

// =============================================================================
// User Management
// =============================================================================

/**
 * List users with pagination and optional search.
 * Decrypts name fields for each row.
 */
export async function listUsers(params: ListUsersParams): Promise<AdminUserListResponse> {
  const { search, page, page_size } = params;

  const [rows, total] = await Promise.all([
    adminRepo.listUsers(search, page, page_size),
    adminRepo.countUsers(search),
  ]);

  return {
    data: rows.map(mapRowToAdminUser),
    total,
    page,
    page_size,
  };
}

/**
 * Create a new user with a temporary password.
 * Encrypts name, hashes password, writes audit log.
 */
export async function createUser(
  input: CreateUserInput,
  adminId: string,
  ip: string,
  ua: string,
): Promise<{ user: AdminUser; temporaryPassword: string }> {
  validateCreateInput(input);

  const exists = await adminRepo.emailExists(input.email);
  if (exists) {
    throw new BusinessRuleError('DUPLICATE_EMAIL', 'A user with this email already exists');
  }

  const tempPassword = crypto.randomBytes(16).toString('hex');
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_COST);
  const { first, last } = splitName(input.name);
  const firstEnc = encrypt(first);
  const lastEnc = last ? encrypt(last) : encrypt('');

  const row = await adminRepo.createUser(input.email, passwordHash, input.role, firstEnc, lastEnc);

  await adminRepo.insertAuditLog(
    adminId,
    'ADMIN_USER_CREATED',
    'users',
    row.id,
    null,
    JSON.stringify({ email: input.email, role: input.role }),
    ip,
    ua,
  );

  logger.info('Admin created user', {
    component: 'admin',
    userId: row.id,
    adminId,
  });

  return { user: mapRowToAdminUser(row), temporaryPassword: tempPassword };
}

/**
 * Validate the create user input fields.
 */
function validateCreateInput(input: CreateUserInput): void {
  if (!VALID_ROLES.includes(input.role)) {
    throw new ValidationError('Invalid role', [
      { field: 'role', message: `Role must be one of: ${VALID_ROLES.join(', ')}` },
    ]);
  }
}

/**
 * Update a user's role and/or status.
 * Writes audit log before returning.
 */
export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  adminId: string,
  ip: string,
  ua: string,
): Promise<AdminUser> {
  validateUpdateInput(input);

  const existing = await adminRepo.findUserById(userId);
  if (!existing) {
    throw new NotFoundError('User', userId);
  }

  const oldValues = {
    role: existing.role,
    is_active: existing.is_active,
  };

  const row = await applyUserUpdate(userId, input, existing);

  await adminRepo.insertAuditLog(
    adminId,
    'ADMIN_USER_UPDATED',
    'users',
    userId,
    JSON.stringify(oldValues),
    JSON.stringify({ role: input.role, status: input.status }),
    ip,
    ua,
  );

  logger.info('Admin updated user', {
    component: 'admin',
    targetUserId: userId,
    adminId,
  });

  return mapRowToAdminUser(row);
}

/**
 * Validate the update user input fields.
 */
function validateUpdateInput(input: UpdateUserInput): void {
  if (input.role !== undefined && !VALID_ROLES.includes(input.role)) {
    throw new ValidationError('Invalid role', [
      { field: 'role', message: `Role must be one of: ${VALID_ROLES.join(', ')}` },
    ]);
  }
}

/**
 * Apply the correct DB update based on which fields are provided.
 */
async function applyUserUpdate(
  userId: string,
  input: UpdateUserInput,
  existing: AdminUserRow,
): Promise<AdminUserRow> {
  const hasRole = input.role !== undefined;
  const hasStatus = input.status !== undefined;
  const isActive = input.status === 'active';

  if (hasRole && hasStatus) {
    return adminRepo.updateUserRoleAndStatus(userId, input.role!, isActive);
  }
  if (hasRole) {
    return adminRepo.updateUserRole(userId, input.role!);
  }
  if (hasStatus) {
    return adminRepo.updateUserStatus(userId, isActive);
  }
  return existing;
}

// =============================================================================
// Risk Config
// =============================================================================

/**
 * List all risk config entries.
 */
export async function listRiskConfig(): Promise<RiskConfigEntry[]> {
  const rows = await adminRepo.listRiskConfig();
  return rows.map(mapRowToRiskConfig);
}

/**
 * Update a risk config value by key.
 * Invalidates the in-memory cache after update.
 */
export async function updateRiskConfig(
  key: string,
  value: number,
  adminId: string,
  ip: string,
  ua: string,
): Promise<RiskConfigEntry> {
  const existing = await adminRepo.findRiskConfigByKey(key);
  if (!existing) {
    throw new NotFoundError('RiskConfig', key);
  }

  const oldValue = existing.value;
  const row = await adminRepo.updateRiskConfig(key, String(value), adminId);

  invalidateRiskConfigCache();

  await adminRepo.insertAuditLog(
    adminId,
    'ADMIN_RISK_CONFIG_UPDATED',
    'risk_config',
    key,
    JSON.stringify({ value: oldValue }),
    JSON.stringify({ value: String(value) }),
    ip,
    ua,
  );

  logger.info('Admin updated risk config', {
    component: 'admin',
    configKey: key,
    adminId,
  });

  return mapRowToRiskConfig(row);
}
