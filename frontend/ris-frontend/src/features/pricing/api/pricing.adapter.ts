/* TEMPORARY — remove once the backend pricing service returns the
   final-form PricingBreakdown directly (rates AND component amounts).
   Tracking: backend pricing response alignment ticket. */

import type { PricingBreakdown, PricingStatus } from './pricing.api';

// What the backend actually returns from GET /invoices/:id/pricing,
// after the deepCamelCase axios interceptor.
export interface BackendPricingResult {
  invoiceId?: string;
  faceValue?: number | string;
  advancePercentage?: number;
  advanceAmount?: number | string;
  discountRate?: number;
  discountAmount?: number | string;
  // Backend stores these as RATES (decimals), not currency amounts.
  bankCostRate?: number;
  riskPremiumRate?: number;
  risMarginRate?: number;
  totalDiscountRate?: number;
  // Optional pre-computed amount components.
  bankCostAmount?: number | string;
  feeBreakdown?: {
    bankCostComponent?: number | string;
    riskPremiumComponent?: number | string;
    risMarginComponent?: number | string;
  };
  netPaymentToSupplier?: number | string;
  tenor?: number;
  tenorDays?: number;
  status?: PricingStatus;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  disputedAt?: string | null;
  dispute?: PricingBreakdown['dispute'];
}

function toNumber(v: number | string | undefined | null): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

/** Compute a UGX amount from a rate × face value, falling back to a
 *  pre-computed component amount when the backend supplies one. */
function rateToAmount(
  rate: number | undefined,
  faceValue: number,
  preComputed: number | string | undefined,
): number {
  const fromComponent = toNumber(preComputed);
  if (fromComponent > 0) return fromComponent;
  if (rate === undefined || rate === null) return 0;
  return Math.round(rate * faceValue);
}

export function adaptPricing(raw: BackendPricingResult): PricingBreakdown {
  const faceValue = toNumber(raw.faceValue);
  const fee = raw.feeBreakdown ?? {};
  return {
    invoiceId:            raw.invoiceId ?? '',
    faceValue,
    advancePercentage:    raw.advancePercentage ?? 0,
    advanceAmount:        toNumber(raw.advanceAmount),
    discountRate:         raw.discountRate ?? raw.totalDiscountRate ?? 0,
    discountAmount:       toNumber(raw.discountAmount),
    bankCost:             rateToAmount(raw.bankCostRate, faceValue, fee.bankCostComponent ?? raw.bankCostAmount),
    riskPremium:          rateToAmount(raw.riskPremiumRate, faceValue, fee.riskPremiumComponent),
    risMargin:            rateToAmount(raw.risMarginRate, faceValue, fee.risMarginComponent),
    tenor:                raw.tenor ?? raw.tenorDays ?? 0,
    netPaymentToSupplier: toNumber(raw.netPaymentToSupplier),
    status:               raw.status ?? 'pending',
    acceptedAt:           raw.acceptedAt ?? null,
    rejectedAt:           raw.rejectedAt ?? null,
    disputedAt:           raw.disputedAt ?? null,
    dispute:              raw.dispute ?? null,
  };
}
