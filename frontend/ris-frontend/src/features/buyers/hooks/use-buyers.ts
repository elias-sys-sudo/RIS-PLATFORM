import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchBuyers, fetchBuyerById, createBuyer, updateBuyer } from '../api/buyers.api';
import type { CreateBuyerPayload, UpdateBuyerPayload } from '../api/buyers.api';
import { parseApiError } from '@/lib/parse-api-error';

export function useBuyers() {
  return useQuery({ queryKey: ['buyers'], queryFn: fetchBuyers, staleTime: 60 * 1000 });
}

export function useBuyerDetail(id: string) {
  return useQuery({ queryKey: ['buyers', id], queryFn: () => fetchBuyerById(id), enabled: !!id, staleTime: 60 * 1000 });
}

export function useCreateBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateBuyerPayload) => createBuyer(payload),
    onSuccess: () => {
      toast.success('Buyer created');
      void qc.invalidateQueries({ queryKey: ['buyers'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useUpdateBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateBuyerPayload }) => updateBuyer(id, payload),
    onSuccess: () => {
      toast.success('Buyer updated');
      void qc.invalidateQueries({ queryKey: ['buyers'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}
