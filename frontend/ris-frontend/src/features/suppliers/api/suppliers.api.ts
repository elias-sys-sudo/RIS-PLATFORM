import { apiClient } from '@/lib/axios';
import type { PaginatedSuppliers, SupplierDetail, SupplierFilters } from '@/types/supplier.types';

export async function fetchSuppliers(filters: SupplierFilters = {}): Promise<PaginatedSuppliers> {
  const { data } = await apiClient.get<PaginatedSuppliers>('/suppliers', { params: filters });
  return data;
}

/**
 * The mock/backend returns the detail wrapped — `{ supplier, invoiceStatusBreakdown, activeCollections }`.
 * Unwrap to the flat supplier record so the detail page's field reads work.
 * Falls back to the top-level data for any caller that already returns flat.
 */
interface SupplierDetailResponse {
  supplier?: SupplierDetail;
}

export async function fetchSupplierById(id: string): Promise<SupplierDetail> {
  const { data } = await apiClient.get<SupplierDetail & SupplierDetailResponse>(
    `/suppliers/${id}`,
  );
  return data.supplier ?? (data as SupplierDetail);
}
