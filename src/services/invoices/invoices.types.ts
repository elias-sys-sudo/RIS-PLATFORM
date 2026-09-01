export enum InvoiceStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  BUYER_CONFIRMED = 'buyer_confirmed',
  SCORED = 'scored',
  PRICED = 'priced',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PENDING_FIRST_AUTH = 'pending_first_auth',
  PENDING_SECOND_AUTH = 'pending_second_auth',
  EXECUTING = 'executing',
  FUNDED = 'funded',
  COLLECTING = 'collecting',
  OVERDUE = 'overdue',
  COLLECTED = 'collected',
  DEFAULTED = 'defaulted',
  CANCELLED = 'cancelled',
  WITHDRAWN = 'withdrawn',
}

export enum ValidationErrorCode {
  SUPPLIER_NOT_APPROVED = 'SUPPLIER_NOT_APPROVED',
  DUPLICATE_INVOICE = 'DUPLICATE_INVOICE',
  BUYER_NOT_APPROVED = 'BUYER_NOT_APPROVED',
  TENOR_OUT_OF_RANGE = 'TENOR_OUT_OF_RANGE',
  CREDIT_LIMIT_EXCEEDED = 'CREDIT_LIMIT_EXCEEDED',
  INVOICE_WRONG_STATUS = 'INVOICE_WRONG_STATUS',
  INVOICE_BANK_DETAILS_MISSING = 'INVOICE_BANK_DETAILS_MISSING',
}

export interface InvoiceBankDetailsInput {
  bank_account_number: string;
  bank_account_name: string;
  bank_name: string;
}

export interface InvoiceSubmission {
  invoice_number: string;
  buyer_id: string;
  face_value: number;
  due_date: string;
  description: string;
  /** URA EFRIS reference — required for EFRIS verification at buyer confirmation. */
  ura_efris_ref: string;
  /** Optional: days the supplier needs funding for (triggers reminder email). */
  funding_timeline_days?: number;
}

export interface InvoiceRecord {
  id: string;
  invoice_number: string;
  supplier_id: string;
  buyer_id: string;
  face_value: string;
  due_date: string;
  description: string;
  status: InvoiceStatus;
  sla_deadline: string;
  buyer_confirmed_at: string | null;
  aml_flagged: boolean;
  created_at: string;
  updated_at: string;
}

export interface InvoiceDetail {
  id: string;
  invoice_number: string;
  supplier_id: string;
  buyer_id: string;
  face_value: number;
  due_date: string;
  description: string;
  status: InvoiceStatus;
  sla_deadline: string;
  buyer_confirmed_at: string | null;
  aml_flagged: boolean;
  created_at: string;
}

// =========================================================================
// Enriched LIST shape — JOINs invoices+suppliers+buyers+risk_scores
// =========================================================================

/** A list-page invoice row with nested supplier/buyer/risk fields populated. */
export interface EnrichedInvoiceListItem {
  id: string;
  invoice_number: string;
  supplier_id: string;
  supplier_name: string;
  buyer_id: string;
  buyer_name: string;
  face_value: number;
  advance_amount: number | null;
  discount_amount: number | null;
  net_payment_to_supplier: number | null;
  advance_percentage: number;
  discount_rate: number;
  tenor: number;
  status: InvoiceStatus;
  risk_score: number | null;
  risk_level: 'low' | 'medium' | 'high' | 'critical' | null;
  issue_date: string;
  due_date: string;
  funded_at: string | null;
  collected_at: string | null;
  created_at: string;
  updated_at: string;
  bank_details_captured_at: string | null;
}

// =========================================================================
// Enriched DETAIL shape — single GET /invoices/:id response
// =========================================================================

/** Status timeline entry — derived from audit_logs. */
export interface StatusTransition {
  status: InvoiceStatus;
  transitioned_at: string;
  actor_name: string;
  actor_role: string;
  notes: string | null;
}

/** Approval decision row joined with users for actor identity. */
export interface ApprovalDecision {
  tier: 'AUTO' | 'TIER_2' | 'TIER_3';
  decision: 'APPROVED' | 'REJECTED' | 'ESCALATED';
  actor_name: string;
  actor_role: string;
  decided_at: string;
  reason: string | null;
}

/** Risk score breakdown — pulled from risk_scores. */
export interface RiskBreakdown {
  composite: number;
  buyer_credit: number;
  supplier_track_record: number;
  concentration_risk: number;
  collateral: number;
  tenor: number;
}

/** Document attached to the invoice — from invoice_documents. */
export interface InvoiceDocumentRef {
  id: string;
  name: string;
  type: string;
  uploaded_at: string;
  size_bytes: number;
}

/** Collateral item attached to the invoice — from collateral. */
export interface InvoiceCollateralRef {
  id: string;
  type: string;
  description: string | null;
  estimated_value: number;
  status: 'pending' | 'verified' | 'rejected';
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
}

/** Buyer info (decrypted at service layer). */
export interface BuyerInfoResponse {
  id: string;
  name: string;
  industry: string;
  credit_limit: number;
  payment_terms_days: number;
  contact_email: string;
  contact_phone: string;
}

/** Supplier info (decrypted at service layer). */
export interface SupplierInfoResponse {
  id: string;
  name: string;
  industry: string;
  registration_number: string;
  contact_email: string;
  contact_phone: string;
}

/** Full nested invoice detail returned by GET /invoices/:id. */
export interface InvoiceDetailResponse extends EnrichedInvoiceListItem {
  supplier_info: SupplierInfoResponse;
  buyer_info: BuyerInfoResponse;
  status_timeline: StatusTransition[];
  approval_history: ApprovalDecision[];
  risk_breakdown: RiskBreakdown | null;
  documents: InvoiceDocumentRef[];
  collateral: InvoiceCollateralRef[];
  approved_at: string | null;
  dual_auth_user_1_id: string | null;
  dual_auth_user_1_name: string | null;
  dual_auth_user_1_at: string | null;
  dual_auth_user_2_id: string | null;
  dual_auth_user_2_name: string | null;
  dual_auth_user_2_at: string | null;
  pricing_accepted_at: string | null;
}

// =========================================================================
// Raw row types (DB → service) — internal to repository
// =========================================================================

export interface EnrichedInvoiceListRow {
  id: string;
  invoice_number: string;
  supplier_id: string;
  supplier_name: string | null;
  buyer_id: string;
  buyer_name: string | null;
  face_value: string;
  advance_amount: string | null;
  discount_amount: string | null;
  net_payment_to_supplier: string | null;
  advance_percentage: string | null;
  discount_rate: string | null;
  tenor_days: number | null;
  status: InvoiceStatus;
  risk_score: number | null;
  risk_recommendation: string | null;
  due_date: string;
  funded_at: string | null;
  collected_at: string | null;
  created_at: string;
  updated_at: string;
  bank_details_captured_at: string | null;
}

export interface EnrichedInvoiceDetailRow extends EnrichedInvoiceListRow {
  description: string;
  sla_deadline: string;
  buyer_confirmed_at: string | null;
  aml_flagged: boolean;
  buyer_credit_score: string | null;
  tenor_score: string | null;
  track_record_score: string | null;
  concentration_score: string | null;
  collateral_score: string | null;
  registration_number: string | null;
  buyer_credit_limit: string | null;
  buyer_email_enc: string | null;
  buyer_phone_enc: string | null;
  supplier_email: string | null;
  supplier_phone_enc: string | null;
  dual_auth_user_1_id: string | null;
  dual_auth_user_1_name: string | null;
  dual_auth_user_1_at: string | null;
  dual_auth_user_2_id: string | null;
  dual_auth_user_2_name: string | null;
  dual_auth_user_2_at: string | null;
  approved_at: string | null;
  pricing_accepted_at: string | null;
}

export interface ApprovalHistoryRow {
  tier: 'AUTO' | 'TIER_2' | 'TIER_3';
  decision: 'APPROVED' | 'REJECTED' | 'ESCALATED';
  comments: string;
  created_at: string;
  actor_name: string | null;
  actor_role: string | null;
}

export interface InvoiceDocumentRow {
  id: string;
  document_type: string;
  file_size_bytes: number;
  created_at: string;
}

export interface InvoiceCollateralRow {
  id: string;
  collateral_type: string;
  value: string;
  description: string | null;
  expiry_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BuyerLimits {
  id: string;
  company_name: string;
  is_active: boolean;
  approved_limit: string;
  used_limit: string;
}

export interface ValidationResult {
  step: string;
  passed: boolean;
  errorCode?: string;
  details?: Record<string, unknown>;
}

export interface InvoiceFilters {
  status?: string | string[];
  buyer_id?: string;
  date_from?: string;
  date_to?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditTimelineEntry {
  id: string;
  user_id: string | null;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown>;
  ip_address: string;
  user_agent: string;
  created_at: string;
}
