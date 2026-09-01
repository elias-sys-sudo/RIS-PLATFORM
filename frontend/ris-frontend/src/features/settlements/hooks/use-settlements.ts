import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fetchSettlements,
  fetchSettlementById,
  repayFacility,
  bookProfit,
  closeSettlement,
  type SettlementFilters,
} from '../api/settlements.api';
import { parseApiError } from '@/lib/parse-api-error';

export function useSettlements(filters: SettlementFilters = {}) {
  return useQuery({
    queryKey: ['settlements', filters],
    queryFn: () => fetchSettlements(filters),
    staleTime: 60 * 1000,
  });
}

export function useSettlementDetail(id: string) {
  return useQuery({
    queryKey: ['settlements', id],
    queryFn: () => fetchSettlementById(id),
    enabled: !!id,
  });
}

export function useRepayFacility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      facilityRepaymentAmount,
      accruedInterest,
    }: {
      id: string;
      facilityRepaymentAmount: string;
      accruedInterest: string;
    }) => repayFacility(id, facilityRepaymentAmount, accruedInterest),
    onSuccess: () => {
      toast.success('Facility repayment recorded');
      void qc.invalidateQueries({ queryKey: ['settlements'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useBookProfit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      discountEarned,
      bankCostPaid,
    }: {
      id: string;
      discountEarned: string;
      bankCostPaid: string;
    }) => bookProfit(id, discountEarned, bankCostPaid),
    onSuccess: () => {
      toast.success('Profit booked successfully');
      void qc.invalidateQueries({ queryKey: ['settlements'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useCloseSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => closeSettlement(id),
    onSuccess: () => {
      toast.success('Settlement closed');
      void qc.invalidateQueries({ queryKey: ['settlements'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}
