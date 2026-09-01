// =============================================================================
// Admin Module — TypeScript interfaces
// =============================================================================

/** Admin user response returned to the frontend. */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'inactive';
  last_login: string | null;
  created_at: string;
}

/** Raw DB row for admin user listing (name fields are encrypted). */
export interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  first_name_encrypted: string | null;
  last_name_encrypted: string | null;
  last_login_at: string | null;
  created_at: string;
}

/** Input for creating a new user via admin panel. */
export interface CreateUserInput {
  name: string;
  email: string;
  role: string;
}

/** Input for updating a user via admin panel. */
export interface UpdateUserInput {
  role?: string;
  status?: 'active' | 'inactive';
}

/** Risk config entry returned to the frontend. */
export interface RiskConfigEntry {
  key: string;
  value: string;
  description: string;
  category: 'weight' | 'threshold' | 'limit' | 'rate';
  last_updated: string;
  updated_by: string;
}

/** Raw DB row for risk_config table. */
export interface RiskConfigRow {
  key: string;
  value: string;
  description: string;
  updated_at: string;
  updated_by: string;
}

/** Paginated list response for admin user listing. */
export interface AdminUserListResponse {
  data: AdminUser[];
  total: number;
  page: number;
  page_size: number;
}

/** Params for listing users. */
export interface ListUsersParams {
  search?: string;
  page: number;
  page_size: number;
}
