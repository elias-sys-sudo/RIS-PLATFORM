import { useQuery } from '@tanstack/react-query';
import { fetchFacilities, fetchFacilityById } from '../api/facilities.api';

export function useFacilities() {
  return useQuery({ queryKey: ['facilities'], queryFn: fetchFacilities, staleTime: 5 * 60 * 1000 });
}

export function useFacilityDetail(id: string) {
  return useQuery({ queryKey: ['facilities', id], queryFn: () => fetchFacilityById(id), enabled: !!id, staleTime: 60 * 1000 });
}
