import { apiClient } from '@/lib/axios';

export interface TwoFactorSetupResponse {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

export async function setup2fa(): Promise<TwoFactorSetupResponse> {
  const { data } = await apiClient.post<TwoFactorSetupResponse>('/auth/2fa/setup');
  return data;
}

export async function confirm2fa(code: string): Promise<void> {
  await apiClient.post('/auth/2fa/confirm', { code });
}
