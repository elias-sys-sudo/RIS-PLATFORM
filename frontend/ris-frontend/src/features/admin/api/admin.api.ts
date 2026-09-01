import { apiClient } from '@/lib/axios';
import type {
  PaginatedAdminUsers, AdminUser, CreateUserRequest, CreateUserResponse,
  UpdateUserRequest, RiskConfigEntry, UpdateRiskConfigRequest,
} from '@/types/admin.types';

export async function fetchUsers(page = 1): Promise<PaginatedAdminUsers> {
  const { data } = await apiClient.get<PaginatedAdminUsers>('/admin/users', { params: { page } });
  return data;
}
export async function createUser(req: CreateUserRequest): Promise<CreateUserResponse> {
  const { data } = await apiClient.post<CreateUserResponse>('/admin/users', req);
  return data;
}
export async function updateUser(id: string, req: UpdateUserRequest): Promise<AdminUser> {
  const { data } = await apiClient.patch<AdminUser>(`/admin/users/${id}`, req);
  return data;
}
export async function fetchRiskConfig(): Promise<RiskConfigEntry[]> {
  const { data } = await apiClient.get<RiskConfigEntry[]>('/admin/risk-config');
  return data;
}
export async function updateRiskConfig(req: UpdateRiskConfigRequest): Promise<void> {
  const { key, ...body } = req;
  await apiClient.put(`/admin/risk-config/${encodeURIComponent(key)}`, body);
}
