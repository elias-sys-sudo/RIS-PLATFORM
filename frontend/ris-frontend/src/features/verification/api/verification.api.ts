import { apiClient } from '@/lib/axios';

// ── Types ────────────────────────────────────────────────────────────────────

export interface VerificationData {
  invoiceNumber: string;
  supplierName: string;
  buyerName: string;
  faceValue: number;
  dueDate: string;
  description: string;
}

export interface ConfirmPayload {
  invoiceIsValid: boolean;
  amountIsCorrect: boolean;
  dueDateIsCorrect: boolean;
  agreesToPayRis: boolean;
}

export interface DisputePayload {
  reason: string;
  disputeType: 'incorrect_amount' | 'incorrect_date' | 'not_recognized' | 'other';
}

// ── API functions ────────────────────────────────────────────────────────────

export async function fetchVerification(token: string): Promise<VerificationData> {
  const { data } = await apiClient.get<VerificationData>(`/verify/${token}`);
  return data;
}

export async function confirmVerification(token: string, payload: ConfirmPayload): Promise<void> {
  await apiClient.post(`/verify/${token}/confirm`, payload);
}

export async function disputeVerification(token: string, payload: DisputePayload): Promise<void> {
  await apiClient.post(`/verify/${token}/dispute`, payload);
}
