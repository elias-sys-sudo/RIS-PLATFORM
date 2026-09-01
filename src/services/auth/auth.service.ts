import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from 'redis';
import { Queue } from 'bullmq';
import { AuthError, BusinessRuleError, ValidationError } from '../../shared/errors';
import { pool, beginWithRls } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { enqueueWithContext } from '../../shared/workers/queue-helpers';
import * as authRepo from './auth.repository';
import { decrypt } from '../../shared/crypto';
import type {
  LoginResponse,
  AuthUserResponse,
  TokenPayload,
  RefreshTokenPayload,
  Session,
  UserRecord,
  LoginHistoryRecord,
} from './auth.types';

const JWT_SECRET = process.env.JWT_SECRET;
if (JWT_SECRET === null || JWT_SECRET === undefined || JWT_SECRET === '') {
  throw new Error('JWT_SECRET environment variable is required');
}

/**
 * Pre-computed bcrypt hash used for a dummy compare when a user is not found.
 * This equalises response time and prevents timing-based email enumeration.
 * Cost factor matches BCRYPT_COST (12).
 */
const DUMMY_PASSWORD_HASH = '$2b$12$R9h7cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss8KIUgO2t0jKMm6';
const JWT_EXPIRY = process.env.JWT_EXPIRY ?? '15m';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY ?? '7d';
const PARTIAL_AUTH_EXPIRY = '5m';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

let redisClient: ReturnType<typeof createClient> | null = null;
let notificationQueue: Queue | null = null;
let securityAlertsQueue: Queue | null = null;

/** Set the notification queue for auth-related notifications. */
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

/** Set the security alerts queue for failed-auth burst detection. */
export function setSecurityAlertsQueue(queue: Queue): void {
  securityAlertsQueue = queue;
}

/**
 * Set the Redis client used for session management.
 * Called once during server startup.
 */
export function setRedisClient(client: ReturnType<typeof createClient>): void {
  redisClient = client;
}

/**
 * Get Redis client, throwing if not initialised.
 */
function getRedis(): ReturnType<typeof createClient> {
  if (!redisClient) {
    throw new AuthError('Session store not available');
  }
  return redisClient;
}

/**
 * Authenticate a user with email and password.
 * Returns partial_auth token if 2FA enabled, full JWT otherwise.
 * Never reveals whether the email exists.
 */
export async function login(
  email: string,
  password: string,
  ipAddress: string,
  userAgent: string,
): Promise<LoginResponse> {
  const user = await authRepo.findUserByEmail(email);

  if (!user) {
    await rejectUnknownEmail(password, ipAddress, userAgent);
  }

  await guardAccountUsable(user!, ipAddress, userAgent);

  const passwordValid = await bcrypt.compare(password, user!.password_hash);
  if (!passwordValid) {
    await handleFailedPassword(user!, ipAddress, userAgent);
    throw new AuthError('Invalid credentials');
  }

  await authRepo.resetFailedLogin(user!.id);

  if (user!.two_factor_enabled) {
    return issuePartialAuthToken(user!, ipAddress, userAgent);
  }

  return issueFullTokens(user!, ipAddress, userAgent);
}

/**
 * Dummy bcrypt compare + audit for unknown emails.
 * Normalises response time to prevent timing-based enumeration.
 * Always throws — declared as `never` so callers narrow user to non-null.
 */
async function rejectUnknownEmail(
  password: string,
  ipAddress: string,
  userAgent: string,
): Promise<never> {
  await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
  await logFailedLogin(null, 'user_not_found', ipAddress, userAgent);
  throw new AuthError('Invalid credentials');
}

/**
 * Guard that the user account is active and not locked.
 */
async function guardAccountUsable(
  user: UserRecord,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  if (!user.is_active) {
    await logFailedLogin(user.id, 'account_inactive', ipAddress, userAgent);
    throw new AuthError('Invalid credentials');
  }

  if (isAccountLocked(user)) {
    await logFailedLogin(user.id, 'account_locked', ipAddress, userAgent);
    throw new AuthError('Account is temporarily locked');
  }

  if (!user.email_verified) {
    await logFailedLogin(user.id, 'email_not_verified', ipAddress, userAgent);
    throw new AuthError(
      'Please verify your email address before signing in. Check your inbox for the verification link.',
    );
  }
}

/**
 * Verify a TOTP code and issue full access tokens.
 */
export async function verifyTwoFactor(
  partialToken: string,
  totpCode: string,
  ipAddress: string,
  userAgent: string,
): Promise<LoginResponse> {
  const payload = verifyToken(partialToken) as TokenPayload;

  if (payload.type !== 'partial_auth') {
    throw new AuthError('Invalid token type');
  }

  const user = await findUserForTwoFactor(payload.userId);

  // REQ-AUTH-008: 8-character input is a backup code, 6-digit is TOTP.
  if (totpCode.length === BACKUP_CODE_LENGTH) {
    await verifyBackupCodeOrThrow(user, payload.userId, totpCode, ipAddress, userAgent);
  } else {
    await verifyTotpCode(user, payload.userId, totpCode, ipAddress, userAgent);
  }
  await logTwoFactorEvent(payload.userId, true, ipAddress, userAgent);

  return issueFullTokens(user!, ipAddress, userAgent);
}

/**
 * Verify a TOTP code against the user's stored secret.
 * Logs failure and throws on invalid code or missing 2FA config.
 */
async function verifyTotpCode(
  user: UserRecord | null,
  userId: string,
  totpCode: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  if (user === null || user.two_factor_secret === null || user.two_factor_secret === '') {
    await logTwoFactorEvent(userId, false, ipAddress, userAgent);
    throw new AuthError('Two-factor authentication failed');
  }

  const isValid = speakeasy.totp.verify({
    secret: user.two_factor_secret,
    encoding: 'base32',
    token: totpCode,
    window: 1,
  });

  if (!isValid) {
    await logTwoFactorEvent(userId, false, ipAddress, userAgent);
    throw new AuthError('Invalid verification code');
  }
}

// =========================================================================
// REQ-AUTH-008 — TOTP backup codes
// =========================================================================

const BACKUP_CODE_LENGTH = 8;
const BACKUP_CODE_COUNT = 8;

/**
 * Generate 8 single-use backup codes for a user with 2FA enabled.
 * Invalidates any prior unused codes. Returns the RAW codes — only chance
 * the user sees them; only SHA-256 hashes are stored.
 * Caller MUST have step-up-verified the user (verifyStepUp) before invoking.
 */
export async function generateBackupCodes(
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<string[]> {
  const user = await authRepo.findUserById(userId);
  if (!user || !user.two_factor_enabled) {
    throw new BusinessRuleError(
      'AUTH_2FA_NOT_ENABLED',
      'Two-factor authentication must be enabled before generating backup codes',
    );
  }

  const rawCodes = buildBackupCodes(BACKUP_CODE_COUNT);
  await persistBackupCodes(userId, rawCodes);
  await authRepo.createAuditEntry(userId, 'BACKUP_CODES_GENERATED', ipAddress, userAgent, {
    count: BACKUP_CODE_COUNT,
  });
  logger.audit('BACKUP_CODES_GENERATED', { component: 'auth', userId });
  return rawCodes;
}

function buildBackupCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const raw = crypto
      .randomBytes(6)
      .toString('base64url')
      .slice(0, BACKUP_CODE_LENGTH)
      .toUpperCase();
    if (raw.length === BACKUP_CODE_LENGTH) codes.add(raw);
  }
  return Array.from(codes);
}

async function persistBackupCodes(userId: string, rawCodes: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await authRepo.invalidateBackupCodesWithClient(client, userId);
    for (const raw of rawCodes) {
      await authRepo.createBackupCodeWithClient(client, userId, hashToken(raw));
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Try to consume a backup code in place of a TOTP. Throws AuthError on
 * mismatch and audits separately so single-use semantics are auditable.
 */
async function verifyBackupCodeOrThrow(
  user: UserRecord | null,
  userId: string,
  rawCode: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  if (user === null) {
    await logTwoFactorEvent(userId, false, ipAddress, userAgent);
    throw new AuthError('Two-factor authentication failed');
  }
  const codeHash = hashToken(rawCode);
  const record = await authRepo.findUnusedBackupCode(userId, codeHash);
  if (!record) {
    await authRepo.createAuditEntry(userId, 'BACKUP_CODE_INVALID', ipAddress, userAgent, {});
    await logTwoFactorEvent(userId, false, ipAddress, userAgent);
    throw new AuthError('Invalid verification code');
  }
  await consumeBackupCode(record.id, userId, ipAddress, userAgent);
}

async function consumeBackupCode(
  codeId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await authRepo.markBackupCodeUsedWithClient(client, codeId);
    await authRepo.createAuditEntryWithClient(
      client,
      userId,
      'BACKUP_CODE_USED',
      ipAddress,
      userAgent,
      {},
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Invalidate a session by removing it from Redis.
 */
export async function logout(
  sessionId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const redis = getRedis();
  await redis.del(`session:${sessionId}`);

  await authRepo.createAuditEntry(userId, 'LOGOUT', ipAddress, userAgent, { sessionId });

  logger.info('User logged out', {
    component: 'auth',
    userId,
    sessionId,
  });
}

/**
 * Refresh an access token using a valid refresh token.
 * Checks that the session still exists in Redis.
 * Returns both a new access token and a new refresh token.
 */
export async function refreshAccessToken(
  refreshTokenStr: string,
  ipAddress: string,
  userAgent: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: string }> {
  const payload = verifyToken(refreshTokenStr) as RefreshTokenPayload;

  if (payload.type !== 'refresh') {
    throw new AuthError('Invalid token type');
  }

  await rejectIfTokenRevoked(payload);

  const session = await getSession(payload.sessionId);
  if (!session) {
    throw new AuthError('Session expired');
  }

  await blocklistOldRefreshToken(payload);

  const tokens = buildRotatedTokens(payload, session.role);

  await authRepo.createAuditEntry(payload.userId, 'TOKEN_REFRESHED', ipAddress, userAgent, {
    sessionId: payload.sessionId,
  });

  return { ...tokens, expiresIn: JWT_EXPIRY };
}

/**
 * Build a new access + refresh token pair during refresh rotation.
 */
function buildRotatedTokens(
  payload: RefreshTokenPayload,
  role: string,
): { accessToken: string; refreshToken: string } {
  const accessToken = signToken(
    { userId: payload.userId, role, sessionId: payload.sessionId, type: 'full' },
    JWT_EXPIRY,
  );
  const refreshToken = buildRefreshToken(payload.userId, payload.sessionId);
  return { accessToken, refreshToken };
}

/**
 * Redis key used to blocklist a specific refresh token instance.
 * Combines sessionId + iat so each issued token is uniquely identifiable.
 */
function refreshBlocklistKey(sessionId: string, iat: number): string {
  return `rt_blocklist:${sessionId}:${String(iat)}`;
}

/**
 * Reject the request if the incoming refresh token's iat has already been
 * blocklisted (i.e. it was already rotated and the old copy is being re-used).
 */
async function rejectIfTokenRevoked(payload: RefreshTokenPayload): Promise<void> {
  if (payload.iat === undefined) return;
  const redis = getRedis();
  const blocked = await redis.get(refreshBlocklistKey(payload.sessionId, payload.iat));
  if (blocked !== null) {
    throw new AuthError('Refresh token has already been used');
  }
}

/**
 * Add the old refresh token's identity to a Redis blocklist so it can never
 * be re-used after rotation.  TTL is set to the token's remaining lifetime
 * so the key is self-cleaning.
 */
async function blocklistOldRefreshToken(payload: RefreshTokenPayload): Promise<void> {
  if (payload.iat === undefined || payload.exp === undefined) return;
  const redis = getRedis();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttl = payload.exp - nowSeconds;
  if (ttl <= 0) return; // already expired — no need to store
  await redis.set(refreshBlocklistKey(payload.sessionId, payload.iat), '1', { EX: ttl });
}

/**
 * Check if a session exists in Redis (used by auth middleware).
 */
export async function getSession(sessionId: string): Promise<Session | null> {
  const redis = getRedis();
  const data = await redis.get(`session:${sessionId}`);
  if (data === null || data === undefined) {
    return null;
  }
  return JSON.parse(data) as Session;
}

// =========================================================================
// Password reset — request
// =========================================================================

const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const BCRYPT_COST = 12;

/**
 * Request a password reset. Always returns success to prevent email enumeration.
 * If account exists, generates a token and enqueues a notification job.
 */
export async function requestPasswordReset(
  email: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const user = await authRepo.findUserByEmail(email);

  if (!user || !user.is_active) {
    return; // Silent — never reveal whether email exists
  }

  const rawToken = await generateResetToken(user.id);

  await authRepo.createAuditEntry(user.id, 'PASSWORD_RESET_REQUESTED', ipAddress, userAgent, {});
  await enqueueResetEmail(user.id, rawToken);

  logger.audit('PASSWORD_RESET_REQUESTED', {
    component: 'auth',
    userId: user.id,
  });
}

/**
 * Invalidate existing reset tokens and create a fresh one.
 * Returns the raw (unhashed) token for email delivery.
 */
async function generateResetToken(userId: string): Promise<string> {
  await authRepo.invalidateResetTokens(userId);

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

  await authRepo.createResetToken(userId, tokenHash, expiresAt);
  return rawToken;
}

// =========================================================================
// Password reset — execute
// =========================================================================

/**
 * Password complexity policy: min 12 chars with upper/lower/digit/special.
 * Exported so other modules (onboarding) reuse the same regex — single source of truth.
 */
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{12,}$/;
const PASSWORD_HISTORY_DEPTH = 5;

/**
 * Reset password using a valid token.
 * Invalidates all sessions, forcing re-login everywhere.
 */
export async function resetPassword(
  rawToken: string,
  newPassword: string,
  confirmPassword: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  validatePasswordPair(newPassword, confirmPassword);

  const tokenRecord = await validateResetToken(rawToken);
  await checkPasswordHistory(tokenRecord.user_id, newPassword);

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await applyPasswordReset(tokenRecord, passwordHash, ipAddress, userAgent);

  await invalidateAllSessions(tokenRecord.user_id);
  logger.audit('PASSWORD_RESET_COMPLETED', {
    component: 'auth',
    userId: tokenRecord.user_id,
  });
}

/**
 * Verify a raw reset token and return the DB record.
 */
async function validateResetToken(rawToken: string): Promise<{ id: string; user_id: string }> {
  const tokenHash = hashToken(rawToken);
  const tokenRecord = await authRepo.findValidResetToken(tokenHash);
  if (!tokenRecord) {
    throw new AuthError('Invalid or expired reset token');
  }
  return tokenRecord;
}

/**
 * Atomically update password, mark token used, and record history.
 */
async function applyPasswordReset(
  tokenRecord: { id: string; user_id: string },
  passwordHash: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    await authRepo.updatePasswordHashWithClient(client, tokenRecord.user_id, passwordHash);
    await authRepo.markResetTokenUsedWithClient(client, tokenRecord.id);
    await authRepo.createPasswordHistoryEntryWithClient(client, tokenRecord.user_id, passwordHash);

    await authRepo.createAuditEntryWithClient(
      client,
      tokenRecord.user_id,
      'PASSWORD_RESET_COMPLETED',
      ipAddress,
      userAgent,
      {},
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================================
// Change password (authenticated)
// =========================================================================

/**
 * Change password for an authenticated user.
 * Verifies current password, validates new one, invalidates other sessions.
 */
export async function changePassword(
  userId: string,
  sessionId: string,
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  validatePasswordPair(newPassword, confirmPassword);

  const user = await authRepo.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found');
  }

  await guardPasswordChange(user, currentPassword, newPassword);
  await checkPasswordHistory(userId, newPassword);

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await persistPasswordChange(userId, passwordHash, ipAddress, userAgent);

  await invalidateOtherSessions(userId, sessionId);
  logger.audit('PASSWORD_CHANGED', { component: 'auth', userId });
}

/**
 * Verify current password matches and new password differs.
 */
async function guardPasswordChange(
  user: UserRecord,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isMatch) {
    throw new AuthError('Current password is incorrect');
  }

  const isSame = await bcrypt.compare(newPassword, user.password_hash);
  if (isSame) {
    throw new ValidationError('New password must differ from current password', [
      { field: 'new_password', message: 'Cannot reuse current password' },
    ]);
  }
}

/**
 * Atomically update password hash and record in history.
 */
async function persistPasswordChange(
  userId: string,
  passwordHash: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    await authRepo.updatePasswordHashWithClient(client, userId, passwordHash);
    await authRepo.createPasswordHistoryEntryWithClient(client, userId, passwordHash);

    await authRepo.createAuditEntryWithClient(
      client,
      userId,
      'PASSWORD_CHANGED',
      ipAddress,
      userAgent,
      {},
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================================
// Email verification
// =========================================================================

const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h
const EMAIL_VERIFICATION_EXPIRY_HOURS = 24;

/**
 * Generate a fresh verification token for a supplier and enqueue the
 * verification email. Returns nothing — caller does not need the raw token.
 * Used by both onboarding (post-registration) and resendVerificationEmail.
 * Audit entry written so we can prove the token was issued.
 */
export async function issueEmailVerificationToken(
  userId: string,
  email: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const rawToken = await generateEmailVerificationToken(userId);
  await authRepo.createAuditEntry(userId, 'EMAIL_VERIFICATION_REQUESTED', ipAddress, userAgent, {});
  await enqueueVerificationEmail(userId, email, rawToken);
  logger.audit('EMAIL_VERIFICATION_REQUESTED', { component: 'auth', userId });
}

async function generateEmailVerificationToken(userId: string): Promise<string> {
  await authRepo.invalidateEmailVerificationTokens(userId);
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);
  await authRepo.createEmailVerificationToken(userId, tokenHash, expiresAt);
  return rawToken;
}

/**
 * Consume an email verification token. Marks the token used and flips
 * users.email_verified=true atomically. Idempotent against double-click —
 * a second click on the same link returns the same success silently.
 */
export async function verifyEmail(
  rawToken: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const tokenRecord = await authRepo.findValidEmailVerificationToken(tokenHash);
  if (!tokenRecord) {
    await authRepo.createAuditEntry(null, 'EMAIL_VERIFICATION_FAILED', ipAddress, userAgent, {
      reason: 'invalid_or_expired',
    });
    throw new AuthError('Invalid or expired verification link');
  }

  await applyEmailVerification(tokenRecord, ipAddress, userAgent);
  logger.audit('EMAIL_VERIFIED', { component: 'auth', userId: tokenRecord.user_id });
}

async function applyEmailVerification(
  tokenRecord: { id: string; user_id: string },
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);
    await authRepo.markUserEmailVerifiedWithClient(client, tokenRecord.user_id);
    await authRepo.markEmailVerificationTokenUsedWithClient(client, tokenRecord.id);
    await authRepo.createAuditEntryWithClient(
      client,
      tokenRecord.user_id,
      'EMAIL_VERIFIED',
      ipAddress,
      userAgent,
      {},
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Re-send a verification email. Always returns success to avoid email
 * enumeration. Silently no-ops if the account is missing, already verified,
 * or inactive — the caller can never tell which case applied.
 */
export async function resendVerificationEmail(
  email: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const user = await authRepo.findUserByEmail(email);
  if (!user || !user.is_active || user.email_verified) {
    return;
  }
  const rawToken = await generateEmailVerificationToken(user.id);
  await authRepo.createAuditEntry(user.id, 'EMAIL_VERIFICATION_RESENT', ipAddress, userAgent, {});
  await enqueueVerificationEmail(user.id, user.email, rawToken);
  logger.audit('EMAIL_VERIFICATION_RESENT', { component: 'auth', userId: user.id });
}

async function enqueueVerificationEmail(
  userId: string,
  email: string,
  rawToken: string,
): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'auth',
      jobName: 'send-email',
      template: 'email_verification',
    });
    return;
  }
  try {
    const baseUrl = process.env.FRONTEND_URL ?? 'https://app.ris.ug';
    const verificationUrl = `${baseUrl}/verify-email?token=${rawToken}`;
    await enqueueWithContext(
      notificationQueue,
      'send-email',
      {
        id: uuidv4(),
        channel: 'email',
        template: 'email_verification',
        recipient: email,
        data: {
          verification_url: verificationUrl,
          expiry_hours: EMAIL_VERIFICATION_EXPIRY_HOURS,
          user_name: 'Supplier',
        },
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 30000 } },
    );
  } catch (err: unknown) {
    logger.error('Failed to enqueue verification email', {
      component: 'auth',
      userId,
      errorMessage: err instanceof Error ? err.message : 'Unknown',
    });
  }
}

// =========================================================================
// Supplier buyers
// =========================================================================

/**
 * List buyers for a given supplier via their invoice relationships.
 */
export interface SupplierBuyerResponse {
  id: string;
  company_name: string;
  contact_email: string;
  contact_phone: string;
  is_active: boolean;
  total_invoices: number;
  total_outstanding: string;
}

export async function listBuyersForSupplier(
  supplierId: string,
  params: { page: number; limit: number; search?: string; status?: string },
): Promise<{
  data: SupplierBuyerResponse[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const { rows, total } = await authRepo.listBuyersForSupplier(supplierId, params);
  const totalPages = Math.ceil(total / params.limit);
  const data = rows.map(decryptBuyerRow);

  return {
    data,
    pagination: { page: params.page, limit: params.limit, total, totalPages },
  };
}

/**
 * Decrypt PII fields on a single buyer row.
 * Repository stores ciphertext only; service layer decrypts.
 */
function decryptBuyerRow(row: {
  id: string;
  company_name: string;
  contact_email_encrypted: string | null;
  contact_phone_encrypted: string | null;
  is_active: boolean;
  total_invoices: number;
  total_outstanding: string;
}): SupplierBuyerResponse {
  return {
    id: row.id,
    company_name: row.company_name,
    contact_email: row.contact_email_encrypted ? decrypt(row.contact_email_encrypted) : '',
    contact_phone: row.contact_phone_encrypted ? decrypt(row.contact_phone_encrypted) : '',
    is_active: row.is_active,
    total_invoices: row.total_invoices,
    total_outstanding: row.total_outstanding,
  };
}

// =========================================================================
// Private helpers
// =========================================================================

/**
 * Build an AuthUserResponse by decrypting stored name fields.
 * Falls back to the email prefix if no encrypted name is stored.
 */
async function buildUserProfile(
  userId: string,
  email: string,
  role: string,
): Promise<AuthUserResponse> {
  const profile = await authRepo.fetchUserProfile(userId);
  let name = email.split('@')[0];

  if (profile?.first_name_encrypted !== null && profile?.first_name_encrypted !== undefined) {
    const first = decrypt(profile.first_name_encrypted);
    const last =
      profile.last_name_encrypted !== null && profile.last_name_encrypted !== undefined
        ? decrypt(profile.last_name_encrypted)
        : '';
    name = `${first} ${last}`.trim();
  }

  return { id: userId, email, name, role };
}

function isAccountLocked(user: UserRecord): boolean {
  if (!user.locked_until) {
    return false;
  }
  return new Date(user.locked_until) > new Date();
}

async function handleFailedPassword(
  user: UserRecord,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await recordFailedPasswordTxn(user, ipAddress, userAgent);
  logFailedPasswordEvents(user);
  await checkFailedAuthBurst(ipAddress);
}

/**
 * Transaction: increment failed count, audit, and optionally lock account.
 */
async function recordFailedPasswordTxn(
  user: UserRecord,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await authRepo.getClient();
  try {
    await beginWithRls(client);

    const newCount = await authRepo.incrementFailedLoginWithClient(client, user.id);

    await authRepo.createAuditEntryWithClient(
      client,
      user.id,
      'LOGIN_FAILED',
      ipAddress,
      userAgent,
      { reason: 'wrong_password' },
    );

    if (newCount >= MAX_FAILED_ATTEMPTS) {
      await lockAccountInTxn(client, user.id, newCount, ipAddress, userAgent);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Lock account and write audit entry within an existing transaction.
 */
async function lockAccountInTxn(
  client: Awaited<ReturnType<typeof authRepo.getClient>>,
  userId: string,
  failedAttempts: number,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
  await authRepo.lockAccountWithClient(client, userId, lockedUntil);

  await authRepo.createAuditEntryWithClient(
    client,
    userId,
    'ACCOUNT_LOCKED',
    ipAddress,
    userAgent,
    { failedAttempts, lockedUntilIso: lockedUntil.toISOString() },
  );
}

/**
 * Post-commit logging for failed password events.
 */
function logFailedPasswordEvents(user: UserRecord): void {
  if (user.failed_login_count + 1 >= MAX_FAILED_ATTEMPTS) {
    logger.audit('ACCOUNT_LOCKED', { component: 'auth', userId: user.id });
  }
  logger.audit('LOGIN_FAILED', {
    component: 'auth',
    userId: user.id,
    reason: 'wrong_password',
  });
}

/**
 * Check if an IP has 5+ failed logins in 15 minutes and queue an alert.
 * Non-blocking: if queue is not configured, silently returns.
 */
async function checkFailedAuthBurst(ipAddress: string): Promise<void> {
  if (!securityAlertsQueue) {
    return;
  }

  const windowMinutes = 15;
  const threshold = 5;
  const recentFailures = await authRepo.getRecentFailedLoginsByIp(ipAddress, windowMinutes);

  if (recentFailures < threshold) {
    return;
  }

  await enqueueWithContext(
    securityAlertsQueue,
    'security-alert',
    {
      type: 'FAILED_AUTH_BURST',
      entityId: ipAddress,
      entityType: 'ip_address',
      metadata: { failureCount: recentFailures, windowMinutes },
      timestamp: new Date().toISOString(),
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}

async function issuePartialAuthToken(
  user: UserRecord,
  ipAddress: string,
  userAgent: string,
): Promise<LoginResponse> {
  const sessionId = uuidv4();

  const accessToken = signToken(
    { userId: user.id, role: user.role, sessionId, type: 'partial_auth' },
    PARTIAL_AUTH_EXPIRY,
  );

  await auditPartialAuth(user.id, sessionId, ipAddress, userAgent);

  return buildPartialAuthResponse(accessToken);
}

async function auditPartialAuth(
  userId: string,
  sessionId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await authRepo.createAuditEntry(userId, 'LOGIN_SUCCESS', ipAddress, userAgent, {
    requiresTwoFactor: true,
    sessionId,
  });
}

function buildPartialAuthResponse(accessToken: string): LoginResponse {
  return {
    accessToken,
    tokenType: 'partial_auth',
    expiresIn: PARTIAL_AUTH_EXPIRY,
    requiresTwoFactor: true,
  };
}

async function issueFullTokens(
  user: UserRecord,
  ipAddress: string,
  userAgent: string,
): Promise<LoginResponse> {
  const sessionId = uuidv4();
  // Check device recency BEFORE writing the current login row, so the
  // just-now login does not satisfy the "seen in last 30 days" check.
  const isNewDevice = !(await authRepo.hasRecentLoginWithSameUserAgent(
    user.id,
    userAgent,
    NEW_DEVICE_LOOKBACK_DAYS,
  ));

  await createSession(sessionId, user);
  await authRepo.recordLogin(user.id);
  await recordSuccessfulLogin(user.id, ipAddress, userAgent);

  const accessToken = signToken(
    { userId: user.id, role: user.role, sessionId, type: 'full' },
    JWT_EXPIRY,
  );
  const refreshToken = buildRefreshToken(user.id, sessionId);
  const userProfile = await buildUserProfile(user.id, user.email, user.role);

  await auditFullLogin(user.id, sessionId, ipAddress, userAgent);
  if (isNewDevice) {
    await notifyNewDevice(user, ipAddress, userAgent);
  }

  return buildFullAuthResponse(accessToken, refreshToken, userProfile);
}

// REQ-AUTH-007 — new-device threshold (days)
const NEW_DEVICE_LOOKBACK_DAYS = 30;

/**
 * Best-effort: enqueue a "new device sign-in" alert email. Audit and continue
 * on failure — a notification outage must not block the user's login.
 */
async function notifyNewDevice(
  user: UserRecord,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  try {
    await authRepo.createAuditEntry(user.id, 'NEW_DEVICE_LOGIN_NOTIFIED', ipAddress, userAgent, {
      newDevice: true,
    });
    if (!notificationQueue) {
      logger.warn('Notification queue not configured — skipping new-device email', {
        component: 'auth',
        userId: user.id,
      });
      return;
    }
    const baseUrl = process.env.FRONTEND_URL ?? 'https://app.ris.ug';
    await enqueueWithContext(
      notificationQueue,
      'send-email',
      {
        id: uuidv4(),
        channel: 'email',
        template: 'new_device_login',
        recipient: user.email,
        data: {
          user_name: 'there',
          ip_address: ipAddress,
          user_agent: userAgent,
          login_timestamp: new Date().toISOString(),
          reset_url: `${baseUrl}/forgot-password`,
        },
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 30000 } },
    );
  } catch (err: unknown) {
    logger.error('Failed to send new-device login alert', {
      component: 'auth',
      userId: user.id,
      errorMessage: err instanceof Error ? err.message : 'Unknown',
    });
  }
}

async function auditFullLogin(
  userId: string,
  sessionId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await authRepo.createAuditEntry(userId, 'LOGIN_SUCCESS', ipAddress, userAgent, {
    sessionId,
    tokenType: 'full',
  });
  logger.audit('LOGIN_SUCCESS', { component: 'auth', userId, sessionId });
}

function buildFullAuthResponse(
  accessToken: string,
  refreshToken: string,
  user: AuthUserResponse,
): LoginResponse {
  return {
    accessToken,
    refreshToken,
    user,
    tokenType: 'full',
    expiresIn: JWT_EXPIRY,
    requiresTwoFactor: false,
  };
}

async function createSession(sessionId: string, user: UserRecord): Promise<void> {
  const redis = getRedis();
  const session: Session = {
    sessionId,
    userId: user.id,
    role: user.role,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
  };
  await redis.set(`session:${sessionId}`, JSON.stringify(session), { EX: SESSION_TTL_SECONDS });
}

function signToken(payload: TokenPayload | RefreshTokenPayload, expiresIn: string): string {
  const { iat, exp, ...claims } = payload;
  void iat;
  void exp;
  return jwt.sign(claims, JWT_SECRET as string, {
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

function verifyToken(token: string): TokenPayload | RefreshTokenPayload {
  try {
    return jwt.verify(token, JWT_SECRET as string, {
      algorithms: ['HS256'],
    }) as TokenPayload | RefreshTokenPayload;
  } catch {
    throw new AuthError('Invalid or expired token');
  }
}

/**
 * Build a refresh token for cookie storage.
 */
export function buildRefreshToken(userId: string, sessionId: string): string {
  return signToken({ userId, sessionId, type: 'refresh' }, REFRESH_TOKEN_EXPIRY);
}

// =========================================================================
// Step-up authentication — re-verify TOTP for sensitive actions
// =========================================================================

/**
 * Verify a TOTP code for an already-authenticated user.
 * Used by sensitive action gates (e.g. payment approval, dual-auth confirmation).
 * Does NOT issue new tokens — caller is already holding a valid JWT.
 * Throws AuthError on invalid code or if 2FA is not configured.
 */
export async function verifyStepUp(
  userId: string,
  totpCode: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const user = await findUserForTwoFactor(userId);

  await guardStepUpConfigured(user, userId, ipAddress, userAgent);
  await verifyStepUpCode(user!, totpCode, userId, ipAddress, userAgent);

  await authRepo.createAuditEntry(userId, 'STEP_UP_VERIFIED', ipAddress, userAgent, {});
  logger.audit('STEP_UP_VERIFIED', { component: 'auth', userId });
}

/**
 * Guard that the user has 2FA configured for step-up verification.
 */
async function guardStepUpConfigured(
  user: UserRecord | null,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  if (user === null || !user.two_factor_enabled || !user.two_factor_secret) {
    await authRepo.createAuditEntry(userId, 'STEP_UP_FAILED', ipAddress, userAgent, {
      reason: '2fa_not_configured',
    });
    throw new AuthError('Two-factor authentication is required for this action');
  }
}

/**
 * Verify a TOTP code for step-up auth, auditing on failure.
 */
async function verifyStepUpCode(
  user: UserRecord,
  totpCode: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const isValid = speakeasy.totp.verify({
    secret: user.two_factor_secret!,
    encoding: 'base32',
    token: totpCode,
    window: 1,
  });

  if (!isValid) {
    await authRepo.createAuditEntry(userId, 'STEP_UP_FAILED', ipAddress, userAgent, {
      reason: 'invalid_code',
    });
    throw new AuthError('Invalid verification code');
  }
}

async function findUserForTwoFactor(userId: string): Promise<UserRecord | null> {
  const { query: dbQuery } = await import('../../shared/database/pool');
  const result = await dbQuery<UserRecord>(
    `SELECT id, email, password_hash, role, is_active, email_verified,
            two_factor_enabled, two_factor_secret,
            failed_login_count, locked_until
     FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

async function logFailedLogin(
  userId: string | null,
  reason: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await authRepo.createLoginHistoryEntry(userId, ipAddress, userAgent, null, false);
  await authRepo.createAuditEntry(userId, 'LOGIN_FAILED', ipAddress, userAgent, { reason });

  logger.audit('LOGIN_FAILED', {
    component: 'auth',
    userId,
    reason,
  });
}

async function logTwoFactorEvent(
  userId: string,
  success: boolean,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const action = success ? 'TWO_FA_SUCCESS' : 'TWO_FA_FAILED';

  await authRepo.createAuditEntry(userId, action, ipAddress, userAgent, {});

  logger.audit(action, {
    component: 'auth',
    userId,
  });
}

/**
 * SHA-256 hash a raw token for safe storage/lookup.
 */
function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Validate password meets policy and matches confirmation.
 */
function validatePasswordPair(password: string, confirm: string): void {
  if (password !== confirm) {
    throw new ValidationError('Passwords do not match', [
      { field: 'confirm_password', message: 'Must match new_password' },
    ]);
  }
  if (!PASSWORD_REGEX.test(password)) {
    throw new ValidationError('Password does not meet policy', [
      {
        field: 'new_password',
        message: 'Min 12 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special character',
      },
    ]);
  }
}

/**
 * Invalidate ALL sessions for a user (force re-login everywhere).
 */
async function invalidateAllSessions(userId: string): Promise<void> {
  const redis = getRedis();
  const pattern = `session:*`;
  await deleteSessionsByUserId(redis, userId, pattern);
}

/**
 * Invalidate all sessions EXCEPT the current one.
 */
async function invalidateOtherSessions(userId: string, keepSessionId: string): Promise<void> {
  const redis = getRedis();
  const pattern = `session:*`;
  await deleteSessionsByUserId(redis, userId, pattern, keepSessionId);
}

/**
 * Scan Redis for sessions belonging to a user and delete them.
 */
async function deleteSessionsByUserId(
  redis: ReturnType<typeof createClient>,
  userId: string,
  pattern: string,
  keepSessionId?: string,
): Promise<void> {
  let cursor = 0;
  do {
    const result = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = result.cursor;
    for (const key of result.keys) {
      const data = await redis.get(key);
      if (data !== null) {
        const session = JSON.parse(data) as Session;
        if (session.userId === userId) {
          if (keepSessionId !== undefined && session.sessionId === keepSessionId) {
            continue;
          }
          await redis.del(key);
        }
      }
    }
  } while (cursor !== 0);
}

// =========================================================================
// Login activity
// =========================================================================

/**
 * Retrieve recent login activity for a user.
 */
export async function getLoginActivity(userId: string): Promise<LoginHistoryRecord[]> {
  return authRepo.getLoginHistory(userId, 20);
}

// =========================================================================
// Concurrent sessions
// =========================================================================

/**
 * Get all active sessions for a user from Redis.
 */
export async function getActiveSessions(
  userId: string,
): Promise<Array<{ sessionId: string; createdAt: string; expiresAt: string }>> {
  const redis = getRedis();
  return scanUserSessions(redis, userId);
}

/**
 * Scan Redis for all sessions belonging to a user and return summaries.
 */
async function scanUserSessions(
  redis: ReturnType<typeof createClient>,
  userId: string,
): Promise<Array<{ sessionId: string; createdAt: string; expiresAt: string }>> {
  const sessions: Array<{ sessionId: string; createdAt: string; expiresAt: string }> = [];
  let cursor = 0;

  do {
    const result = await redis.scan(cursor, { MATCH: 'session:*', COUNT: 100 });
    cursor = result.cursor;
    for (const key of result.keys) {
      const data = await redis.get(key);
      if (data !== null) {
        const session = JSON.parse(data) as Session;
        if (session.userId === userId) {
          sessions.push({
            sessionId: session.sessionId,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
          });
        }
      }
    }
  } while (cursor !== 0);

  return sessions;
}

/**
 * Revoke a specific session belonging to the user.
 */
export async function revokeSession(sessionId: string, userId: string): Promise<void> {
  const redis = getRedis();
  const data = await redis.get(`session:${sessionId}`);

  if (data === null) {
    return;
  }

  const session = JSON.parse(data) as Session;
  if (session.userId !== userId) {
    return;
  }

  await redis.del(`session:${sessionId}`);

  logger.audit('SESSION_REVOKED', {
    component: 'auth',
    userId,
    sessionId,
  });
}

// =========================================================================
// Inactive accounts
// =========================================================================

const INACTIVE_DISABLE_DAYS = 180;
const INACTIVE_WARNING_DAYS = 150;

/**
 * Disable user accounts that have been inactive for 180+ days.
 */
export async function checkInactiveAccounts(): Promise<void> {
  const users = await authRepo.findInactiveUsers(INACTIVE_DISABLE_DAYS);

  for (const user of users) {
    await authRepo.disableUserAccount(user.id);
    await authRepo.createAuditEntry(null, 'INACTIVE_ACCOUNT_DISABLED', null, null, {
      userId: user.id,
      inactiveDays: INACTIVE_DISABLE_DAYS,
    });

    logger.audit('INACTIVE_ACCOUNT_DISABLED', {
      component: 'auth',
      userId: user.id,
    });
  }
}

/**
 * Send warnings to users approaching inactivity threshold.
 */
export async function sendInactiveWarnings(): Promise<void> {
  const users = await authRepo.findUsersForInactiveWarning(INACTIVE_WARNING_DAYS);

  for (const user of users) {
    await queueInactiveWarning(user.id);
    await authRepo.markInactiveWarningSent(user.id);
    await authRepo.createAuditEntry(null, 'INACTIVE_WARNING_SENT', null, null, {
      userId: user.id,
      warningDays: INACTIVE_WARNING_DAYS,
    });

    logger.audit('INACTIVE_WARNING_SENT', {
      component: 'auth',
      userId: user.id,
    });
  }
}

// =========================================================================
// Private helpers — password history & login history
// =========================================================================

/**
 * Check if newPassword matches any of the last N stored passwords.
 */
async function checkPasswordHistory(userId: string, newPassword: string): Promise<void> {
  const history = await authRepo.getLastNPasswords(userId, PASSWORD_HISTORY_DEPTH);

  for (const entry of history) {
    const matches = await bcrypt.compare(newPassword, entry.password_hash);
    if (matches) {
      throw new BusinessRuleError('PASSWORD_RECENTLY_USED', 'Cannot reuse last 5 passwords');
    }
  }
}

/**
 * Record a successful login in login_history.
 */
async function recordSuccessfulLogin(
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await authRepo.createLoginHistoryEntry(userId, ipAddress, userAgent, null, true);
}

/**
 * Enqueue an inactive account warning notification.
 */
async function queueInactiveWarning(userId: string): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'auth',
      userId,
    });
    return;
  }

  await enqueueWithContext(
    notificationQueue,
    'inactive-account-warning',
    { userId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    },
  );
}

/**
 * Enqueue a password reset email notification job via the shared queue.
 * The notification worker processes it via SendGrid.
 */
async function enqueueResetEmail(userId: string, rawToken: string): Promise<void> {
  if (!notificationQueue) {
    logger.warn('Notification queue not configured', {
      component: 'auth',
      jobName: 'send-email',
    });
    return;
  }

  try {
    const payload = buildResetEmailPayload(userId, rawToken);
    await enqueueWithContext(notificationQueue, 'send-email', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    });
  } catch (err: unknown) {
    logger.error('Failed to enqueue reset email', {
      component: 'auth',
      errorMessage: err instanceof Error ? err.message : 'Unknown',
    });
  }
}

/**
 * Build the notification payload for a password reset email.
 */
function buildResetEmailPayload(
  userId: string,
  rawToken: string,
): { channel: string; template: string; recipientUserId: string; data: Record<string, unknown> } {
  const baseUrl = process.env.FRONTEND_URL ?? 'https://app.ris.ug';
  const tokenUrl = `${baseUrl}/reset-password?token=${rawToken}`;
  return {
    channel: 'email',
    template: 'password_reset',
    recipientUserId: userId,
    data: { token_url: tokenUrl, expiry_minutes: 60 },
  };
}
