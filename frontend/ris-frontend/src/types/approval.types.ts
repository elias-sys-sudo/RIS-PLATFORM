import type { RiskLevel } from '../lib/constants';
import type { InvoiceDetail, RiskBreakdown } from './invoice.types';

// ── Core enums ────────────────────────────────────────────────────────────────

export type ApprovalDecisionType = 'APPROVED' | 'REJECTED' | 'ESCALATED';
/** Queue status includes PENDING for items awaiting a decision */
export type ApprovalQueueStatus = ApprovalDecisionType | 'PENDING';
export type ApprovalTier = 'AUTO' | 'TIER_2' | 'TIER_3' | 'TIER_4';

// ── Tier decision record ──────────────────────────────────────────────────────

export interface TierDecision {
  tier:       ApprovalTier;
  tierLabel:  string;
  decision:   ApprovalDecisionType | null;
  actorName:  string | null;
  actorRole:  string | null;
  decidedAt:  string | null;
  reason:     string | null;
}

// ── Queue item (list view) ────────────────────────────────────────────────────

export interface ApprovalQueueItem {
  id:            string;
  invoiceId:     string;
  invoiceNumber: string;
  supplierName:  string;
  buyerName:     string;
  faceValue:     number;
  riskScore:     number | null;
  riskLevel:     RiskLevel | null;
  submittedAt:   string;
  daysInQueue:   number;
  currentTier:   ApprovalTier;
  status:        ApprovalQueueStatus;
}

// ── Detail view ───────────────────────────────────────────────────────────────

export interface ApprovalDetail {
  id:            string;
  invoiceId:     string;
  invoice:       InvoiceDetail;
  currentTier:   ApprovalTier;
  status:        ApprovalQueueStatus;
  tierDecisions: TierDecision[];
  riskBreakdown: RiskBreakdown | null;
  submittedAt:   string;
  daysInQueue:   number;
}

// ── Approval mutation result ─────────────────────────────────────────────────
// Mirrors src/services/approvals/approvals.service.ts ApprovalResult.

export interface ApprovalResult {
  approvalId:     string;
  invoiceId:      string;
  tier:           ApprovalTier;
  decision:       ApprovalDecisionType;
  comments:       string;
  quorumReached:  boolean;
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

export interface ApprovalStats {
  pendingCount:    number;
  approvedToday:   number;
  rejectedToday:   number;
  avgDaysInQueue:  number;
}

// ── Filters ───────────────────────────────────────────────────────────────────

export type ApprovalTab = 'pending' | 'approved' | 'rejected' | 'all';

export type ApprovalSortField =
  | 'submitted_at'
  | 'face_value'
  | 'risk_score'
  | 'days_in_queue'
  | 'supplier_name';

export type ApprovalSortDir = 'asc' | 'desc';

export interface ApprovalFilters {
  tab?:       ApprovalTab;
  tier?:      ApprovalTier;
  search?:    string;
  date_from?: string;
  date_to?:   string;
  sort_by?:   ApprovalSortField;
  sort_dir?:  ApprovalSortDir;
  page?:      number;
  page_size?: number;
}

// ── Paginated response ────────────────────────────────────────────────────────

export interface PaginatedApprovals {
  data:        ApprovalQueueItem[];
  total:       number;
  page:        number;
  pageSize:    number;
  totalPages:  number;
  stats:       ApprovalStats;
}

// ── History item ──────────────────────────────────────────────────────────────

export interface ApprovalHistoryItem {
  id:             string;
  invoiceId:      string;
  invoiceNumber:  string;
  supplierName:   string;
  buyerName:      string;
  faceValue:      number;
  riskScore:      number | null;
  riskLevel:      RiskLevel | null;
  finalDecision:  ApprovalDecisionType;
  decidedBy:      string;
  decidedAt:      string;
  tier:           ApprovalTier;
  reason:         string | null;
}

export interface PaginatedApprovalHistory {
  data:        ApprovalHistoryItem[];
  total:       number;
  page:        number;
  pageSize:    number;
  totalPages:  number;
}

export interface ApprovalHistoryFilters {
  decision?:  ApprovalDecisionType;
  search?:    string;
  date_from?: string;
  date_to?:   string;
  sort_by?:   'decided_at' | 'face_value' | 'risk_score';
  sort_dir?:  'asc' | 'desc';
  page?:      number;
  page_size?: number;
}
