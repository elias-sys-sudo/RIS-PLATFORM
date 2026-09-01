// =============================================================================
// Facilities — Types, Interfaces & Enums
// =============================================================================

/** Bank facility lifecycle status. */
export enum FacilityStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  MATURED = 'matured',
  CLOSED = 'closed',
}

/** Drawdown lifecycle status. */
export enum DrawdownStatus {
  ACTIVE = 'active',
  REPAID = 'repaid',
  OVERDUE = 'overdue',
}

/** Error codes specific to the facilities module. */
export enum FacilityErrorCode {
  FACILITY_NOT_FOUND = 'FACILITY_NOT_FOUND',
  FACILITY_SUSPENDED = 'FACILITY_SUSPENDED',
  FACILITY_MATURED = 'FACILITY_MATURED',
  FACILITY_CLOSED = 'FACILITY_CLOSED',
  MATURITY_MISMATCH = 'MATURITY_MISMATCH',
  INSUFFICIENT_AVAILABLE = 'INSUFFICIENT_AVAILABLE',
  DRAWDOWN_NOT_FOUND = 'DRAWDOWN_NOT_FOUND',
  DRAWDOWN_ALREADY_REPAID = 'DRAWDOWN_ALREADY_REPAID',
  UTILISATION_EXCEEDED = 'UTILISATION_EXCEEDED',
}

// -------------------------------------------------------------------------
// DB row types
// -------------------------------------------------------------------------

/** Full row from bank_facilities table. */
export interface BankFacility {
  id: string;
  bank_name: string;
  total_limit: string;
  drawn_amount: string;
  available_amount: string;
  annual_rate: string;
  maturity_date: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Full row from facility_drawdowns table. */
export interface FacilityDrawdown {
  id: string;
  facility_id: string;
  invoice_id: string;
  principal: string;
  accrued_interest: string;
  bank_fees: string;
  status: string;
  last_accrued_date: string;
  created_at: string;
  updated_at: string;
}

/** Repayment record row. */
export interface FacilityRepayment {
  id: string;
  drawdown_id: string;
  facility_id: string;
  principal: string;
  interest: string;
  bank_fees: string;
  total_amount: string;
  repaid_at: string;
}

// -------------------------------------------------------------------------
// Calculation types
// -------------------------------------------------------------------------

/** Result of repayment calculation. */
export interface RepaymentCalculation {
  drawdownId: string;
  principal: string;
  accruedInterest: string;
  bankFees: string;
  totalRepayment: string;
}

/** Daily interest accrual calculation. */
export interface InterestAccrual {
  drawdownId: string;
  principal: string;
  annualRate: string;
  dailyInterest: string;
  daysAccrued: number;
}

// -------------------------------------------------------------------------
// Dashboard types
// -------------------------------------------------------------------------

/** Facility utilisation dashboard for finance_manager / management. */
export interface FacilityDashboard {
  totalFacilities: number;
  totalLimit: string;
  totalDrawn: string;
  totalAvailable: string;
  overallUtilisation: number;
  facilities: FacilityDashboardItem[];
}

/** Individual facility in the dashboard. */
export interface FacilityDashboardItem {
  id: string;
  bankName: string;
  totalLimit: string;
  drawnAmount: string;
  availableAmount: string;
  utilisationPercent: number;
  annualRate: string;
  maturityDate: string;
  status: string;
  activeDrawdowns: number;
}

// -------------------------------------------------------------------------
// Request / input types
// -------------------------------------------------------------------------

/** Input for creating a drawdown. */
export interface CreateDrawdownInput {
  id: string;
  facilityId: string;
  invoiceId: string;
  principal: string;
  bankFees: string;
}

/** Input for recording a repayment. */
export interface RecordRepaymentInput {
  id: string;
  drawdownId: string;
  facilityId: string;
  principal: string;
  interest: string;
  bankFees: string;
  totalAmount: string;
}

// -------------------------------------------------------------------------
// Facility detail response (GET /facilities/:id)
// -------------------------------------------------------------------------

/** A single drawdown as shown on the facility-detail page. */
export interface FacilityDetailDrawdown {
  id: string;
  amount: string;
  invoiceRef: string;
  drawnAt: string;
}

/** A single repayment as shown on the facility-detail page. */
export interface FacilityDetailRepayment {
  id: string;
  amount: string;
  paidAt: string;
  reference: string;
}

/** Shape returned by GET /facilities/:id. Mirrors frontend FacilityDetail. */
export interface FacilityDetail {
  id: string;
  bankName: string;
  totalLimit: string;
  drawnAmount: string;
  availableAmount: string;
  utilisationPct: number;
  interestRate: string;
  interestAccrued: string;
  defaultedExposure: string;
  maturityDate: string;
  status: string;
  createdAt: string;
  drawdowns: FacilityDetailDrawdown[];
  repayments: FacilityDetailRepayment[];
}
