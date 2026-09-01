import { apiClient } from '@/lib/axios';
import type {
  PaginatedInvoices,
  InvoiceDetail,
  InvoiceFilters,
  CreateInvoicePayload,
} from '@/types/invoice.types';

export async function fetchInvoices(filters: InvoiceFilters = {}): Promise<PaginatedInvoices> {
  const { data } = await apiClient.get<PaginatedInvoices>('/invoices', { params: filters });
  return data;
}

export async function fetchInvoiceById(id: string): Promise<InvoiceDetail> {
  const { data } = await apiClient.get<InvoiceDetail>(`/invoices/${id}`);
  return data;
}

export async function createInvoice(payload: CreateInvoicePayload): Promise<{ invoiceId: string }> {
  const { data } = await apiClient.post<{ invoiceId: string }>('/invoices/submit', payload);
  return data;
}

export async function submitDraftInvoice(id: string): Promise<InvoiceDetail> {
  const { data } = await apiClient.post<InvoiceDetail>(`/invoices/${id}/submit`);
  return data;
}

// ── Workflow transition endpoints ────────────────────────────────────────────

/**
 * Trigger sending (or re-sending) the buyer confirmation email.
 *
 * The button labelled "Confirm Buyer" does NOT directly confirm the invoice
 * — by design (verification module CLAUDE.md), only the buyer can confirm,
 * by clicking the link in the email. This call regenerates the confirmation
 * token and queues a fresh email to the buyer's contact address.
 *
 * Status stays `submitted` until the buyer clicks the link and submits the
 * 4-way confirmation form (`POST /verify/:token/confirm`).
 */
export async function confirmBuyer(id: string): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(
    `/verify/admin/invoices/${id}/resend-confirmation`,
  );
  return data;
}

// ── Invoice document file fetch ─────────────────────────────────────────────

/**
 * Build the URL for an invoice document file. Used by both the inline
 * preview hook and the authenticated download fallback. The route is
 * scoped to (invoiceId, docId) so the backend rejects cross-invoice access
 * even if a docId is guessed.
 */
export function buildInvoiceDocumentFileUrl(invoiceId: string, documentId: string): string {
  return `/invoices/${invoiceId}/documents/${documentId}/file`;
}

/**
 * Fetch the decrypted bytes of an invoice document for inline preview.
 * apiClient attaches the bearer token; the backend re-checks ownership
 * before streaming.
 */
export async function fetchInvoiceDocumentFile(
  invoiceId: string,
  documentId: string,
): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(buildInvoiceDocumentFileUrl(invoiceId, documentId), {
    responseType: 'blob',
  });
  return data;
}

export async function runRiskScoring(id: string): Promise<InvoiceDetail> {
  const { data } = await apiClient.post<InvoiceDetail>(`/invoices/${id}/score`);
  return data;
}

export async function generatePricing(id: string): Promise<InvoiceDetail> {
  // POST /invoices/:id/pricing/generate — synchronous re-run of pricing for a
  // scored invoice. Returns the new pricing or surfaces the failure reason
  // (e.g. "Total annual rate exceeds maximum") via the standard error envelope.
  const { data } = await apiClient.post<InvoiceDetail>(`/invoices/${id}/pricing/generate`);
  return data;
}

// Backend Joi (approvals.routes.ts) requires comments min 20 chars, plural.
// Used by credit_officer / management to advance an invoice from `priced`
// to `approved` (then the finance team's dual-auth queue picks it up).
export async function approveInvoice(id: string, comments: string): Promise<InvoiceDetail> {
  const { data } = await apiClient.post<InvoiceDetail>(`/invoices/${id}/approve`, { comments });
  return data;
}

export async function rejectInvoice(id: string, comments: string): Promise<InvoiceDetail> {
  const { data } = await apiClient.post<InvoiceDetail>(`/invoices/${id}/reject`, { comments });
  return data;
}

/** Stage 11 dual-auth — passes current user so backend can enforce different-user rule */
export interface AuthorisePayload {
  user_id: string;
  user_name: string;
  comment?: string;
}

export async function authoriseFirst(id: string, user: AuthorisePayload): Promise<InvoiceDetail> {
  const { data } = await apiClient.post<InvoiceDetail>(`/invoices/${id}/authorise`, user);
  return data;
}

export async function authoriseSecond(id: string, user: AuthorisePayload): Promise<InvoiceDetail> {
  const { data } = await apiClient.post<InvoiceDetail>(`/invoices/${id}/authorise`, user);
  return data;
}

export async function executePayment(id: string, user: AuthorisePayload): Promise<InvoiceDetail> {
  const { data } = await apiClient.post<InvoiceDetail>(`/invoices/${id}/authorise`, user);
  return data;
}

export async function markFunded(id: string): Promise<InvoiceDetail> {
  const { data } = await apiClient.post<InvoiceDetail>(`/invoices/${id}/mark-funded`);
  return data;
}

// ── G6: Per-invoice bank details (post-approval) ──────────────────────────────

export interface InvoiceBankDetailsPayload {
  bank_account_number: string;
  bank_account_name: string;
  bank_name: string;
}

/**
 * Capture bank destination for a specific approved invoice.
 * Backend enforces status === 'approved' and supplier ownership.
 */
export async function setInvoiceBankDetails(
  id: string,
  payload: InvoiceBankDetailsPayload,
): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(
    `/invoices/${id}/bank-details`,
    payload,
  );
  return data;
}

// ── G11: Application assignment ───────────────────────────────────────────────

/**
 * Assign (or un-assign with null) an invoice to a reviewer.
 * Role-gated backend: credit_officer / finance_manager / management.
 */
export async function assignInvoice(
  id: string,
  userId: string | null,
): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(`/invoices/${id}/assign`, {
    user_id: userId,
  });
  return data;
}
