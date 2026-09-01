import { apiClient } from '@/lib/axios';
import type {
  DashboardSummary,
  Period,
  ApprovalQueueItem,
  FundingPipelineItem,
  SupplierDashboardSummary,
  LegalDashboardSummary,
  RiskDistributionItem,
} from '@/types/dashboard.types';

export async function fetchDashboardSummary(period: Period = '30d'): Promise<DashboardSummary> {
  const { data } = await apiClient.get<{ data: DashboardSummary }>('/dashboard/summary', {
    params: { period },
  });
  return data.data;
}

export async function fetchApprovalQueue(): Promise<ApprovalQueueItem[]> {
  const { data } = await apiClient.get<{ data: ApprovalQueueItem[] }>('/dashboard/approval-queue');
  return data.data;
}

export async function fetchFundingPipeline(): Promise<FundingPipelineItem[]> {
  const { data } = await apiClient.get<{ data: FundingPipelineItem[] }>('/dashboard/funding-pipeline');
  return data.data;
}

export async function fetchSupplierDashboard(period: Period = '30d'): Promise<SupplierDashboardSummary> {
  const { data } = await apiClient.get<{ data: SupplierDashboardSummary }>('/dashboard/supplier/summary', {
    params: { period },
  });
  return data.data;
}

export async function fetchLegalDashboard(): Promise<LegalDashboardSummary> {
  const { data } = await apiClient.get<{ data: LegalDashboardSummary }>('/dashboard/legal/summary');
  return data.data;
}

export async function fetchRiskDistribution(period: Period = '30d'): Promise<RiskDistributionItem[]> {
  const { data } = await apiClient.get<{ data: RiskDistributionItem[] }>('/dashboard/risk-distribution', {
    params: { period },
  });
  return data.data;
}
