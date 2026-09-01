// =============================================================================
// Risk Engine — Types, Interfaces & Enums
// =============================================================================

/** Strategy interface: every scoring factor implements this. */
export interface IScoringFactor {
  readonly name: string;
  readonly weight: number;
  calculate(ctx: ScoringContext): Promise<FactorScore>;
}

/** Context passed to every scorer. */
export interface ScoringContext {
  invoiceId: string;
  invoice: InvoiceForScoring;
  buyer: BuyerForScoring;
}

/** Result returned by each scorer. */
export interface FactorScore {
  name: string;
  rawScore: number;
  weightedScore: number;
}

/** Recommendation after scoring. */
export enum RiskRecommendation {
  AUTO_APPROVE = 'AUTO_APPROVE',
  REFER_TO_MANAGER = 'REFER_TO_MANAGER',
  REJECT = 'REJECT',
}

/** Error codes specific to the risk engine. */
export enum RiskEngineErrorCode {
  INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND',
  INVOICE_WRONG_STATUS = 'INVOICE_WRONG_STATUS',
  ALREADY_SCORED = 'ALREADY_SCORED',
}

// -------------------------------------------------------------------------
// DB row types consumed by the risk engine
// -------------------------------------------------------------------------

export interface InvoiceForScoring {
  id: string;
  invoice_number: string;
  face_value: string;
  tenor_days: number;
  status: string;
  buyer_id: string;
  supplier_id: string;
  aml_flagged: boolean;
}

export interface BuyerForScoring {
  id: string;
  credit_rating: string;
  approved_limit: string;
  used_limit: string;
  ris_margin_rate: string;
  payment_score: number;
}

export interface TrackRecordResult {
  invoice_count: number;
  on_time_pct: number;
  has_defaults: boolean;
}

export interface BuyerUtilisation {
  used_limit: string;
  approved_limit: string;
  projected_utilisation_pct: number;
}

export interface CollateralForScoring {
  collateral_type: string;
  value: string;
  is_active: boolean;
}

// -------------------------------------------------------------------------
// Risk score persistence
// -------------------------------------------------------------------------

export interface RiskScoreInsert {
  id: string;
  invoice_id: string;
  buyer_credit_score: number;
  tenor_score: number;
  track_record_score: number;
  concentration_score: number;
  collateral_score: number;
  final_score: number;
  recommendation: string;
  max_advance_pct: number;
  risk_premium_rate: number;
  scored_by: string;
}

export interface RiskScoreRecord {
  id: string;
  invoice_id: string;
  buyer_credit_score: string;
  tenor_score: string;
  track_record_score: string;
  concentration_score: string;
  collateral_score: string;
  final_score: number;
  recommendation: string;
  max_advance_pct: string;
  risk_premium_rate: string;
  scored_by: string;
  created_at: string;
}

/** Composite result returned by scoreInvoice(). */
export interface RiskScore {
  invoiceId: string;
  factors: FactorScore[];
  finalScore: number;
  recommendation: RiskRecommendation;
  maxAdvancePct: number;
  riskPremiumRate: number;
}
