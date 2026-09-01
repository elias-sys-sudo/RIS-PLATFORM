import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  createBuyerRequest,
  fetchMyBuyerRequests,
  fetchBuyerRequests,
  reviewBuyerRequest,
} from '../api/buyer-requests.api';
import type {
  CreateBuyerRequestPayload,
  ReviewBuyerRequestPayload,
  BuyerRequestStatus,
} from '@/types/buyer-request.types';
import { buyerRequestKeys } from '@/lib/query-keys';
import { parseApiError } from '@/lib/parse-api-error';

/** Supplier: submit a new buyer onboarding request. */
export function useCreateBuyerRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateBuyerRequestPayload) =>
      createBuyerRequest(payload),
    onSuccess: () => {
      toast.success(
        'Request submitted. Your credit officer will review it.',
      );
      void qc.invalidateQueries({ queryKey: buyerRequestKeys.all });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

/** Supplier: list their own buyer requests. */
export function useMyBuyerRequests() {
  return useQuery({
    queryKey: buyerRequestKeys.mine(),
    queryFn: fetchMyBuyerRequests,
    staleTime: 60 * 1000,
  });
}

/** Credit officer / management: list buyer requests, optionally by status. */
export function useBuyerRequests(status?: BuyerRequestStatus) {
  return useQuery({
    queryKey: buyerRequestKeys.list(status),
    queryFn: () => fetchBuyerRequests(status),
    staleTime: 30 * 1000,
  });
}

/** Credit officer: approve or reject a buyer request. */
export function useReviewBuyerRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: ReviewBuyerRequestPayload;
    }) => reviewBuyerRequest(id, payload),
    onSuccess: (_data, variables) => {
      const verb =
        variables.payload.status === 'approved' ? 'approved' : 'rejected';
      toast.success(`Buyer request ${verb}.`);
      void qc.invalidateQueries({ queryKey: buyerRequestKeys.all });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}
