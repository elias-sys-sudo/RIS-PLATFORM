import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fetchPricing,
  acceptPricing,
  rejectPricing,
  disputePricing,
} from '../api/pricing.api';
import type { PricingDisputePayload } from '../api/pricing.api';
import { parseApiError } from '@/lib/parse-api-error';

export function usePricing(invoiceId: string) {
  return useQuery({
    queryKey: ['pricing', invoiceId],
    queryFn:  () => fetchPricing(invoiceId),
    enabled:  !!invoiceId,
  });
}

export function useAcceptPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => acceptPricing(invoiceId),
    onSuccess: (_data, invoiceId) => {
      toast.success('Pricing accepted — your invoice will proceed to approval.');
      void qc.invalidateQueries({ queryKey: ['pricing', invoiceId] });
      void qc.invalidateQueries({ queryKey: ['invoices', invoiceId] });
    },
    onError: (err: unknown) => toast.error(parseApiError(err)),
  });
}

export function useRejectPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, reason }: { invoiceId: string; reason?: string }) =>
      rejectPricing(invoiceId, reason),
    onSuccess: (_data, vars) => {
      toast.success('Pricing declined.');
      void qc.invalidateQueries({ queryKey: ['pricing', vars.invoiceId] });
      void qc.invalidateQueries({ queryKey: ['invoices', vars.invoiceId] });
    },
    onError: (err: unknown) => toast.error(parseApiError(err)),
  });
}

export function useDisputePricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, payload }: { invoiceId: string; payload: PricingDisputePayload }) =>
      disputePricing(invoiceId, payload),
    onSuccess: (_data, vars) => {
      toast.success('Dispute submitted. Our credit team will respond within 1 business day.');
      void qc.invalidateQueries({ queryKey: ['pricing', vars.invoiceId] });
      void qc.invalidateQueries({ queryKey: ['invoices', vars.invoiceId] });
    },
    onError: (err: unknown) => toast.error(parseApiError(err)),
  });
}
