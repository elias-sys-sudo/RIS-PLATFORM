import { apiClient } from '@/lib/axios';
import { adaptPricing, type BackendPricingResult } from './pricing.adapter';

// ── Pricing status ────────────────────────────────────────────────────────────

export type PricingStatus = 'pending' | 'accepted' | 'rejected' | 'disputed';

// ── Dispute reason enum ───────────────────────────────────────────────────────

export type DisputeReason =
  | 'rate_too_high'
  | 'advance_too_low'
  | 'tenor_mismatch'
  | 'calculation_error'
  | 'other';

export const DISPUTE_REASON_LABELS: Record<DisputeReason, string> = {
  rate_too_high:     'Discount rate is too high',
  advance_too_low:   'Advance amount is too low',
  tenor_mismatch:    'Tenor does not match my needs',
  calculation_error: 'I believe there is a calculation error',
  other:             'Other concern',
};

// ── Pricing breakdown ─────────────────────────────────────────────────────────

export interface PricingBreakdown {
  invoiceId:            string;
  faceValue:            number;
  advancePercentage:    number;
  advanceAmount:        number;
  discountRate:         number;
  discountAmount:       number;
  bankCost:             number;
  riskPremium:          number;
  risMargin:            number;
  tenor:                number;
  netPaymentToSupplier: number;
  status:               PricingStatus;
  acceptedAt:           string | null;
  rejectedAt:           string | null;
  disputedAt:           string | null;
  dispute:              PricingDispute | null;
}

// ── Dispute payload & record ──────────────────────────────────────────────────

export interface PricingDisputePayload {
  reason:                    DisputeReason;
  proposedRate?:             number;
  proposedAdvancePercentage?: number;
  notes?:                    string;
}

export interface PricingDispute {
  id:                        string;
  invoiceId:                 string;
  reason:                    DisputeReason;
  proposedRate:              number | null;
  proposedAdvancePercentage: number | null;
  notes:                     string | null;
  submittedAt:               string;
  slaDeadline:               string;   // submittedAt + 24 business hours
  status:                    'open' | 'resolved' | 'dismissed';
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function fetchPricing(invoiceId: string): Promise<PricingBreakdown> {
  const { data } = await apiClient.get<BackendPricingResult>(`/invoices/${invoiceId}/pricing`);
  return adaptPricing(data);
}

export async function acceptPricing(invoiceId: string): Promise<void> {
  await apiClient.post(`/invoices/${invoiceId}/pricing/accept`);
}

export async function rejectPricing(invoiceId: string, reason?: string): Promise<void> {
  await apiClient.post(`/invoices/${invoiceId}/pricing/reject`, { reason });
}

export async function disputePricing(
  invoiceId: string,
  payload:   PricingDisputePayload,
): Promise<PricingDispute> {
  const { data } = await apiClient.post<PricingDispute>(
    `/invoices/${invoiceId}/pricing/dispute`,
    payload,
  );
  return data;
}
