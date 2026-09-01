// =========================================================================
// Eligibility pre-qualification
// =========================================================================

/** D1 — years-in-business bucket accepted from the frontend dropdown. */
export type YearsInBusinessBucket = '0-1' | '2-5' | '6-10' | '10+';

export interface EligibilityCheckInput {
  registered_company: boolean;
  authorized_person: boolean;
  /** D1 — accepts either the new bucket string or the legacy raw year count. */
  years_in_business: number | YearsInBusinessBucket;
  /** G8 — most recent full-year revenue (UGX, optional). */
  revenue_year1?: number;
  /** G8 — prior full-year revenue (UGX, optional). */
  revenue_year2?: number;
  funding_requirement?: number;
  /** Optional applicant email — when supplied, drives the 30-day throttle. */
  email?: string;
}

export interface EligibilityResult {
  passed: boolean;
  session_token?: string;
  message: string;
}

export interface EligibilityCheckRecord {
  id: string;
  session_token: string;
  registered_company: boolean;
  authorized_person: boolean;
  years_in_business: number;
  passed: boolean;
  ip_address: string | null;
  email: string | null;
  expires_at: string | null;
  funding_requirement: string | null;
  created_at: string;
}

export enum EligibilityErrorCode {
  THROTTLED = 'ELIGIBILITY_THROTTLED',
}

/**
 * Repository-layer signals used by the progressive eligibility throttle
 * (REQ-ELIG-006). See onboarding.service.enforceEligibilityThrottle for the
 * tier thresholds + forgiveness logic.
 */
export interface EligibilityThrottleSignals {
  failCount5min: number;
  failCount1hour: number;
  failCount24hour: number;
  failCount30day: number;
  mostRecentPassAt: Date | null;
  mostRecentFailAt: Date | null;
}

export enum KycStatus {
  PENDING = 'pending',
  DOCUMENTS_SUBMITTED = 'documents_submitted',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * Canonical KYC document types. Values match the frontend's
 * KycDocumentType union (kyc.api.ts) and the Joi documentBodySchema in
 * onboarding.routes.ts. Legacy DB rows may carry the older values
 * 'director_id' / 'signed_supplier_agreement' from before the rebrand;
 * the read-side mapping in onboarding.service.ts (KYC_PAGE_DOCUMENT_TYPE_MAP)
 * translates those for display, and REQUIRED_DOC_TYPE_GROUPS in the same
 * file accepts either alias for the auto-advance check.
 */
export enum DocumentType {
  CERTIFICATE_OF_INCORPORATION = 'certificate_of_incorporation',
  TAX_REGISTRATION = 'tax_registration',
  ID_DOCUMENT = 'id_document',
  SUPPLIER_AGREEMENT = 'supplier_agreement',
  DIRECTORS_SHAREHOLDERS = 'directors_shareholders',
  BANK_ACCOUNT_DETAILS = 'bank_account_details',
  BOARD_RESOLUTION = 'board_resolution',
  ADDITIONAL = 'additional',
}

/** Legacy document_type values that may exist in pre-rebrand DB rows. */
export const LEGACY_DOCUMENT_TYPE_ALIASES: Record<string, string> = {
  director_id: DocumentType.ID_DOCUMENT,
  signed_supplier_agreement: DocumentType.SUPPLIER_AGREEMENT,
};

/**
 * Supplier-side preferred payout channel.
 *
 * Mobile-money options (MTN_MOMO, AIRTEL) have been retired — supplier
 * advances are paid via EFT (bank ACH) only. The DB enum `payment_method`
 * still defines the legacy values so historical supplier rows remain
 * readable, but the application only ever writes EFT going forward.
 */
export enum PaymentMethod {
  EFT = 'EFT',
}

export interface Director {
  name: string;
  id_type: string;
  id_number: string;
}

export interface SupplierRegistration {
  email: string;
  password: string;
  company_name: string;
  registration_number: string;
  tax_id: string;
  directors: Director[];
  bank_name: string;
  bank_account_number: string;
  bank_account_name: string;
  bank_branch: string;
  preferred_payment_method: PaymentMethod;
  eligibility_session_token: string;
  consent_ursb_check: boolean;
  consent_supplier_refs: boolean;
  consent_litigation_check: boolean;
  /** Optional free-text declaration of any known ongoing litigation (G3). */
  litigation_disclosure?: string;
  required_financing_amount?: number;
}

export interface SupplierRecord {
  id: string;
  user_id: string;
  company_name: string;
  company_name_encrypted: string | null;
  registration_number: string;
  tax_id: string;
  tax_id_encrypted: string | null;
  directors: Director[];
  directors_encrypted: string | null;
  bank_name: string;
  bank_account_number_encrypted: string;
  bank_account_name_encrypted: string;
  bank_branch: string;
  preferred_payment_method: PaymentMethod;
  mobile_money_number_encrypted: string | null;
  kyc_status: KycStatus;
  sanctions_flag: boolean;
  risk_tier: string;
  required_financing_amount: string | null;
  consent_ursb_check: boolean;
  consent_supplier_refs: boolean;
  consent_litigation_check: boolean;
  ursb_verified: boolean;
  ursb_verified_at: string | null;
  ursb_verified_by: string | null;
  litigation_checked: boolean;
  litigation_checked_at: string | null;
  litigation_checked_by: string | null;
  litigation_flag: boolean;
  eligibility_session_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierProfile {
  id: string;
  user_id: string;
  company_name: string;
  registration_number: string;
  tax_id: string;
  directors: Director[];
  bank_name: string;
  bank_branch: string;
  preferred_payment_method: PaymentMethod;
  kyc_status: KycStatus;
  sanctions_flag: boolean;
  required_financing_amount: string | null;
  consent_ursb_check: boolean;
  consent_supplier_refs: boolean;
  consent_litigation_check: boolean;
  ursb_verified: boolean;
  ursb_verified_at: string | null;
  litigation_checked: boolean;
  litigation_flag: boolean;
  created_at: string;
}

export interface BuyerCreation {
  company_name: string;
  registration_number: string;
  credit_rating: 'A' | 'B' | 'C' | 'D';
  approved_limit: number;
  payment_score: number;
  contact_email: string;
  contact_phone: string;
  ris_margin_rate?: number;
  payment_undertaking_signed?: boolean;
  payment_undertaking_date?: string;
}

export interface BuyerRecord {
  id: string;
  company_name: string;
  registration_number: string;
  credit_rating: string;
  approved_limit: string;
  used_limit: string;
  ris_margin_rate: string;
  payment_score: number;
  contact_email_encrypted: string;
  contact_phone_encrypted: string;
  is_active: boolean;
  sanctions_flag: boolean;
  payment_undertaking_signed: boolean;
  payment_undertaking_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface BuyerProfile {
  id: string;
  company_name: string;
  registration_number: string;
  credit_rating: string;
  approved_limit: string;
  used_limit: string;
  ris_margin_rate: string;
  payment_score: number;
  is_active: boolean;
  sanctions_flag: boolean;
  payment_undertaking_signed: boolean;
  payment_undertaking_date: string | null;
  created_at: string;
}

export interface BuyerUpdate {
  company_name?: string;
  credit_rating?: 'A' | 'B' | 'C' | 'D';
  approved_limit?: number;
  payment_score?: number;
  contact_email?: string;
  contact_phone?: string;
  ris_margin_rate?: number;
  is_active?: boolean;
  payment_undertaking_signed?: boolean;
  payment_undertaking_date?: string;
}

/** Per-document review state values (DB CHECK + app validation). */
export type DocumentReviewStatus = 'pending' | 'approved' | 'rejected';

export interface DocumentRecord {
  id: string;
  invoice_id: string | null;
  supplier_id: string;
  document_type: string;
  encrypted_path: string;
  file_hash: string;
  file_size_bytes: number;
  mime_type: string;
  uploaded_by: string;
  created_at: string;
  expiry_date: string | null;
  // Per-document review fields (migration 039). All NULL on rows uploaded
  // before the migration; defaults to 'pending' for new uploads.
  review_status: DocumentReviewStatus;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_comments: string | null;
}

export interface DocumentReviewDecision {
  decision: 'approved' | 'rejected';
  comments: string;
}

export interface KycStatusUpdate {
  status: KycStatus;
  comments: string;
}

export interface SanctionsEntry {
  name: string;
  registration_number?: string;
  reason: string;
  pep_designation?: boolean;
}

export interface SanctionsList {
  lastUpdated: string;
  entries: SanctionsEntry[];
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

// =========================================================================
// Buyer onboarding requests
// =========================================================================

export enum BuyerRequestStatus {
  PENDING = 'pending',
  IN_REVIEW = 'in_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum BuyerRequestErrorCode {
  NOT_FOUND = 'BUYER_REQUEST_NOT_FOUND',
  ALREADY_REVIEWED = 'BUYER_REQUEST_ALREADY_REVIEWED',
  DUPLICATE_COMPANY = 'BUYER_REQUEST_DUPLICATE_COMPANY',
}

export interface CreateBuyerRequestInput {
  company_name: string;
  registration_number?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  reason: string;
}

export interface BuyerOnboardingRequestRecord {
  id: string;
  supplier_id: string;
  company_name: string;
  registration_number: string | null;
  contact_name_encrypted: string | null;
  contact_email_encrypted: string | null;
  contact_phone_encrypted: string | null;
  reason: string;
  status: string;
  reviewed_by: string | null;
  reviewer_comments: string | null;
  linked_buyer_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Public-facing view of a buyer onboarding request after PII has been
 * decrypted in the service layer. Drops the `_encrypted` column suffixes
 * because the values are now plaintext — the suffix in the wire payload
 * was hiding email/phone from the credit-officer UI, which reads
 * `contact_email` / `contact_phone` (via deepCamelCase).
 */
export interface BuyerOnboardingRequestPublic {
  id: string;
  supplier_id: string;
  company_name: string;
  registration_number: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  reason: string;
  status: string;
  reviewed_by: string | null;
  reviewer_comments: string | null;
  linked_buyer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewBuyerRequestInput {
  status: 'approved' | 'rejected';
  reviewer_comments?: string;
  linked_buyer_id?: string;
}

// =========================================================================
// Beneficial Ownership (UBO) — KYC Enhancement
// =========================================================================

export interface BeneficialOwner {
  id: string;
  supplier_id: string;
  full_name: string;
  nationality: string;
  id_type: string;
  id_number: string;
  ownership_percentage: number;
  is_pep: boolean;
  verified_at: string | null;
  verified_by: string | null;
}

export interface BeneficialOwnerRecord {
  id: string;
  supplier_id: string;
  full_name_encrypted: string;
  nationality: string;
  id_type: string;
  id_number_encrypted: string;
  ownership_percentage: number;
  is_pep: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUboInput {
  full_name: string;
  nationality: string;
  id_type: string;
  id_number: string;
  ownership_percentage: number;
  is_pep: boolean;
}

export enum KycTier {
  STANDARD = 'STANDARD',
  ENHANCED = 'ENHANCED',
  SIMPLIFIED = 'SIMPLIFIED',
}

// =========================================================================
// KYC page status (frontend GET /onboarding/suppliers/:id/kyc shape)
// =========================================================================

/** Per-document review status as exposed to the supplier-facing KYC page. */
export type KycPageDocStatus = 'pending' | 'approved' | 'rejected';

/** Overall KYC status as exposed to the supplier-facing KYC page. */
export type KycPageOverallStatus = 'pending' | 'in_progress' | 'approved' | 'rejected';

/**
 * Document type vocabulary the frontend KYC page recognises.
 * Backend `document_type` values that fall outside this set are normalised
 * to `'additional'`.
 */
export type KycPageDocumentType =
  | 'certificate_of_incorporation'
  | 'directors_shareholders'
  | 'tax_registration'
  | 'bank_account_details'
  | 'supplier_agreement'
  | 'board_resolution'
  | 'id_document'
  | 'additional';

export interface KycPageDocument {
  id: string;
  type: KycPageDocumentType;
  fileName: string;
  uploadedAt: string;
  status: KycPageDocStatus;
  reviewerComments: string | null;
}

export interface KycPageStatus {
  supplierId: string;
  overallStatus: KycPageOverallStatus;
  documents: KycPageDocument[];
}
