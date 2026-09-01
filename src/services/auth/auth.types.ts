export interface LoginRequest {
  email: string;
  password: string;
}

/** User profile returned to the frontend after login. */
export interface AuthUserResponse {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  user?: AuthUserResponse;
  tokenType: 'full' | 'partial_auth';
  expiresIn: string;
  requiresTwoFactor: boolean;
}

export interface TokenPayload {
  userId: string;
  role: string;
  sessionId: string;
  type: 'full' | 'partial_auth';
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  userId: string;
  sessionId: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}

export interface TwoFactorRequest {
  code: string;
  partialAuthToken: string;
}

export interface Session {
  sessionId: string;
  userId: string;
  role: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuthEvent {
  userId: string | null;
  action: string;
  ipAddress: string;
  userAgent: string;
  metadata: Record<string, unknown>;
}

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  is_active: boolean;
  email_verified: boolean;
  two_factor_enabled: boolean;
  two_factor_secret: string | null;
  failed_login_count: number;
  locked_until: Date | null;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  new_password: string;
  confirm_password: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export interface PasswordResetTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export interface EmailVerificationTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  verified_at: Date | null;
  created_at: Date;
}

export interface BackupCodeRecord {
  id: string;
  user_id: string;
  code_hash: string;
  used_at: Date | null;
  created_at: Date;
}

/** Raw DB row for user profile (name fields are encrypted). */
export interface UserProfileRow {
  id: string;
  email: string;
  role: string;
  first_name_encrypted: string | null;
  last_name_encrypted: string | null;
}

/** Login history DB row. */
export interface LoginHistoryRecord {
  id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  country: string | null;
  success: boolean;
  created_at: string;
}

/** Password history DB row. */
export interface PasswordHistoryRecord {
  id: string;
  user_id: string;
  password_hash: string;
  created_at: string;
}

export type AuthAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'ACCOUNT_LOCKED'
  | 'TWO_FA_SUCCESS'
  | 'TWO_FA_FAILED'
  | 'LOGOUT'
  | 'TOKEN_REFRESHED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'PASSWORD_CHANGED'
  | 'INACTIVE_ACCOUNT_DISABLED'
  | 'INACTIVE_WARNING_SENT'
  | 'STEP_UP_VERIFIED'
  | 'STEP_UP_FAILED'
  | 'EMAIL_VERIFICATION_REQUESTED'
  | 'EMAIL_VERIFICATION_RESENT'
  | 'EMAIL_VERIFIED'
  | 'EMAIL_VERIFICATION_FAILED'
  | 'NEW_DEVICE_LOGIN_NOTIFIED'
  | 'BACKUP_CODES_GENERATED'
  | 'BACKUP_CODE_USED'
  | 'BACKUP_CODE_INVALID';
