export interface ReportFilters {
  period: string;
  startDate?: string;
  endDate?: string;
}

export interface PortfolioReport {
  totalFunded: string;
  totalCollected: string;
  totalOutstanding: string;
  totalOverdue: string;
  annualisedYield: number;
  invoiceCountsByStatus: Array<{ status: string; count: number }>;
  topBuyers: Array<{ buyerId: string; buyerName: string; totalExposure: string }>;
}

export interface AgingBucket {
  bucket: string;
  count: number;
  totalAmount: string | number;
}

export interface AgingReport {
  buckets: AgingBucket[];
}

export interface BuyerExposureRow {
  buyerId: string;
  buyerName: string;
  usedLimit: string;
  approvedLimit: string;
  utilisationPct: number;
  avgDaysToPay: number;
  overdueIncidentCount: number;
}

export interface InvoiceProfitRow {
  invoiceId: string;
  invoiceNumber?: string;
  faceValue: string;
  discountAmount: string;
  penaltyIncome: string;
  bankInterestCost: string;
  netMmsProfit: string;
  profitMarginPct: number;
}

export interface ProfitSummary {
  totalFaceValue: string;
  totalDiscount: string;
  totalPenaltyIncome: string;
  totalRevenue: string;
  totalBankInterest: string;
  totalNetProfit: string;
  totalWriteOffs: string;
  avgProfitMarginPct: number;
}

export interface ProfitReport {
  invoices: InvoiceProfitRow[];
  summary: ProfitSummary;
}

export interface FacilityReportRow {
  id: string;
  bankName: string;
  totalLimit: string;
  drawnAmount: string;
  availableAmount: string;
  utilisationPct: number;
  interestAccrued: string;
  defaultedExposure: string;
  maturityDate: string;
  status: string;
}

export interface FacilityReport {
  data: FacilityReportRow[];
  totalCount: number;
}

export interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  tableName: string;
  recordId: string;
  createdAt: string;
}

export interface AuditExportReport {
  entries: AuditEntry[];
  totalCount: number;
}

export interface RegulatoryReport {
  amlFlagsRaised: number;
  sarsFiled: number;
  transactionsAboveThreshold: number;
  kycApprovals: number;
  kycRejections: number;
}

export type ReportType =
  | 'portfolio'
  | 'aging'
  | 'buyer-exposure'
  | 'profit'
  | 'facilities'
  | 'audit-export'
  | 'regulatory'
  | 'applications-received'
  | 'applications-pipeline'
  | 'applications-incomplete'
  | 'company-pl'
  | 'disbursed-funds';

// ── Checkers §6 reports — shapes mirror backend `reporting.types.ts` ──────────

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
  byStatus: ApplicationsByStatus[];
  byDay: ApplicationsByDay[];
}

export interface PipelineStageRow {
  kycStatus: string;
  count: number;
  avgDaysInStatus: number;
}
export interface ApplicationsPipelineReport {
  stages: PipelineStageRow[];
}

export interface IncompleteApplicationRow {
  supplierId: string;
  kycStatus: string;
  daysInStatus: number;
  missingDocTypes: string[];
}

export interface CompanyPlReport {
  totalFaceValueDiscounted: string;
  totalDiscountEarned: string;
  totalBankInterestCost: string;
  grossProfit: string;
}

export interface DisbursedFundRow {
  invoiceId: string;
  supplierId: string;
  buyerId: string;
  disbursedAmount: string;
  disbursedAt: string;
  status: string;
}
export interface DisbursedFundsReport {
  payments: DisbursedFundRow[];
  totalDisbursed: string;
  count: number;
}
