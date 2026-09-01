// =============================================================================
// Payments — Types, Interfaces & Enums
// =============================================================================

/** Payment status matching the DB payment_status enum. */
export enum PaymentStatus {
  PENDING_FIRST_AUTH = 'pending_first_auth',
  PENDING_SECOND_AUTH = 'pending_second_auth',
  EXECUTING = 'executing',
  FUNDED = 'funded',
  FAILED = 'failed',
  REVERSED = 'reversed',
}

/**
 * Payment provider — code-side enum.
 *
 * The DB enum `payment_method` still defines the legacy values
 * 'MTN_MOMO' and 'AIRTEL' so historical payment rows remain valid (audit
 * immutability). The application no longer emits those values: only EFT
 * (bank ACH) and MOCK (test-only) are written by new code.
 */
export enum PaymentProvider {
  EFT = 'EFT',
  MOCK = 'MOCK',
}

/** Error codes specific to the payments module. */
export enum PaymentErrorCode {
  INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND',
  INVOICE_WRONG_STATUS = 'INVOICE_WRONG_STATUS',
  PAYMENT_NOT_FOUND = 'PAYMENT_NOT_FOUND',
  PAYMENT_WRONG_STATUS = 'PAYMENT_WRONG_STATUS',
  SAME_AUTHORISER = 'SAME_AUTHORISER',
  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  PROVIDER_FAILURE = 'PROVIDER_FAILURE',
  SLA_BREACH = 'SLA_BREACH',
  COLLATERAL_INSUFFICIENT = 'COLLATERAL_INSUFFICIENT',
  FACILITY_INSUFFICIENT = 'FACILITY_INSUFFICIENT',
  TWO_FA_REVERIFICATION_REQUIRED = 'TWO_FA_REVERIFICATION_REQUIRED',
  PAYMENTS_HALTED = 'PAYMENTS_HALTED',
  AML_FLAG_REQUIRED = 'AML_FLAG_REQUIRED',
  AML_ALREADY_CLEARED = 'AML_ALREADY_CLEARED',
  ORPHAN_QUERY_FAILED = 'ORPHAN_QUERY_FAILED',
}

// -------------------------------------------------------------------------
// DB row types
// -------------------------------------------------------------------------

/** Full row from payments table. */
export interface PaymentRecord {
  id: string;
  invoice_id: string;
  amount: string;
  provider: string;
  status: string;
  idempotency_key: string;
  dual_auth_user_1: string | null;
  dual_auth_timestamp_1: string | null;
  dual_auth_user_2: string | null;
  dual_auth_timestamp_2: string | null;
  transaction_reference: string | null;
  provider_reference: string | null;
  payee_phone?: string;
  funded_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Payment row enriched with the related invoice / supplier / buyer / user names.
 * Returned by the public list & detail endpoints; matches the frontend
 * PaymentRecord interface (after deepCamelCase axios interceptor).
 */
export interface EnrichedPaymentRecord extends PaymentRecord {
  invoice_number: string;
  supplier_name: string;
  buyer_name: string;
  dual_auth_user_1_name: string | null;
  dual_auth_user_2_name: string | null;
}

/** Invoice fields needed for payment initiation (joined with suppliers). */
export interface InvoiceForPayment {
  id: string;
  face_value: string;
  advance_amount: string;
  status: string;
  supplier_id: string;
  buyer_id: string;
  preferred_payment_method: string;
  aml_flagged: boolean;
  aml_cleared_at: string | null;
}

// -------------------------------------------------------------------------
// Input/output types
// -------------------------------------------------------------------------

/** Data required to create a payment record. */
export interface CreatePaymentInput {
  id: string;
  invoiceId: string;
  amount: string;
  provider: PaymentProvider;
  idempotencyKey: string;
}

/** Result returned by payment provider adapters. */
export interface PaymentProviderResult {
  success: boolean;
  transactionReference: string;
  providerReference: string;
  failureReason?: string;
  /** When true, the provider accepted the request but confirmation arrives later (e.g. EFT). */
  pendingConfirmation?: boolean;
}

/** Payment provider adapter interface. */
export interface IPaymentProvider {
  name: PaymentProvider;
  execute(payment: PaymentRecord, idempotencyKey: string): Promise<PaymentProviderResult>;
}

// -------------------------------------------------------------------------
// SLA monitoring
// -------------------------------------------------------------------------

/** Payment approaching 72-hour SLA breach. */
export interface SlaBreachPayment {
  id: string;
  invoice_id: string;
  amount: string;
  status: string;
  created_at: string;
  hours_pending: number;
}

/**
 * Invoices stuck in 'approved' status with NO corresponding payment row —
 * the artefact of a worker job that exhausted its retries before
 * createPaymentTxn ran. Surfaced by GET /admin/approvals/orphans for
 * operator triage. PII-free by design: identifiers + numerics only.
 */
export interface OrphanedApprovedInvoice {
  invoice_id: string;
  supplier_id: string;
  face_value: string;
  approved_at: string;
  age_hours: number;
}
