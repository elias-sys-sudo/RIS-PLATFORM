// =============================================================================
// Collections — Types, Interfaces & Enums
// =============================================================================

/** Collection record status tracking. */
export enum CollectionStatus {
  PENDING = 'pending',
  REMINDED = 'reminded',
  OVERDUE = 'overdue',
  ESCALATED = 'escalated',
  COLLECTED = 'collected',
  BAD_DEBT = 'bad_debt',
}

/** Reminder trigger points relative to invoice due date. */
export enum ReminderType {
  T_MINUS_7 = 'T_MINUS_7',
  T_MINUS_3 = 'T_MINUS_3',
  T_DUE = 'T_DUE',
  T_PLUS_1 = 'T_PLUS_1',
  T_PLUS_3 = 'T_PLUS_3',
  T_PLUS_7 = 'T_PLUS_7',
}

/** Error codes specific to the collections module. */
export enum CollectionErrorCode {
  INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND',
  INVOICE_WRONG_STATUS = 'INVOICE_WRONG_STATUS',
  COLLECTION_NOT_FOUND = 'COLLECTION_NOT_FOUND',
  PAYMENT_AMOUNT_MISMATCH = 'PAYMENT_AMOUNT_MISMATCH',
  ALREADY_COLLECTED = 'ALREADY_COLLECTED',
  ALREADY_RESOLVED = 'ALREADY_RESOLVED',
  CANNOT_DEESCALATE = 'CANNOT_DEESCALATE',
  DOCUMENT_NOT_FOUND = 'DOCUMENT_NOT_FOUND',
  DOCUMENT_ALREADY_SENT = 'DOCUMENT_ALREADY_SENT',
  DOCUMENT_NOT_DRAFT = 'DOCUMENT_NOT_DRAFT',
  DRAFT_ALREADY_EXISTS = 'DRAFT_ALREADY_EXISTS',
}

/** Escalation level labels matching frontend EscalationLevel type. */
export type EscalationLevelLabel = 'none' | 'reminder' | 'formal' | 'legal';

// -------------------------------------------------------------------------
// DB row types
// -------------------------------------------------------------------------

/** Full row from collections table. */
export interface CollectionRecord {
  id: string;
  invoice_id: string;
  buyer_id: string;
  face_value: string;
  amount_due: string;
  days_overdue: number;
  daily_penalty_rate: string;
  penalty_amount: string;
  status: string;
  escalation_level: string | null;
  demand_notice_sent: boolean;
  sar_flagged: boolean;
  total_collected: string | null;
  last_payment_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Penalty calculation result (integer arithmetic). */
export interface PenaltyCalculation {
  invoiceId: string;
  faceValue: string;
  daysOverdue: number;
  dailyPenaltyRate: string;
  penaltyAmount: string;
}

/** Demand notice sent to buyer on overdue invoices. */
export interface DemandNotice {
  id: string;
  collectionId: string;
  invoiceId: string;
  buyerId: string;
  type: string;
  amountDue: string;
  penaltyAmount: string;
  sentAt: string;
}

/** Invoice fields needed for collections processing. */
export interface InvoiceForCollection {
  id: string;
  face_value: string;
  advance_amount: string;
  status: string;
  supplier_id: string;
  buyer_id: string;
  due_date: string;
}

/** Collection eligible for automatic default (level 3, 90+ days overdue). */
export interface DefaultableCollection {
  id: string;
  invoice_id: string;
  buyer_id: string;
  days_overdue: number;
  face_value: string;
}

/** Invoice row returned by the reminder-due query. */
export interface InvoiceDueForReminder {
  id: string;
  face_value: string;
  buyer_id: string;
  supplier_id: string;
  due_date: string;
  days_until_due: number;
  reminder_type: ReminderType;
}

/** Input for recording a payment received from a buyer. */
export interface RecordPaymentInput {
  invoiceId: string;
  amount: string;
  paymentDate: string;
  receivedBy: string;
  paymentMethod: CollectionPaymentMethod;
  paidBy: string;
  paymentReference?: string;
  notes?: string;
}

/** Input for creating an overdue/collections record. */
export interface CreateCollectionInput {
  id: string;
  invoiceId: string;
  buyerId: string;
  faceValue: string;
  amountDue: string;
  daysOverdue: number;
  dailyPenaltyRate: string;
  penaltyAmount: string;
}

/** Overdue invoice summary for the GET /collections/overdue endpoint. */
export interface OverdueInvoiceSummary {
  id: string;
  invoice_id: string;
  buyer_id: string;
  face_value: string;
  amount_due: string;
  days_overdue: number;
  penalty_amount: string;
  status: string;
  escalation_level: string | null;
  sar_flagged: boolean;
}

/** Allowed payment methods for collection payments. */
export type CollectionPaymentMethod = 'bank_transfer' | 'cash' | 'cheque';

/** Full row from collection_payments table. */
export interface CollectionPaymentRecord {
  id: string;
  collection_id: string;
  amount: string;
  payment_method: CollectionPaymentMethod;
  payment_reference: string | null;
  paid_by: string;
  paid_at: string;
  recorded_by: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Input for creating a collection payment record. */
export interface CreateCollectionPaymentInput {
  collectionId: string;
  amount: string;
  paymentMethod: CollectionPaymentMethod;
  paymentReference?: string;
  paidBy: string;
  paidAt?: string;
  recordedBy: string;
  notes?: string;
}

// -------------------------------------------------------------------------
// Frontend-aligned types for list / detail endpoints
// -------------------------------------------------------------------------

/** Filters for the paginated collections list. */
export interface CollectionListFilters {
  status?: string;
  escalation_level?: string;
  days_overdue_min?: number;
  days_overdue_max?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

/** A single collection row in the paginated list response. */
export interface CollectionListItem {
  id: string;
  invoice_id: string;
  invoice_number: string;
  buyer_name: string;
  supplier_name: string;
  face_value: number;
  outstanding_amount: number;
  due_date: string;
  days_overdue: number;
  status: string;
  escalation_level: EscalationLevelLabel;
  last_payment_date: string | null;
  last_payment_amount: number | null;
  total_collected: number;
}

/** Summary stats returned alongside the paginated list. */
export interface CollectionSummaryStats {
  total_outstanding_ugx: number;
  overdue_count: number;
  avg_days_overdue: number;
  collection_rate: number;
}

/** Paginated collections response matching frontend PaginatedCollections. */
export interface PaginatedCollectionsResponse {
  data: CollectionListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  summary_stats: CollectionSummaryStats;
}

/** Payment history entry for the detail view. */
export interface CollectionPaymentHistoryItem {
  id: string;
  amount: number;
  payment_date: string;
  method: string;
  reference: string;
  running_balance: number;
  notes: string | null;
}

/** Escalation history entry for the detail view. */
export interface EscalationHistoryItem {
  id: string;
  level: EscalationLevelLabel;
  level_number: number;
  label: string;
  occurred_at: string;
  actor_name: string;
  actor_role: string;
  notes: string | null;
}

/** Buyer contact information for the detail view. */
export interface BuyerContactInfo {
  id: string;
  company: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  payment_terms_days: number;
}

/** Full collection detail response matching frontend CollectionDetail. */
export interface CollectionDetailResponse {
  id: string;
  invoice_id: string;
  invoice_number: string;
  buyer_name: string;
  supplier_name: string;
  buyer_id: string;
  supplier_id: string;
  face_value: number;
  collected_amount: number;
  outstanding_amount: number;
  due_date: string;
  days_overdue: number;
  status: string;
  escalation_level: EscalationLevelLabel;
  sar_flagged: boolean;
  last_payment_date: string | null;
  created_at: string;
  updated_at: string;
  buyer_contact: BuyerContactInfo;
  payment_history: CollectionPaymentHistoryItem[];
  escalation_history: EscalationHistoryItem[];
}

// -------------------------------------------------------------------------
// DB row types for raw query results
// -------------------------------------------------------------------------

/** Raw row from the list query (before transformation). */
export interface CollectionListRow {
  id: string;
  invoice_id: string;
  invoice_number: string;
  buyer_name: string;
  supplier_name: string;
  face_value: string;
  outstanding_amount: string;
  due_date: string;
  days_overdue: number;
  status: string;
  escalation_level: number;
  last_payment_date: string | null;
  last_payment_amount: string | null;
  total_collected: string;
}

/** Raw row from the summary stats query. */
export interface CollectionSummaryRow {
  total_outstanding_ugx: string;
  overdue_count: string;
  avg_days_overdue: string;
  collection_rate: string;
}

/** Raw row from the detail query. */
export interface CollectionDetailRow {
  id: string;
  invoice_id: string;
  invoice_number: string;
  buyer_name: string;
  supplier_name: string;
  buyer_id: string;
  supplier_id: string;
  face_value: string;
  total_collected: string;
  outstanding_amount: string;
  due_date: string;
  days_overdue: number;
  status: string;
  escalation_level: number;
  sar_flagged: boolean;
  last_payment_date: string | null;
  created_at: string;
  updated_at: string;
}

/** Raw payment history row from DB. */
export interface PaymentHistoryRow {
  id: string;
  amount: string;
  payment_date: string;
  method: string;
  reference: string;
  running_balance: string;
  notes: string | null;
}

/** Raw escalation history row from audit_logs. */
export interface EscalationHistoryRow {
  id: string;
  escalation_level: number;
  occurred_at: string;
  actor_name: string;
  actor_role: string;
  notes: string | null;
}

/** Raw buyer contact row from DB. */
export interface BuyerContactRow {
  id: string;
  company_name: string;
  contact_email_encrypted: string | null;
  contact_phone_encrypted: string | null;
  approved_limit: string;
  payment_score: number;
}

/** Row returned by the funded-overdue query. */
export interface FundedOverdueInvoiceRow {
  id: string;
}

/** Row returned by the escalation-candidates query. */
export interface EscalationCandidateRow {
  id: string;
  invoice_id: string;
  days_overdue: number;
  escalation_level: number;
}

/** Input for recording a payment via the frontend-aligned endpoint. */
export interface FrontendRecordPaymentInput {
  amount: number;
  method: CollectionPaymentMethod;
  reference?: string;
  paid_by: string;
  payment_date: string;
  notes?: string;
}

// -------------------------------------------------------------------------
// Escalation Documents
// -------------------------------------------------------------------------

export type EscalationDocumentType = 'demand_letter' | 'legal_notice' | 'reminder_letter';
export type EscalationDocumentStatus = 'draft' | 'finalized' | 'sent';

export interface EscalationDraftParams {
  deadlineDays: number;
  additionalNotes: string;
}

export interface EscalationDocumentRow {
  id: string;
  collection_id: string;
  document_type: EscalationDocumentType;
  status: EscalationDocumentStatus;
  content_encrypted: string | null;
  file_hash: string | null;
  draft_params: EscalationDraftParams;
  mime_type: string;
  generated_by: string;
  finalized_by: string | null;
  sent_at: string | null;
  sent_to_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface EscalationDocumentSummary {
  id: string;
  documentType: EscalationDocumentType;
  status: EscalationDocumentStatus;
  draftParams: EscalationDraftParams;
  generatedBy: string;
  finalizedBy: string | null;
  sentAt: string | null;
  createdAt: string;
}
