// =============================================================================
// Dashboard — Types, Interfaces & Enums
// =============================================================================

/** Supported period filter values for dashboard queries. */
export type DashboardPeriod = '7d' | '30d' | '90d' | '12m' | 'all';

/** Dashboard summary stats — flat numeric metrics. */
export interface DashboardStats {
  total_invoices: number;
  total_face_value: number;
  total_funded: number;
  collection_rate: number;
  overdue_count: number;
  overdue_amount: number;
  avg_tenor_days: number;
  active_facilities: number;
}

/** Period-over-period delta percentages. */
export interface DashboardTrends {
  total_face_value_change: number;
  total_funded_change: number;
  collection_rate_change: number;
  overdue_amount_change: number;
}

/** Status breakdown row. */
export interface InvoiceStatusBreakdownItem {
  status: string;
  count: number;
  amount: number;
}

/** Payment method breakdown row. */
export interface PaymentMethodBreakdownItem {
  method: string;
  label: string;
  count: number;
  amount: number;
}

/** Trend data point — daily/monthly bucket. */
export interface TrendDataPoint {
  date: string;
  funded: number;
  collected: number;
  overdue: number;
}

/** Escalation overview counts (none, reminder, formal, legal). */
export interface EscalationOverview {
  none: number;
  reminder: number;
  formal: number;
  legal: number;
}

/** Recent activity feed item. */
export interface RecentActivityItem {
  id: string;
  type:
    | 'invoice_submitted'
    | 'invoice_funded'
    | 'payment_made'
    | 'collection_received'
    | 'escalation_raised'
    | 'approval_completed'
    | 'invoice_overdue'
    | 'facility_drawdown';
  description: string;
  amount: number | null;
  timestamp: string;
  invoice_id: string | null;
  status: string | null;
}

/**
 * Rich dashboard summary returned by GET /dashboard/summary.
 * All monetary values are raw UGX integers (BIGINT in DB, number on the wire
 * — UGX has no subunits and values fit comfortably in JS Number).
 */
export interface DashboardSummary {
  period: DashboardPeriod;
  cached_at: string;
  stats: DashboardStats;
  trends: DashboardTrends;
  invoice_status_breakdown: InvoiceStatusBreakdownItem[];
  payment_method_breakdown: PaymentMethodBreakdownItem[];
  trend_data: TrendDataPoint[];
  escalation_overview: EscalationOverview;
  recent_activity: RecentActivityItem[];
}

/** Payment history record for supplier view. */
export interface PaymentHistoryRecord {
  id: string;
  invoice_id: string;
  invoice_number: string;
  amount: string;
  provider: string;
  status: string;
  funded_at: string | null;
  created_at: string;
}

/** Payment method breakdown in summary. */
export interface PaymentMethodBreakdown {
  method: string;
  count: number;
  total: string;
}

/** Payment history summary. */
export interface PaymentHistorySummary {
  total_paid: string;
  payment_count: number;
  last_payment_date: string | null;
  by_method: PaymentMethodBreakdown[];
}

/** Pagination metadata. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

/** Payment history filters. */
export interface PaymentHistoryFilters {
  supplierId: string;
  from?: string;
  to?: string;
  method?: string;
  minAmount?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/** Dashboard payment history filters (broader, no supplier_id required). */
export interface DashboardPaymentFilters {
  status?: string;
  method?: string;
  direction?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/** Approval queue item. */
export interface ApprovalQueueItem {
  id: string;
  invoice_ref: string;
  supplier_name: string;
  buyer_name: string;
  face_value: string;
  submitted_at: string;
  status: string;
  risk_level: string;
}

/** Funding pipeline item. */
export interface FundingPipelineItem {
  id: string;
  invoice_ref: string;
  supplier_name: string;
  buyer_name: string;
  face_value: string;
  advance_amount: string;
  approved_at: string;
  payment_method: string;
}

/** Invoice status breakdown entry. */
export interface InvoiceStatusBreakdown {
  status: string;
  count: number;
}

/** Recent payment entry for supplier dashboard. */
export interface SupplierRecentPayment {
  id: string;
  invoice_ref: string;
  amount: string;
  funded_at: string | null;
  provider: string;
}

/** Supplier-specific dashboard stats — matches frontend SupplierDashboardStats. */
export interface SupplierDashboardStats {
  total_submitted: number;
  total_funded: number;
  outstanding_amount: number;
  overdue_count: number;
  avg_payment_days: number;
}

/** Supplier-specific dashboard summary. */
export interface SupplierDashboardSummary {
  stats: SupplierDashboardStats;
  invoice_status_breakdown: InvoiceStatusBreakdownItem[];
  recent_payments: SupplierRecentPayment[];
}

/** SAR flagged item for legal dashboard. */
export interface SarFlaggedItem {
  id: string;
  invoice_ref: string;
  supplier_name: string;
  buyer_name: string;
  face_value: string;
  aml_flagged_at: string | null;
  status: string;
}

/** Tier 3 escalation item for legal dashboard. */
export interface Tier3EscalationItem {
  id: string;
  invoice_ref: string;
  supplier_name: string;
  buyer_name: string;
  face_value: string;
  escalation_tier: number;
  escalated_at: string;
}

/** Legal dashboard summary. */
export interface LegalDashboardSummary {
  sar_flagged_count: number;
  sar_total_amount: string;
  sar_items: SarFlaggedItem[];
  tier3_escalations: Tier3EscalationItem[];
}

/** Risk distribution entry. */
export interface RiskDistributionEntry {
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  count: number;
  amount: string;
}
