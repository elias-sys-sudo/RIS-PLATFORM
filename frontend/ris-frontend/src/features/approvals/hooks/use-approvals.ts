import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ApprovalFilters, ApprovalResult } from '@/types/approval.types';
import {
  fetchApprovals,
  fetchApprovalDetail,
  approveInvoice,
  rejectInvoice,
  requestInfo,
} from '../api/approvals.api';
import { parseApiError, getErrorStatus } from '@/lib/parse-api-error';
import { PAYMENTS_PENDING_QUERY_KEY } from '@/features/payments/hooks/use-payments';

const LOCK_CONFLICT_MSG =
  'Another officer is currently reviewing this invoice. Please try again shortly.';

export function useApprovals(filters: ApprovalFilters = {}) {
  return useQuery({
    queryKey: ['approvals', 'list', filters],
    queryFn: () => fetchApprovals(filters),
    staleTime: 30 * 1000,
  });
}

export function useApprovalDetail(invoiceId: string) {
  return useQuery({
    queryKey: ['approvals', invoiceId],
    queryFn: () => fetchApprovalDetail(invoiceId),
    enabled: !!invoiceId,
  });
}

export function useApproveInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, reason, reviewSummary, creditMemo }: {
      invoiceId: string;
      reason?: string;
      /** G10 — case summary writeup, required for TIER_2+. */
      reviewSummary?: string;
      creditMemo?: string;
    }) => approveInvoice(invoiceId, {
      comments: reason,
      review_summary: reviewSummary,
      credit_memo: creditMemo,
    }),
    onSuccess: (result: ApprovalResult) => {
      // Branch the toast on quorum so a Tier-3 partial doesn't look "done".
      if (result.tier === 'TIER_3' && !result.quorumReached) {
        toast.info('1 of 2 approvals received — awaiting second officer');
      } else if (!result.quorumReached) {
        toast.success('Approval recorded — pending quorum');
      } else {
        toast.success('Invoice approved — payment queued for authorisation');
      }
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      // Force the finance_manager's pending queue to refetch; without this
      // the 30s staleTime hides the new payment row.
      void qc.invalidateQueries({ queryKey: PAYMENTS_PENDING_QUERY_KEY });
    },
    onError: (err: unknown) => {
      toast.error(getErrorStatus(err) === 409 ? LOCK_CONFLICT_MSG : parseApiError(err));
    },
  });
}

export function useRejectInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, reason, reviewSummary, creditMemo }: {
      invoiceId: string;
      reason: string;
      reviewSummary?: string;
      creditMemo?: string;
    }) => rejectInvoice(invoiceId, {
      comments: reason,
      review_summary: reviewSummary,
      credit_memo: creditMemo,
    }),
    onSuccess: () => {
      toast.success('Invoice rejected');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorStatus(err) === 409 ? LOCK_CONFLICT_MSG : parseApiError(err));
    },
  });
}

export function useRequestInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, message }: { invoiceId: string; message: string }) =>
      requestInfo(invoiceId, message),
    onSuccess: () => {
      toast.success('Information request sent');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}
