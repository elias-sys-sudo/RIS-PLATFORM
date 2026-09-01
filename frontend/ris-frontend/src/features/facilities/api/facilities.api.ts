import { apiClient } from '@/lib/axios';
import type { FacilitiesResponse, FacilityDetail } from '@/types/facility.types';

// /reports/facilities is wrapped twice by the backend:
//   { data: { reportType, generatedAt, data: { data: rows[], totalCount } } }
// Unwrap to the inner FacilityReport shape ({ data, totalCount }) which is
// what FacilitiesResponse mirrors.
export async function fetchFacilities(): Promise<FacilitiesResponse> {
  const { data } = await apiClient.get<{
    data: { reportType: string; generatedAt: string; data: FacilitiesResponse };
  }>('/reports/facilities');
  return data.data.data;
}

export async function fetchFacilityById(id: string): Promise<FacilityDetail> {
  const { data } = await apiClient.get<{ data: FacilityDetail }>(`/facilities/${id}`);
  return data.data;
}
