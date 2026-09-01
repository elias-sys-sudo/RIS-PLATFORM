import type { Role } from './auth.types';

// ── Admin user management ─────────────────────────────────────────────────────

export type UserStatus = 'active' | 'inactive';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  lastLogin: string | null;
  createdAt: string;
}

export interface CreateUserRequest {
  name: string;
  email: string;
  role: Role;
}

export interface CreateUserResponse {
  user: AdminUser;
  temporaryPassword: string;
}

export interface UpdateUserRequest {
  role?: Role;
  status?: UserStatus;
}

export interface PaginatedAdminUsers {
  data: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Risk configuration ────────────────────────────────────────────────────────

export type RiskConfigCategory = 'weight' | 'threshold' | 'limit' | 'rate';

export interface RiskConfigEntry {
  key: string;
  value: number;
  description: string;
  category: RiskConfigCategory;
  lastUpdated: string;
  updatedBy: string;
}

export interface UpdateRiskConfigRequest {
  key: string;
  value: number;
}
