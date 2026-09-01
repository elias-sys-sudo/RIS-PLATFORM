import { apiClient } from '@/lib/axios';
import type {
  BuyerOnboardingRequest,
  BuyerRequestListResponse,
  CreateBuyerRequestPayload,
  ReviewBuyerRequestPayload,
  BuyerRequestStatus,
} from '@/types/buyer-request.types';

/** Supplier creates a new buyer onboarding request. */
export async function createBuyerRequest(
  payload: CreateBuyerRequestPayload,
): Promise<BuyerOnboardingRequest> {
  const { data } = await apiClient.post<{ data: BuyerOnboardingRequest }>(
    '/onboarding/buyer-requests',
    payload,
  );
  return data.data;
}

/** Supplier fetches their own buyer requests. */
export async function fetchMyBuyerRequests(): Promise<BuyerRequestListResponse> {
  const { data } = await apiClient.get<BuyerRequestListResponse>(
    '/onboarding/buyer-requests/mine',
  );
  return data;
}

/** Credit officer / management fetches all buyer requests, optionally filtered by status. */
export async function fetchBuyerRequests(
  status?: BuyerRequestStatus,
): Promise<BuyerRequestListResponse> {
  const params = status ? { status } : undefined;
  const { data } = await apiClient.get<BuyerRequestListResponse>(
    '/onboarding/admin/buyer-requests',
    { params },
  );
  return data;
}

/** Credit officer reviews (approves/rejects) a buyer request. */
export async function reviewBuyerRequest(
  id: string,
  payload: ReviewBuyerRequestPayload,
): Promise<BuyerOnboardingRequest> {
  // Backend wraps response as { data: ... }. Real backend currently returns
  // { data: { success: true } } only — the full BuyerOnboardingRequest typing
  // here is aspirational and matches MSW mock; real BE contract is narrower.
  const { data } = await apiClient.put<{ data: BuyerOnboardingRequest }>(
    `/onboarding/admin/buyer-requests/${id}`,
    payload,
  );
  return data.data;
}
