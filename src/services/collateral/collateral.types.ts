// =============================================================================
// Collateral — Types, Interfaces & Enums
// =============================================================================

/** Collateral types for the extended CRUD module. */
export type CollateralType =
  | 'bank_guarantee'
  | 'fixed_deposit_lien'
  | 'post_dated_cheque_full_value'
  | 'corporate_guarantee'
  | 'assignment_of_receivables'
  | 'performance_bond'
  | 'none';

/** Enforceability status tracking for collateral items. */
export type CollateralEnforceabilityStatus =
  | 'pending_perfection'
  | 'perfected'
  | 'expired'
  | 'contested'
  | 'released';

/** Full collateral record from DB. */
export interface CollateralRecord {
  id: string;
  invoice_id: string | null;
  supplier_id: string;
  collateral_type: string;
  value: string;
  description: string | null;
  currency: string;
  expiry_date: string | null;
  is_active: boolean;
  enforceability_status: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Document reference attached to collateral. */
export interface CollateralDocumentRef {
  id: string;
  document_id: string;
  created_at: string;
}

/** Create collateral input. */
export interface CreateCollateralInput {
  invoice_id: string;
  type: CollateralType;
  description: string;
  estimated_value: string;
  currency: string;
  documents: string[];
  expiry_date?: string;
}

/** Update collateral input. */
export interface UpdateCollateralInput {
  type?: CollateralType;
  description?: string;
  estimated_value?: string;
  currency?: string;
  documents?: string[];
  expiry_date?: string | null;
}
