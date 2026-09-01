import { apiClient } from '@/lib/axios';

export interface PaymentRecord {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  buyerName: string;
  amount: string;
  // Historical rows may still carry 'MTN_MOMO' / 'AIRTEL' values (audit
  // immutability — DB enum keeps them). New payments are always 'EFT' or
  // 'MOCK'. The string type accepts both so the table renders legacy rows
  // without filtering them out.
  provider: string;
  status: string;
  dualAuthUser1: string | null;
  dualAuthUser1Name: string | null;
  dualAuthUser2: string | null;
  dualAuthUser2Name: string | null;
  transactionReference: string | null;
  fundedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  slaDeadline: string;
}

export async function fetchPendingPayments(): Promise<PaymentRecord[]> {
  const { data } = await apiClient.get<{ data: PaymentRecord[] }>('/payments/pending');
  return data.data;
}

export async function fetchPaymentById(id: string): Promise<PaymentRecord> {
  const { data } = await apiClient.get<{ data: PaymentRecord }>(`/payments/${id}`);
  return data.data;
}

export async function authorisePayment(
  id: string,
  comment?: string,
): Promise<PaymentRecord> {
  const trimmed = comment?.trim();
  const body = trimmed && trimmed.length > 0 ? { comment: trimmed } : {};
  const { data } = await apiClient.post<{ data: PaymentRecord }>(
    `/payments/${id}/authorise`,
    body,
  );
  return data.data;
}
