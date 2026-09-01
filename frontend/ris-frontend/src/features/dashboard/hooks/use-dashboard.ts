import { useQuery } from '@tanstack/react-query';
import type { Period } from '@/types/dashboard.types';
import { dashboardKeys } from '@/lib/query-keys';
import {
  fetchDashboardSummary,
  fetchApprovalQueue,
  fetchFundingPipeline,
  fetchSupplierDashboard,
  fetchLegalDashboard,
  fetchRiskDistribution,
} from '../api/dashboard.api';

export function useDashboardSummary(period: Period = '30d') {
  return useQuery({
    queryKey: dashboardKeys.summary(period),
    queryFn: () => fetchDashboardSummary(period),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 60 * 1000, // Polling fallback: 60s
    refetchIntervalInBackground: false,
  });
}

export function useApprovalQueue() {
  return useQuery({
    queryKey: dashboardKeys.approvalQueue(),
    queryFn: fetchApprovalQueue,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000, // Polling fallback: 30s
    refetchIntervalInBackground: false,
  });
}

export function useFundingPipeline() {
  return useQuery({
    queryKey: dashboardKeys.fundingPipeline(),
    queryFn: fetchFundingPipeline,
    staleTime: 60 * 1000,
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: false,
  });
}

export function useSupplierDashboard(period: Period = '30d') {
  return useQuery({
    queryKey: dashboardKeys.supplier(period),
    queryFn: () => fetchSupplierDashboard(period),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
  });
}

export function useLegalDashboard() {
  return useQuery({
    queryKey: dashboardKeys.legal(),
    queryFn: fetchLegalDashboard,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRiskDistribution(period: Period = '30d') {
  return useQuery({
    queryKey: dashboardKeys.risk(period),
    queryFn: () => fetchRiskDistribution(period),
    staleTime: 5 * 60 * 1000,
  });
}
