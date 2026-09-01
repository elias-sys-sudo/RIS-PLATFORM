// =============================================================================
// AML Clearance — Types, Interfaces & Enums
// =============================================================================

/** Error codes specific to compliance workflows (AML clearance). */
export enum ComplianceErrorCode {
  AML_ALREADY_CLEARED = 'AML_ALREADY_CLEARED',
  INVOICE_NOT_FLAGGED = 'INVOICE_NOT_FLAGGED',
}

/** Audit log actions emitted by this module. */
export enum AmlAuditAction {
  AML_CLEARED = 'AML_CLEARED',
  AML_DETAIL_VIEWED = 'AML_DETAIL_VIEWED',
}

// -------------------------------------------------------------------------
// Input types
// -------------------------------------------------------------------------

/** Body shape for POST /admin/aml/clear/:id. */
export interface ClearAmlInput {
  reason: string;
  sanctions_check_complete: true;
}

// -------------------------------------------------------------------------
// DB row types
// -------------------------------------------------------------------------

/**
 * Queue list row — NO decrypted PII per refinement 4 (PDPA 2019 minimisation).
 * Only IDs, money values, and timestamps. Names/emails/phones MUST NOT appear.
 */
export interface AmlQueueRow {
  invoice_id: string;
  supplier_id: string;
  buyer_id: string;
  face_value: string;
  aml_flagged_at: string;
  created_at: string;
  days_flagged: number;
}

/**
 * Detail view row — decrypted supplier/buyer company names are present. The
 * repository MUST audit-log every read of this shape (action AML_DETAIL_VIEWED)
 * per PDPA 2019 access-tracking.
 */
export interface AmlDetailRow {
  invoice_id: string;
  supplier_id: string;
  buyer_id: string;
  face_value: string;
  aml_flagged: boolean;
  aml_cleared_at: string | null;
  aml_cleared_by: string | null;
  aml_clearance_reason: string | null;
  status: string;
  created_at: string;
  supplier_company_name_encrypted: string | null;
  buyer_company_name_encrypted: string | null;
  invoice_number: string;
}

/** Decrypted detail returned to the caller. */
export interface AmlDetailResponse {
  invoice_id: string;
  invoice_number: string;
  supplier_id: string;
  buyer_id: string;
  supplier_company_name: string;
  buyer_company_name: string;
  face_value: string;
  aml_flagged: boolean;
  aml_cleared_at: string | null;
  aml_cleared_by: string | null;
  aml_clearance_reason: string | null;
  status: string;
  created_at: string;
}

/** Invoice fields read by the clearance service to enforce immutability. */
export interface InvoiceClearanceState {
  id: string;
  aml_flagged: boolean;
  aml_cleared_at: string | null;
}

/** Result of a successful clearance. */
export interface ClearAmlResult {
  invoice_id: string;
  aml_cleared_at: string;
  aml_cleared_by: string;
}
