// =============================================================================
// Pricing Engine — Types, Interfaces & Enums
// =============================================================================

/** Error codes specific to the pricing engine. */
export enum PricingErrorCode {
  INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND',
  INVOICE_WRONG_STATUS = 'INVOICE_WRONG_STATUS',
  RISK_SCORE_NOT_FOUND = 'RISK_SCORE_NOT_FOUND',
  NO_ACTIVE_FACILITY = 'NO_ACTIVE_FACILITY',
  ALREADY_PRICED = 'ALREADY_PRICED',
  NOT_PRICED = 'PRICING_NOT_PRICED',
  ALREADY_ACCEPTED = 'PRICING_ALREADY_ACCEPTED',
  ALREADY_REJECTED = 'PRICING_ALREADY_REJECTED',
  ALREADY_DISPUTED = 'PRICING_ALREADY_DISPUTED',
  RATE_CAP_EXCEEDED = 'RATE_CAP_EXCEEDED',
}

// -------------------------------------------------------------------------
// Pricing dispute types
// -------------------------------------------------------------------------

export type DisputeReason =
  | 'rate_too_high'
  | 'advance_too_low'
  | 'tenor_mismatch'
  | 'calculation_error'
  | 'other';

/** Payload submitted by supplier when raising a pricing dispute. */
export interface PricingDisputePayload {
  reason: DisputeReason;
  proposedRate?: number;
  proposedAdvancePct?: number;
  notes?: string;
}

/** Row returned from the pricing_disputes table. */
export interface PricingDisputeRecord {
  id: string;
  invoice_id: string;
  submitted_by: string;
  reason: DisputeReason;
  proposed_rate: string | null;
  proposed_advance_pct: string | null;
  notes: string | null;
  submitted_at: string;
  sla_deadline: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
}

/** Public-facing dispute response returned to supplier. */
export interface DisputeResponse {
  id: string;
  invoiceId: string;
  reason: DisputeReason;
  proposedRate: string | null;
  proposedAdvancePct: string | null;
  notes: string | null;
  submittedAt: string;
  slaDeadline: string;
  status: 'open' | 'resolved' | 'dismissed';
}

// -------------------------------------------------------------------------
// DB row types consumed by the pricing engine
// -------------------------------------------------------------------------

export interface InvoiceForPricing {
  id: string;
  face_value: string;
  tenor_days: number;
  status: string;
  buyer_id: string;
  due_date: string;
}

export interface RiskScoreForPricing {
  id: string;
  invoice_id: string;
  max_advance_pct: string;
  risk_premium_rate: string;
  bank_cost_rate: string | null;
}

export interface FacilityForPricing {
  id: string;
  facility_name: string;
  interest_rate_annual: string;
}

export interface BuyerMargin {
  ris_margin_rate: string;
}

// -------------------------------------------------------------------------
// Calculation input / output
// -------------------------------------------------------------------------

export interface PricingCalculationInput {
  faceValue: bigint;
  tenorDays: number;
  maxAdvancePct: number;
  riskPremiumRate: number;
  bankCostRate: number;
  risMarginRate: number;
}

export interface PricingCalculationResult {
  advanceAmount: bigint;
  discountAmount: bigint;
  netPaymentToSupplier: bigint;
  totalDiscountRate: number;
  bankCostAmount: bigint;
  risNetProfit: bigint;
}

// -------------------------------------------------------------------------
// Fee breakdown (supplier-facing display)
// -------------------------------------------------------------------------

export interface FeeBreakdown {
  faceValue: string;
  advancePercentage: string;
  advanceAmount: string;
  discountPercentage: string;
  discountAmount: string;
  netPaymentToSupplier: string;
  bankCostComponent: string;
  riskPremiumComponent: string;
  risMarginComponent: string;
  expectedCollectionDate: string;
}

// -------------------------------------------------------------------------
// Pricing result returned by priceInvoice()
// -------------------------------------------------------------------------

export interface PricingResult {
  invoiceId: string;
  faceValue: string;
  advanceAmount: string;
  discountAmount: string;
  netPaymentToSupplier: string;
  bankCostRate: number;
  riskPremiumRate: number;
  risMarginRate: number;
  totalDiscountRate: number;
  bankCostAmount: string;
  risNetProfit: string;
  feeBreakdown: FeeBreakdown;
}

// -------------------------------------------------------------------------
// DB update payload
// -------------------------------------------------------------------------

export interface PricingUpdate {
  bank_cost_rate: number;
  ris_margin_rate: number;
  total_discount_rate: number;
  advance_amount: string;
  discount_amount: string;
  net_payment_to_supplier: string;
}
