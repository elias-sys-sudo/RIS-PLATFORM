/**
 * Supplier feedback API — Checkers §5b.
 * Staff sends free-text feedback to a supplier outside of approve/reject.
 * Backend: src/services/onboarding/onboarding.routes.ts
 */
import { apiClient } from '@/lib/axios';

export async function sendSupplierFeedback(
  supplierId: string,
  message: string,
): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(
    `/admin/suppliers/${supplierId}/feedback`,
    { message },
  );
  return data;
}
