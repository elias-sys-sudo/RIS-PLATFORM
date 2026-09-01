/**
 * User profile returned to the frontend.
 * Names and phone are decrypted before returning.
 */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
}

/**
 * Input for updating a user profile.
 * All fields are optional — only provided fields are updated.
 */
export interface UpdateProfileInput {
  name?: string;
  email?: string;
  phone?: string;
}

/**
 * Raw row from the users table for profile queries.
 */
export interface UserProfileRow {
  id: string;
  email: string;
  first_name_encrypted: string | null;
  last_name_encrypted: string | null;
  phone_encrypted: string | null;
}

/**
 * Notification preferences object — mirrors the user_settings table columns.
 */
export interface NotificationPreferences {
  email_notifications: boolean;
  sms_notifications: boolean;
  in_app_notifications: boolean;
}

/**
 * Raw row returned from the user_settings table.
 */
export interface UserSettingsRow {
  id: string;
  user_id: string;
  email_notifications: boolean;
  sms_notifications: boolean;
  in_app_notifications: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Personal data export returned by PDPA data subject access request.
 * All encrypted fields are decrypted before returning to the authenticated user.
 */
export interface PersonalDataExport {
  user: {
    id: string;
    email: string;
    name: string;
    phone: string;
    role: string;
    created_at: string;
  };
  supplier: {
    id: string;
    company_name: string;
    registration_number: string;
    bank_account_number: string;
    bank_account_name: string;
    mobile_money_number: string;
    kyc_status: string;
  } | null;
  exported_at: string;
}

/**
 * Raw supplier PII row from the database.
 */
export interface SupplierPiiRow {
  id: string;
  company_name_encrypted: string | null;
  registration_number: string;
  bank_account_number_encrypted: string | null;
  bank_account_name_encrypted: string | null;
  mobile_money_number_encrypted: string | null;
  kyc_status: string;
}

/**
 * Raw user PII row from the database (extended for data export).
 */
export interface UserPiiRow {
  id: string;
  email: string;
  first_name_encrypted: string | null;
  last_name_encrypted: string | null;
  phone_encrypted: string | null;
  role: string;
  created_at: string;
}

/**
 * Audit action types for settings operations.
 */
export type SettingsAction =
  | 'PROFILE_UPDATED'
  | 'NOTIFICATION_PREFS_UPDATED'
  | 'DATA_SUBJECT_ACCESS_REQUEST'
  | 'DATA_DELETION_REQUEST'
  | 'KILL_SWITCH_TOGGLED'
  | 'CONFIG_CHANGE_PROPOSED'
  | 'CONFIG_CHANGE_APPROVED';

/**
 * Result returned after requesting account deletion (PDPA right-to-delete).
 */
export interface DeletionRequestResult {
  message: string;
  deletion_scheduled_at: string;
  cooling_off_days: number;
}

/**
 * Row from pending_config_changes table.
 */
export interface PendingConfigChangeRow {
  id: string;
  config_key: string;
  current_value: string | null;
  proposed_value: string;
  proposed_by: string;
  approved_by: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
}
