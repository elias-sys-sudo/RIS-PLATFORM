import { apiClient } from '@/lib/axios';
import type {
  PaginatedApprovals,
  ApprovalDetail,
  ApprovalFilters,
  ApprovalResult,
} from '@/types/approval.types';

export async function fetchApprovals(filters: ApprovalFilters = {}): Promise<PaginatedApprovals> {
  const { data } = await apiClient.get<PaginatedApprovals>('/approvals', { params: filters });
  return data;
}

export async function fetchApprovalDetail(invoiceId: string): Promise<ApprovalDetail> {
  const { data } = await apiClient.get<ApprovalDetail>(`/approvals/${invoiceId}`);
  return data;
}

export interface ApprovalDecisionPayload {
  comments?: string;
  credit_memo?: string;
  /** G10 — case summary writeup. Required by backend for TIER_2+. */
  review_summary?: string;
}

export async function approveInvoice(
  invoiceId: string,
  payload: ApprovalDecisionPayload = {},
): Promise<ApprovalResult> {
  const { data } = await apiClient.post<ApprovalResult>(
    `/approvals/${invoiceId}/approve`,
    payload,
  );
  return data;
}

export async function rejectInvoice(
  invoiceId: string,
  payload: ApprovalDecisionPayload & { comments: string },
): Promise<void> {
  await apiClient.post(`/approvals/${invoiceId}/reject`, payload);
}

export async function requestInfo(invoiceId: string, message: string): Promise<void> {
  await apiClient.post(`/approvals/${invoiceId}/request-info`, { message });
}
