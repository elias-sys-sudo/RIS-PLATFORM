import { apiClient } from '@/lib/axios';

// ── Types ────────────────────────────────────────────────────────────────────

export type SettlementStatus = 'pending' | 'facility_repaid' | 'profit_booked' | 'closed';

export interface Settlement {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  buyerName: string;
  faceValue: string | number;
  collectedAmount: string | number;
  advanceAmount: string | number;
  discountEarned: string | number;
  penaltyIncome: string | number;
  facilityRepayment: string | number;
  netProfit: string | number;
  status: SettlementStatus;
  collectedAt: string;
  settledAt: string | null;
  createdAt: string;
}

export interface SettlementSummary {
  totalSettlements: number;
  totalNetProfit: string | number;
  totalFacilityRepaid: string | number;
  pendingCount: number;
}

export interface PaginatedSettlements {
  data: Settlement[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: SettlementSummary;
}

export interface SettlementFilters {
  status?: SettlementStatus;
  search?: string;
  page?: number;
  page_size?: number;
}

// ── API functions ────────────────────────────────────────────────────────────

export async function fetchSettlements(
  filters: SettlementFilters = {},
): Promise<PaginatedSettlements> {
  const { data } = await apiClient.get<PaginatedSettlements>(
    '/settlements',
    { params: filters },
  );
  return data;
}

export async function fetchSettlementById(id: string): Promise<Settlement> {
  const { data } = await apiClient.get<{ data: Settlement }>(`/settlements/${id}`);
  return data.data;
}

export async function repayFacility(
  id: string,
  facilityRepaymentAmount: string,
  accruedInterest: string,
): Promise<Settlement> {
  const { data } = await apiClient.post<{ data: Settlement }>(`/settlements/${id}/repay-facility`, {
    facilityRepaymentAmount,  // deepSnakeCase interceptor → facility_repayment_amount
    accruedInterest,          // deepSnakeCase interceptor → accrued_interest
  });
  return data.data;
}

export async function bookProfit(
  id: string,
  discountEarned: string,
  bankCostPaid: string,
): Promise<Settlement> {
  const { data } = await apiClient.post<{ data: Settlement }>(`/settlements/${id}/book-profit`, {
    discountEarned,  // deepSnakeCase interceptor → discount_earned
    bankCostPaid,    // deepSnakeCase interceptor → bank_cost_paid
  });
  return data.data;
}

export async function closeSettlement(id: string): Promise<Settlement> {
  const { data } = await apiClient.post<{ data: Settlement }>(`/settlements/${id}/close`);
  return data.data;
}
