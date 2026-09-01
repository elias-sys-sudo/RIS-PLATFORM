import { apiClient } from '@/lib/axios';
import type { LoginResponse } from '@/types/auth.types';

export async function loginApi(email: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

export async function verify2fa(code: string, partialAuthToken: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/2fa/verify', {
    code,
    partialAuthToken,
  });
  return data;
}

export async function forgotPassword(email: string): Promise<void> {
  await apiClient.post('/auth/forgot-password', { email });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await apiClient.post('/auth/reset-password', { token, new_password: newPassword });
}

export async function verifyEmail(token: string): Promise<void> {
  await apiClient.post('/auth/verify-email', { token });
}

export async function resendVerificationEmail(email: string): Promise<void> {
  await apiClient.post('/auth/resend-verification', { email });
}

/**
 * Re-verify TOTP before a sensitive action (step-up authentication).
 * The caller must already hold a valid access token.
 * Returns when verification succeeds; throws on invalid code.
 */
export async function stepUpVerify(code: string): Promise<void> {
  await apiClient.post('/auth/step-up', { code });
}
