import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchPendingPayments, fetchPaymentById, authorisePayment } from '../api/payments.api';
import { parseApiError } from '@/lib/parse-api-error';

/**
 * Single source of truth for the pending-payments React Query key.
 * Imported by use-approvals so an approval mutation can invalidate the
 * finance_manager queue and force an immediate refetch.
 */
export const PAYMENTS_PENDING_QUERY_KEY = ['payments', 'pending'] as const;

export function usePendingPayments() {
  return useQuery({
    queryKey: PAYMENTS_PENDING_QUERY_KEY,
    queryFn: fetchPendingPayments,
    staleTime: 30 * 1000,
  });
}

export function usePaymentDetail(id: string) {
  return useQuery({
    queryKey: ['payments', id],
    queryFn: () => fetchPaymentById(id),
    enabled: !!id,
  });
}

interface AuthorisePaymentVars {
  id: string;
  comment?: string;
}

export function useAuthorisePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: AuthorisePaymentVars) => authorisePayment(id, comment),
    onSuccess: () => {
      toast.success('Payment authorised');
      void qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}
