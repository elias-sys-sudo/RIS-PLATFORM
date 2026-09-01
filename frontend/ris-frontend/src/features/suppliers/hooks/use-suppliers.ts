import { useQuery } from '@tanstack/react-query';
import type { SupplierFilters } from '@/types/supplier.types';
import { fetchSuppliers, fetchSupplierById } from '../api/suppliers.api';

export function useSuppliers(filters: SupplierFilters = {}) {
  return useQuery({ queryKey: ['suppliers', filters], queryFn: () => fetchSuppliers(filters), staleTime: 60 * 1000 });
}

export function useSupplierDetail(id: string) {
  return useQuery({ queryKey: ['suppliers', id], queryFn: () => fetchSupplierById(id), enabled: !!id, staleTime: 60 * 1000 });
}
