/** Canonical platform role union — single source of truth. `@/lib/constants`
 *  re-exports this type so both import paths stay in sync. */
export type Role =
  | 'supplier'
  | 'credit_officer'
  | 'finance_manager'
  | 'management'
  | 'compliance_officer'
  | 'auditor'
  | 'legal';

export type KycStatus = 'pending' | 'in_progress' | 'approved' | 'rejected';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  kycStatus?: KycStatus;
  twoFactorEnabled?: boolean;
  createdAt?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
}

export interface RefreshResponse {
  accessToken: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  new_password: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
  confirm_password: string;
}
