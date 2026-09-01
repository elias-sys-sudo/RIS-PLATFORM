// ============================================================
// settlements.types.ts — Settlement & Profit Booking types
// ============================================================

export enum SettlementStatus {
  PENDING = 'pending',
  FACILITY_REPAID = 'facility_repaid',
  PROFIT_BOOKED = 'profit_booked',
  CLOSED = 'closed',
}

export enum SettlementErrorCode {
  NOT_FOUND = 'SETTLEMENT_NOT_FOUND',
  WRONG_STATUS = 'SETTLEMENT_WRONG_STATUS',
  ALREADY_EXISTS = 'SETTLEMENT_ALREADY_EXISTS',
  DRAWDOWN_NOT_FOUND = 'SETTLEMENT_DRAWDOWN_NOT_FOUND',
  COLLECTION_NOT_FOUND = 'SETTLEMENT_COLLECTION_NOT_FOUND',
  INVOICE_NOT_COLLECTED = 'SETTLEMENT_INVOICE_NOT_COLLECTED',
}

export interface SettlementRecord {
  id: string;
  invoice_id: string;
  collection_id: string;
  drawdown_id: string | null;
  buyer_payment_amount: string;
  facility_repayment_amount: string;
  accrued_interest: string;
  penalty_income: string;
  net_profit: string;
  status: string;
  settled_by: string | null;
  settled_at: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

/**
 * Settlement enriched with the related invoice/supplier/buyer/drawdown details.
 * Returned by GET /settlements/:id and the list endpoint so the frontend has
 * everything it needs to render the 4-step lifecycle UI without extra fetches.
 */
export interface EnrichedSettlement extends SettlementRecord {
  invoice_number: string;
  supplier_name: string;
  buyer_name: string;
  face_value: string;
  advance_amount: string;
  drawdown_principal: string | null;
}

export interface ProfitBookingRecord {
  id: string;
  settlement_id: string;
  discount_earned: string;
  bank_cost_paid: string;
  penalty_income: string;
  net_profit: string;
  booked_by: string;
  booked_at: string;
}

export interface CreateSettlementInput {
  invoiceId: string;
  collectionId: string;
  drawdownId: string | null;
  buyerPaymentAmount: string;
  facilityRepaymentAmount: string;
  accruedInterest: string;
  penaltyIncome: string;
}

export interface SettlementSummary {
  id: string;
  invoice_id: string;
  invoice_number: string;
  supplier_name: string;
  buyer_name: string;
  buyer_payment_amount: string;
  facility_repayment_amount: string;
  net_profit: string;
  status: string;
  settled_at: string | null;
  created_at: string;
}

export interface ProfitBookingInput {
  settlementId: string;
  discountEarned: string;
  bankCostPaid: string;
  penaltyIncome: string;
  netProfit: string;
}

/**
 * Aggregated dashboard metrics for management/finance/auditor reporting.
 * All BigInt amounts serialised as strings. Period bounds are ISO 8601.
 */
export interface DashboardResponse {
  period_start: string;
  period_end: string;
  total_settlements: number;
  total_profit_booked: string;
  total_facility_repayment: string;
  pending_count: number;
  avg_profit_per_invoice: string;
}

export interface DashboardRow {
  total_settlements: string;
  total_profit_booked: string;
  total_facility_repayment: string;
  pending_count: string;
  avg_profit_per_invoice: string;
}
