// =============================================================================
// Reporting — Types, Interfaces & Enums
// =============================================================================

/** Available report types. */
export enum ReportType {
  PORTFOLIO_SUMMARY = 'portfolio_summary',
  AGING_ANALYSIS = 'aging_analysis',
  BUYER_EXPOSURE = 'buyer_exposure',
  PROFIT = 'profit',
  FACILITY = 'facility',
  AUDIT_EXPORT = 'audit_export',
  REGULATORY = 'regulatory',
  APPLICATIONS_RECEIVED = 'applications_received',
  APPLICATIONS_PIPELINE = 'applications_pipeline',
  APPLICATIONS_INCOMPLETE = 'applications_incomplete',
  COMPANY_PL = 'company_pl',
  DISBURSED_FUNDS = 'disbursed_funds',
  CTR = 'CTR',
  SAR_STATUS = 'SAR_STATUS',
}

/** Error codes specific to the reporting module. */
export enum ReportingErrorCode {
  UNAUTHORIZED_REPORT = 'UNAUTHORIZED_REPORT',
  INVALID_DATE_RANGE = 'INVALID_DATE_RANGE',
  EXPORT_FAILED = 'EXPORT_FAILED',
}

// -------------------------------------------------------------------------
// Role-to-report access map
// -------------------------------------------------------------------------

/** Maps each report type to the roles that may access it. */
export const REPORT_ROLE_ACCESS: Record<ReportType, string[]> = {
  [ReportType.PORTFOLIO_SUMMARY]: ['management', 'auditor'],
  [ReportType.AGING_ANALYSIS]: ['credit_officer', 'management', 'auditor'],
  [ReportType.BUYER_EXPOSURE]: ['credit_officer', 'management'],
  [ReportType.PROFIT]: ['finance_manager', 'management'],
  [ReportType.FACILITY]: ['finance_manager', 'management'],
  [ReportType.AUDIT_EXPORT]: ['auditor'],
  [ReportType.REGULATORY]: ['compliance_officer', 'management'],
  [ReportType.APPLICATIONS_RECEIVED]: ['management', 'credit_officer', 'auditor'],
  [ReportType.APPLICATIONS_PIPELINE]: ['management', 'credit_officer', 'compliance_officer'],
  [ReportType.APPLICATIONS_INCOMPLETE]: ['management', 'credit_officer', 'compliance_officer'],
  [ReportType.COMPANY_PL]: ['finance_manager', 'management'],
  [ReportType.DISBURSED_FUNDS]: ['finance_manager', 'management', 'auditor'],
  [ReportType.CTR]: ['compliance_officer', 'management'],
  [ReportType.SAR_STATUS]: ['compliance_officer', 'management'],
};

// -------------------------------------------------------------------------
// Report filter types
// -------------------------------------------------------------------------

/** Filters for report queries. */
export interface ReportFilters {
  startDate?: string;
  endDate?: string;
  userId?: string;
  actionType?: string;
  buyerId?: string;
  status?: string;
}

// -------------------------------------------------------------------------
// Portfolio summary
// -------------------------------------------------------------------------

/** Top buyer by exposure. */
export interface TopBuyerExposure {
  buyer_id: string;
  buyer_name: string;
  total_exposure: string;
}

/** Invoice count grouped by status. */
export interface InvoiceCountByStatus {
  status: string;
  count: number;
}

/** Full portfolio summary report. */
export interface PortfolioSummary {
  total_funded: string;
  total_collected: string;
  total_outstanding: string;
  total_overdue: string;
  annualised_yield: string;
  invoice_counts_by_status: InvoiceCountByStatus[];
  top_buyers: TopBuyerExposure[];
}

// -------------------------------------------------------------------------
// Aging analysis
// -------------------------------------------------------------------------

/** Single bucket in aging report. */
export interface AgingBucket {
  bucket: string;
  count: number;
  total_amount: string;
}

/** Complete aging analysis report. */
export interface AgingAnalysis {
  buckets: AgingBucket[];
}

// -------------------------------------------------------------------------
// Buyer exposure
// -------------------------------------------------------------------------

/** Single buyer exposure row. */
export interface BuyerExposure {
  buyer_id: string;
  buyer_name: string;
  used_limit: string;
  approved_limit: string;
  utilisation_pct: number;
  avg_days_to_pay: number;
  overdue_incident_count: number;
}

// -------------------------------------------------------------------------
// Profit report
// -------------------------------------------------------------------------

/** Per-invoice profit row. */
export interface InvoiceProfitRow {
  invoice_id: string;
  face_value: string;
  discount_amount: string;
  penalty_income: string;
  bank_interest_cost: string;
  net_ris_profit: string;
  profit_margin_pct: number;
}

/** Aggregated profit summary. */
export interface ProfitSummary {
  total_face_value: string;
  total_discount: string;
  total_penalty_income: string;
  total_revenue: string;
  total_bank_interest: string;
  total_net_profit: string;
  total_write_offs: string;
  avg_profit_margin_pct: number;
}

/** Complete profit report. */
export interface ProfitReport {
  invoices: InvoiceProfitRow[];
  summary: ProfitSummary;
}

// -------------------------------------------------------------------------
// Facility report
// -------------------------------------------------------------------------

/** Single facility row in report. */
export interface FacilityReportRow {
  facility_id: string;
  bank_name: string;
  total_limit: string;
  drawn_amount: string;
  available_amount: string;
  utilisation_pct: number;
  interest_accrued: string;
  defaulted_exposure: string;
  maturity_date: string;
  status: string;
}

/** Upcoming maturity entry. */
export interface UpcomingMaturity {
  facility_id: string;
  bank_name: string;
  maturity_date: string;
  days_remaining: number;
}

/** Complete facility report. */
export interface FacilityReport {
  facilities: FacilityReportRow[];
  upcoming_maturities: UpcomingMaturity[];
}

// -------------------------------------------------------------------------
// Audit export
// -------------------------------------------------------------------------

/** Single audit log entry for export. */
export interface AuditExportRow {
  id: string;
  user_id: string;
  action: string;
  table_name: string;
  record_id: string;
  old_values: string | null;
  new_values: string | null;
  ip_address: string;
  user_agent: string;
  created_at: string;
}

/** Complete audit export result. */
export interface AuditExport {
  entries: AuditExportRow[];
  total_count: number;
}

// -------------------------------------------------------------------------
// Regulatory report
// -------------------------------------------------------------------------

/** Regulatory report data. */
export interface RegulatoryReport {
  aml_flags_raised: number;
  sars_filed: number;
  transactions_above_threshold: number;
  kyc_approvals: number;
  kyc_rejections: number;
}

// -------------------------------------------------------------------------
// Applications received report
// -------------------------------------------------------------------------

export interface ApplicationsByStatus {
  status: string;
  count: number;
}

export interface ApplicationsByDay {
  date: string;
  count: number;
}

export interface ApplicationsReceivedReport {
  total: number;
  by_status: ApplicationsByStatus[];
  by_day: ApplicationsByDay[];
}

// -------------------------------------------------------------------------
// Applications pipeline report
// -------------------------------------------------------------------------

export interface PipelineStageRow {
  kyc_status: string;
  count: number;
  avg_days_in_status: number;
}

export interface ApplicationsPipelineReport {
  stages: PipelineStageRow[];
}

// -------------------------------------------------------------------------
// Incomplete applications report
// -------------------------------------------------------------------------

export interface IncompleteApplicationRow {
  supplier_id: string;
  kyc_status: string;
  days_in_status: number;
  missing_doc_types: string[];
}

// -------------------------------------------------------------------------
// Company P&L report
// -------------------------------------------------------------------------

export interface CompanyPlReport {
  total_face_value_discounted: string;
  total_discount_earned: string;
  total_bank_interest_cost: string;
  gross_profit: string;
}

// -------------------------------------------------------------------------
// Disbursed funds report
// -------------------------------------------------------------------------

export interface DisbursedFundRow {
  invoice_id: string;
  supplier_id: string;
  buyer_id: string;
  disbursed_amount: string;
  disbursed_at: string;
  status: string;
}

export interface DisbursedFundsReport {
  payments: DisbursedFundRow[];
  total_disbursed: string;
  count: number;
}

// -------------------------------------------------------------------------
// CTR report
// -------------------------------------------------------------------------

export interface CtrTransactionRow {
  invoice_id: string;
  amount: string;
  status: string;
  filed_at: string | null;
}

export interface CtrReport {
  period: string;
  transactions: CtrTransactionRow[];
  total_count: number;
}

// -------------------------------------------------------------------------
// SAR status report
// -------------------------------------------------------------------------

export interface SarStatusReportRow {
  id: string;
  entity_type: string;
  reason: string;
  status: string;
  fia_reference: string | null;
}

export interface SarStatusReport {
  total_draft: number;
  total_filed: number;
  total_pending: number;
  reports: SarStatusReportRow[];
}

// -------------------------------------------------------------------------
// Generic report result wrapper
// -------------------------------------------------------------------------

/** Union of all report data types. */
export type ReportData =
  | PortfolioSummary
  | AgingAnalysis
  | BuyerExposure[]
  | ProfitReport
  | FacilityReport
  | AuditExport
  | RegulatoryReport
  | ApplicationsReceivedReport
  | ApplicationsPipelineReport
  | IncompleteApplicationRow[]
  | CompanyPlReport
  | DisbursedFundsReport
  | CtrReport
  | SarStatusReport;

/** Wrapper returned by generateReport. */
export interface ReportResult {
  reportType: ReportType;
  generatedAt: string;
  data: ReportData;
}
