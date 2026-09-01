import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchUsers, createUser, updateUser, fetchRiskConfig, updateRiskConfig } from '../api/admin.api';
import { parseApiError } from '@/lib/parse-api-error';
import type { CreateUserRequest, UpdateUserRequest, UpdateRiskConfigRequest } from '@/types/admin.types';

export function useAdminUsers(page = 1) {
  return useQuery({ queryKey: ['admin', 'users', page], queryFn: () => fetchUsers(page), staleTime: 60 * 1000 });
}
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateUserRequest) => createUser(req),
    onSuccess: (data) => { toast.success(`User created. Temp password: ${data.temporaryPassword}`); void qc.invalidateQueries({ queryKey: ['admin', 'users'] }); },
    onError: (e) => toast.error(parseApiError(e)),
  });
}
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateUserRequest }) => updateUser(id, req),
    onSuccess: () => { toast.success('User updated'); void qc.invalidateQueries({ queryKey: ['admin', 'users'] }); },
    onError: (e) => toast.error(parseApiError(e)),
  });
}
export function useRiskConfig() {
  return useQuery({ queryKey: ['admin', 'risk-config'], queryFn: fetchRiskConfig, staleTime: 5 * 60 * 1000 });
}
export function useUpdateRiskConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: UpdateRiskConfigRequest) => updateRiskConfig(req),
    onSuccess: () => { toast.success('Config updated'); void qc.invalidateQueries({ queryKey: ['admin', 'risk-config'] }); },
    onError: (e) => toast.error(parseApiError(e)),
  });
}
