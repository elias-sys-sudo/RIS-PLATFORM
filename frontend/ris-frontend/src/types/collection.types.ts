import type { EscalationLevel } from '../lib/constants';

// ── Collection status ─────────────────────────────────────────────────────────

export type CollectionStatus = 'pending' | 'reminded' | 'overdue' | 'escalated' | 'collected' | 'bad_debt';

// ── Sort / filter ─────────────────────────────────────────────────────────────

/** Sort field values are snake_case string literals — sent as query params to backend. */
export type CollectionSortField =
  | 'invoice_number'
  | 'buyer_name'
  | 'face_value'
  | 'outstanding_amount'
  | 'days_overdue'
  | 'escalation_level'
  | 'last_payment_date'
  | 'due_date';

export type CollectionSortDir = 'asc' | 'desc';

// ── Core collection entity ────────────────────────────────────────────────────

export interface Collection {
  id: string;
  invoiceId: string;
  invoiceNumber: string;

  supplierId: string;
  supplierName: string;

  buyerId: string;
  buyerName: string;

  /** Raw UGX — total invoice face value RIS is owed */
  faceValue: number;
  /** UGX received so far */
  collectedAmount: number;
  /** faceValue − collectedAmount */
  outstandingAmount: number;

  status: CollectionStatus;

  /** ISO date the invoice was due */
  dueDate: string;
  /** Calendar days past dueDate (0 if not yet overdue) */
  daysOverdue: number;

  escalationLevel: EscalationLevel;
  /** True when a Suspicious Activity Report has been filed with FIA Uganda */
  sarFlagged: boolean;

  lastPaymentDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── List response ─────────────────────────────────────────────────────────────

export interface CollectionSummaryStats {
  /** Total UGX still outstanding across all active collections */
  totalOutstandingUgx: number;
  /** Count of collections whose status is 'overdue' */
  overdueCount: number;
  /** Average daysOverdue across overdue collections (0 if none) */
  avgDaysOverdue: number;
  /** Percentage of face value that has been collected (0–100) */
  collectionRate: number;
}

export interface PaginatedCollections {
  data: Collection[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Summary stats are always computed over ALL records, ignoring pagination */
  summaryStats: CollectionSummaryStats;
}

// ── Filters ───────────────────────────────────────────────────────────────────

export interface CollectionFilters {
  status?: CollectionStatus[];
  escalation_level?: EscalationLevel[];
  days_overdue_min?: number;
  days_overdue_max?: number;
  search?: string;
  sort_by?: CollectionSortField;
  sort_dir?: CollectionSortDir;
  page?: number;
  page_size?: number;
}

// ── Detail nested objects ─────────────────────────────────────────────────────

export interface CollectionPayment {
  id: string;
  /** Raw UGX received in this payment */
  amount: number;
  paymentDate: string;
  /** e.g. "MTN Mobile Money", "Bank Transfer", "Airtel Money" */
  method: string;
  reference: string;
  /** Outstanding balance after this payment */
  runningBalance: number;
  notes: string | null;
}

/**
 * One step in the 4-level escalation process.
 * levelNumber 1→Reminder, 2→Formal Notice, 3→Legal Action, 4→SAR Filed
 */
export interface EscalationEvent {
  id: string;
  level: EscalationLevel;
  levelNumber: 1 | 2 | 3 | 4;
  label: string;
  occurredAt: string;
  actorName: string;
  actorRole: string;
  notes: string | null;
}

export interface BuyerContact {
  id: string;
  company: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  /** Typical payment terms this buyer operates on */
  paymentTermsDays: number;
}

/** Full collection returned by GET /collections/:id */
export interface CollectionDetail extends Collection {
  /** Daily penalty rate as a fraction (e.g., 0.001 = 0.1%/day) */
  dailyPenaltyRate: number;
  /** Total accrued penalty in UGX */
  penaltyAmount: number;
  buyerContact: BuyerContact;
  paymentHistory: CollectionPayment[];
  escalationHistory: EscalationEvent[];
}

// ── Mutation response ─────────────────────────────────────────────────────────

export interface CollectionMutationResponse {
  message: string;
  collectionId: string;
}

// ── Payment recording ──────────────────────────────────────────────────────

export type PaymentMethod = 'mtn_momo' | 'airtel_money' | 'bank_transfer' | 'cash' | 'cheque';

export interface RecordPaymentPayload {
  /** Raw UGX integer — no floats */
  amount: number;
  method: PaymentMethod;
  /** Required for electronic methods; optional for cash/cheque */
  reference?: string;
  paid_by: string;
  /** ISO date string YYYY-MM-DD */
  payment_date: string;
  notes?: string;
}

// ── Escalation mutations ───────────────────────────────────────────────────

export interface EscalatePayload {
  reason: string;
}

export interface DeescalatePayload {
  reason: string;
}
