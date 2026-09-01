import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ConfirmPayload, DisputePayload } from '../api/verification.api';
import { fetchVerification, confirmVerification, disputeVerification } from '../api/verification.api';
import { parseApiError } from '@/lib/parse-api-error';

export function useVerification(token: string) {
  return useQuery({
    queryKey: ['verification', token],
    queryFn: () => fetchVerification(token),
    enabled: !!token,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useConfirmVerification(token: string) {
  return useMutation({
    mutationFn: (payload: ConfirmPayload) => confirmVerification(token, payload),
    onSuccess: () => {
      toast.success('Verification confirmed successfully');
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useDisputeVerification(token: string) {
  return useMutation({
    mutationFn: (payload: DisputePayload) => disputeVerification(token, payload),
    onSuccess: () => {
      toast.success('Dispute submitted successfully');
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}
