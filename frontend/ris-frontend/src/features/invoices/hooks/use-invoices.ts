import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { InvoiceFilters, CreateInvoicePayload } from '@/types/invoice.types';
import {
  fetchInvoices,
  fetchInvoiceById,
  createInvoice,
  submitDraftInvoice,
  confirmBuyer,
  runRiskScoring,
  generatePricing,
  approveInvoice,
  rejectInvoice,
  authoriseFirst,
  authoriseSecond,
  executePayment,
  markFunded,
  fetchInvoiceDocumentFile,
} from '../api/invoices.api';
import { parseApiError } from '@/lib/parse-api-error';

export function useInvoices(filters: InvoiceFilters = {}) {
  return useQuery({
    queryKey: ['invoices', filters],
    queryFn: () => fetchInvoices(filters),
    staleTime: 30 * 1000,
  });
}

export function useInvoiceDetail(id: string) {
  return useQuery({
    queryKey: ['invoices', id],
    queryFn: () => fetchInvoiceById(id),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateInvoicePayload) => createInvoice(payload),
    onSuccess: () => {
      toast.success('Invoice submitted successfully');
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useSubmitDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => submitDraftInvoice(id),
    onSuccess: () => {
      toast.success('Invoice submitted for review');
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

// ── Workflow transition hooks ────────────────────────────────────────────────

function useWorkflowMutation(mutationFn: (id: string) => Promise<unknown>, successMessage: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (_data, id) => {
      toast.success(successMessage);
      void qc.invalidateQueries({ queryKey: ['invoices', id] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useConfirmBuyer() {
  return useWorkflowMutation(
    confirmBuyer,
    'Confirmation email sent — waiting for the buyer to click the link.',
  );
}

export function useRunRiskScoring() {
  return useWorkflowMutation(runRiskScoring, 'Risk scoring completed');
}

export function useGeneratePricing() {
  return useWorkflowMutation(generatePricing, 'Pricing generated successfully');
}

export function useApproveInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comments }: { id: string; comments: string }) =>
      approveInvoice(id, comments),
    onSuccess: (_data, vars) => {
      toast.success('Invoice approved');
      void qc.invalidateQueries({ queryKey: ['invoices', vars.id] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useRejectInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comments }: { id: string; comments: string }) => rejectInvoice(id, comments),
    onSuccess: (_data, vars) => {
      toast.success('Invoice rejected');
      void qc.invalidateQueries({ queryKey: ['invoices', vars.id] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

/** Stage 11 dual-auth hooks — pass current user to enforce different-user rule */
export function useAuthoriseFirst() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      userId,
      userName,
      comment,
    }: {
      id: string;
      userId: string;
      userName: string;
      comment?: string;
    }) => authoriseFirst(id, { user_id: userId, user_name: userName, comment }),
    onSuccess: (_data, vars) => {
      toast.success('First authorisation granted — timestamp recorded');
      void qc.invalidateQueries({ queryKey: ['invoices', vars.id] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useAuthoriseSecond() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      userId,
      userName,
      comment,
    }: {
      id: string;
      userId: string;
      userName: string;
      comment?: string;
    }) => authoriseSecond(id, { user_id: userId, user_name: userName, comment }),
    onSuccess: (_data, vars) => {
      toast.success('Second authorisation granted — timestamp recorded');
      void qc.invalidateQueries({ queryKey: ['invoices', vars.id] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useExecutePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      userId,
      userName,
      comment,
    }: {
      id: string;
      userId: string;
      userName: string;
      comment?: string;
    }) => executePayment(id, { user_id: userId, user_name: userName, comment }),
    onSuccess: (_data, vars) => {
      toast.success('Payment execution initiated');
      void qc.invalidateQueries({ queryKey: ['invoices', vars.id] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useMarkFunded() {
  return useWorkflowMutation(markFunded, 'Invoice marked as funded');
}

/**
 * Fetch the decrypted blob of an invoice document for inline preview.
 * Mirrors useKycDocumentFile: cached for 5 min, no retry on error.
 */
export function useInvoiceDocumentFile(
  invoiceId: string,
  documentId: string,
  options: { enabled?: boolean } = {},
) {
  const enabled = (options.enabled ?? true) && !!invoiceId && !!documentId;
  return useQuery({
    queryKey: ['invoices', invoiceId, 'documents', documentId, 'file'],
    queryFn: () => fetchInvoiceDocumentFile(invoiceId, documentId),
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  });
}
