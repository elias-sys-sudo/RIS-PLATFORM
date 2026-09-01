// =============================================================================
// Approvals — Types, Interfaces & Enums
// =============================================================================

/** Approval tier based on invoice risk profile. */
export enum ApprovalTier {
  AUTO = 'AUTO',
  TIER_2 = 'TIER_2',
  TIER_3 = 'TIER_3',
  TIER_4 = 'TIER_4',
}

/** Decision recorded for an approval. */
export enum ApprovalDecision {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ESCALATED = 'ESCALATED',
}

/** Error codes specific to the approvals module. */
export enum ApprovalErrorCode {
  INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND',
  INVOICE_WRONG_STATUS = 'INVOICE_WRONG_STATUS',
  ALREADY_APPROVED = 'ALREADY_APPROVED',
  ALREADY_DECIDED = 'ALREADY_DECIDED',
  SAME_OFFICER = 'SAME_OFFICER',
  COMMENTS_TOO_SHORT = 'COMMENTS_TOO_SHORT',
  INVOICE_LOCKED = 'INVOICE_LOCKED',
  NO_RISK_SCORE = 'NO_RISK_SCORE',
  QUORUM_NOT_MET = 'QUORUM_NOT_MET',
  REVIEW_SUMMARY_REQUIRED = 'REVIEW_SUMMARY_REQUIRED',
}

// -------------------------------------------------------------------------
// DB row types
// -------------------------------------------------------------------------

/** Row from approvals table. */
export interface ApprovalRecord {
  id: string;
  invoice_id: string;
  tier: ApprovalTier;
  decision: ApprovalDecision;
  approver_id: string;
  comments: string;
  credit_memo: string | null;
  created_at: string;
}

/** Invoice fields needed for approval routing. */
export interface InvoiceForApproval {
  id: string;
  face_value: string;
  status: string;
  supplier_id: string;
  buyer_id: string;
  aml_flagged: boolean;
}

/** Risk score fields needed for approval routing. */
export interface RiskScoreForApproval {
  id: string;
  invoice_id: string;
  final_score: number;
  recommendation: string;
}

// -------------------------------------------------------------------------
// Approval context (passed through the workflow)
// -------------------------------------------------------------------------

/** Full context assembled for tier routing decisions. */
export interface ApprovalContext {
  invoice: InvoiceForApproval;
  riskScore: RiskScoreForApproval;
  tier: ApprovalTier;
}

// -------------------------------------------------------------------------
// Committee status for Tier 3
// -------------------------------------------------------------------------

/** Tracks quorum for Tier 3 committee decisions. */
export interface CommitteeStatus {
  invoiceId: string;
  tier: ApprovalTier;
  approvals: ApprovalRecord[];
  rejections: ApprovalRecord[];
  quorumReached: boolean;
  totalDecisions: number;
}

// -------------------------------------------------------------------------
// Request/response types
// -------------------------------------------------------------------------

/** Body for POST /invoices/:id/approve. */
export interface ApproveRequest {
  comments: string;
  credit_memo?: string;
  /** G10 — case summary, required (min 30 chars) for TIER_2/TIER_3/TIER_4. */
  review_summary?: string;
}

/** Body for POST /invoices/:id/reject. */
export interface RejectRequest {
  comments: string;
  reason?: string;
  credit_memo?: string;
  /** G10 — case summary, required (min 30 chars) for TIER_2/TIER_3/TIER_4. */
  review_summary?: string;
}

/** Item in the approval queue list. */
export interface ApprovalQueueItem {
  invoice_id: string;
  face_value: string;
  supplier_id: string;
  buyer_id: string;
  tier: ApprovalTier;
  status: string;
  final_score: number;
  aml_flagged: boolean;
  created_at: string;
}

/** Invoices that have exceeded the 24-hour SLA. */
export interface SlaBreachInvoice {
  id: string;
  invoice_id: string;
  face_value: string;
  status: string;
  tier: ApprovalTier;
  created_at: string;
  hours_pending: number;
}

/** Row returned after creating an approval info request. */
export interface InfoRequestRow {
  id: string;
  invoice_id: string;
  requested_by: string;
  message: string;
  created_at: string;
}
