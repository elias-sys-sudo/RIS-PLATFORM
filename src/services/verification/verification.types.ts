export enum VerificationErrorCode {
  TOKEN_NOT_FOUND = 'TOKEN_NOT_FOUND',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_ALREADY_USED = 'TOKEN_ALREADY_USED',
  INVOICE_NOT_SUBMITTED = 'INVOICE_NOT_SUBMITTED',
  CONFIRMATION_INCOMPLETE = 'CONFIRMATION_INCOMPLETE',
  DISPUTE_REASON_REQUIRED = 'DISPUTE_REASON_REQUIRED',
  EFRIS_NOT_VERIFIED = 'EFRIS_NOT_VERIFIED',
}

export interface DisputeRecord {
  id: string;
  invoice_id: string;
  buyer_id: string;
  dispute_reason: string;
  dispute_type: string;
  status: string;
  created_at: string;
}

export interface RaiseDisputeInput {
  reason: string;
  dispute_type?: string;
}

export interface BuyerConfirmationRequest {
  invoice_is_valid: boolean;
  amount_is_correct: boolean;
  due_date_is_correct: boolean;
  agrees_to_pay_ris: boolean;
}

export interface ConfirmationPageData {
  invoice_number: string;
  supplier_name: string;
  buyer_name: string;
  face_value: number;
  due_date: string;
  description: string;
  ris_bank_details: string;
}

export interface InvoiceConfirmationRow {
  id: string;
  invoice_number: string;
  supplier_id: string;
  buyer_id: string;
  face_value: string;
  due_date: string;
  description: string;
  status: string;
  confirmation_token_hash: string | null;
  confirmation_token_expires_at: string | null;
  buyer_confirmed_at: string | null;
  created_at: string;
  /** URA EFRIS reference supplied at submission. */
  ura_efris_ref: string | null;
  /** Timestamp when EFRIS verification succeeded. Null until verified. */
  efris_verified_at: string | null;
}

export interface ConfirmationPageRow {
  invoice_number: string;
  face_value: string;
  due_date: string;
  description: string;
  supplier_name: string;
  buyer_name: string;
}

export interface PendingConfirmationItem {
  id: string;
  invoice_number: string;
  supplier_name: string;
  buyer_name: string;
  face_value: number;
  due_date: string;
  submitted_at: string;
  hours_since_submission: number;
}

export interface PendingConfirmationRow {
  id: string;
  invoice_number: string;
  supplier_name: string;
  buyer_name: string;
  face_value: string;
  due_date: string;
  submitted_at: string;
  hours_since_submission: string;
}

export interface ReminderCheckRow {
  id: string;
  buyer_id: string;
  invoice_number: string;
  face_value: string;
  created_at: string;
  contact_email_encrypted: string;
}

export interface BuyerContact {
  contact_email_encrypted: string;
  contact_phone_encrypted: string;
  company_name: string;
}
