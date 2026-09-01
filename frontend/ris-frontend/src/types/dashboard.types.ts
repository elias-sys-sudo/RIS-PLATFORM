import type { InvoiceStatus, EscalationLevel } from '../lib/constants';

// ── Period ────────────────────────────────────────────────────────────────────

export type Period = '7d' | '30d' | '90d' | '12m' | 'all';

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: '7d',  label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '12m', label: '12 months' },
  { value: 'all', label: 'All time' },
];

// ── Summary stats ────────────────────────────────────────────────────────────

export interface DashboardStats {
  /** Total invoice count in period */
  totalInvoices: number;
  /** Sum of all face values — raw UGX integer */
  totalFaceValue: number;
  /** Sum of amounts funded — raw UGX integer */
  totalFunded: number;
  /** Percentage of invoices collected on time (0–100) */
  collectionRate: number;
  /** Count of overdue invoices */
  overdueCount: number;
  /** Sum of overdue invoice amounts — raw UGX integer */
  overdueAmount: number;
  /** Average invoice tenor in days */
  avgTenorDays: number;
  /** Number of active credit facilities */
  activeFacilities: number;
}

export interface DashboardTrends {
  /** Change in total face value vs previous period (percent) */
  totalFaceValueChange: number;
  /** Change in total funded vs previous period (percent) */
  totalFundedChange: number;
  /** Change in collection rate vs previous period (percentage points) */
  collectionRateChange: number;
  /** Change in overdue amount vs previous period (percent) */
  overdueAmountChange: number;
}

// ── Breakdowns ───────────────────────────────────────────────────────────────

export interface InvoiceStatusBreakdownItem {
  status: InvoiceStatus;
  count: number;
  /** Raw UGX total for this status bucket */
  amount: number;
}

export type PaymentMethod = 'mtn_momo' | 'airtel_money' | 'eft_rtgs';

export interface PaymentMethodBreakdownItem {
  method: PaymentMethod;
  label: string;
  count: number;
  /** Raw UGX total */
  amount: number;
}

// ── Trend data ────────────────────────────────────────────────────────────────

export interface TrendDataPoint {
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** UGX funded that period */
  funded: number;
  /** UGX collected that period */
  collected: number;
  /** UGX overdue at end of period */
  overdue: number;
}

// ── Escalation ────────────────────────────────────────────────────────────────

export interface EscalationOverviewCounts {
  none: number;
  reminder: number;
  formal: number;
  legal: number;
}

// ── Activity feed ─────────────────────────────────────────────────────────────

export type ActivityType =
  | 'invoice_submitted'
  | 'invoice_funded'
  | 'payment_made'
  | 'collection_received'
  | 'escalation_raised'
  | 'approval_completed'
  | 'invoice_overdue'
  | 'facility_drawdown';

export interface RecentActivityItem {
  id: string;
  type: ActivityType;
  description: string;
  /** Optional UGX amount — raw integer */
  amount?: number;
  /** ISO timestamp */
  timestamp: string;
  /** Navigate target when clicked */
  invoiceId?: string;
  status?: string;
}

// ── Top-level response ───────────────────────────────────────────────────────

export interface DashboardSummary {
  period: Period;
  /** ISO timestamp — when this data was cached on the server */
  cachedAt: string;
  stats: DashboardStats;
  trends: DashboardTrends;
  invoiceStatusBreakdown: InvoiceStatusBreakdownItem[];
  paymentMethodBreakdown: PaymentMethodBreakdownItem[];
  trendData: TrendDataPoint[];
  escalationOverview: EscalationOverviewCounts;
  recentActivity: RecentActivityItem[];
}

// ── Payment history ──────────────────────────────────────────────────────────

export type PaymentStatus = 'pending_first_auth' | 'pending_second_auth' | 'executing' | 'funded' | 'failed' | 'reversed';
export type PaymentDirection = 'disbursement' | 'collection';

export interface PaymentHistoryItem {
  id: string;
  invoiceId: string;
  invoiceRef: string;
  /** Display name (decrypted by backend) */
  supplierName: string;
  buyerName: string;
  /** Raw UGX integer */
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  direction: PaymentDirection;
  /** ISO timestamp */
  paidAt: string;
}

export interface PaymentHistoryFilters {
  status?: PaymentStatus;
  method?: PaymentMethod;
  direction?: PaymentDirection;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface PaymentHistoryResponse {
  items: PaymentHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

// ── Escalation level used in EscalationOverview ───────────────────────────────

export type { EscalationLevel };

// ── Approval queue (credit officer) ──────────────────────────────────────────

export interface ApprovalQueueItem {
  id: string;
  invoiceRef: string;
  supplierName: string;
  buyerName: string;
  /** Raw UGX face value */
  faceValue: number;
  submittedAt: string;
  status: 'pending_first_auth' | 'pending_second_auth';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

// ── Funding pipeline (finance manager) ───────────────────────────────────────

export interface FundingPipelineItem {
  id: string;
  invoiceRef: string;
  supplierName: string;
  buyerName: string;
  /** Raw UGX face value */
  faceValue: number;
  /** Raw UGX advance amount RIS will disburse */
  advanceAmount: number;
  approvedAt: string;
  paymentMethod: PaymentMethod;
}

// ── Supplier dashboard ────────────────────────────────────────────────────────

export interface SupplierDashboardStats {
  totalSubmitted: number;
  totalFunded: number;
  /** Raw UGX outstanding */
  outstandingAmount: number;
  overdueCount: number;
  avgPaymentDays: number;
}

export interface SupplierDashboardSummary {
  stats: SupplierDashboardStats;
  invoiceStatusBreakdown: InvoiceStatusBreakdownItem[];
  recentPayments: PaymentHistoryItem[];
}

// ── SAR / Legal ───────────────────────────────────────────────────────────────

export type SarStatus = 'pending_review' | 'filed' | 'cleared';

export interface SarItem {
  id: string;
  invoiceRef: string;
  supplierName: string;
  buyerName: string;
  /** Raw UGX amount */
  amount: number;
  flaggedAt: string;
  reason: string;
  status: SarStatus;
}

export interface LegalEscalationItem {
  id: string;
  invoiceRef: string;
  supplierName: string;
  buyerName: string;
  /** Raw UGX amount */
  amount: number;
  daysOverdue: number;
  escalatedAt: string;
}

export interface LegalDashboardSummary {
  sarFlaggedCount: number;
  /** Raw UGX total of all SAR-flagged invoices */
  sarTotalAmount: number;
  sarItems: SarItem[];
  tier3Escalations: LegalEscalationItem[];
}

// ── Risk distribution (management) ───────────────────────────────────────────

export interface RiskDistributionItem {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  count: number;
  /** Raw UGX total for this risk bucket */
  amount: number;
}
