import { apiClient } from '@/lib/axios';
import type { BuyerListResponse, Buyer } from '@/types/buyer.types';

export async function fetchBuyers(): Promise<BuyerListResponse> {
  const { data } = await apiClient.get<BuyerListResponse>('/buyers');
  return data;
}

export async function fetchBuyerById(id: string): Promise<Buyer> {
  const { data } = await apiClient.get<BuyerListResponse>('/buyers');
  const buyer = data.data.find((b) => b.id === id);
  if (!buyer) throw new Error(`Buyer ${id} not found`);
  return buyer;
}

export interface CreateBuyerPayload {
  name: string;
  industry: string;
  credit_limit: number;
  payment_terms_days: number;
  contact_person: string;
  contact_email: string;
  contact_phone: string;
}

export interface UpdateBuyerPayload {
  industry?: string;
  credit_limit?: number;
  payment_terms_days?: number;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
}

export async function createBuyer(payload: CreateBuyerPayload): Promise<Buyer> {
  const { data } = await apiClient.post<Buyer>('/buyers', payload);
  return data;
}

export async function updateBuyer(id: string, payload: UpdateBuyerPayload): Promise<Buyer> {
  const { data } = await apiClient.patch<Buyer>(`/buyers/${id}`, payload);
  return data;
}
