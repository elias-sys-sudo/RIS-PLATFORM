// ── Buyer Onboarding Request ────────────────────────────────────────────────

export type BuyerRequestStatus = 'pending' | 'in_review' | 'approved' | 'rejected';

export interface BuyerOnboardingRequest {
  id: string;
  supplierId: string;
  companyName: string;
  registrationNumber: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  reason: string;
  status: BuyerRequestStatus;
  reviewedBy: string | null;
  reviewerComments: string | null;
  linkedBuyerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuyerRequestListResponse {
  data: BuyerOnboardingRequest[];
  total: number;
}

export interface CreateBuyerRequestPayload {
  company_name: string;
  registration_number?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  reason: string;
}

export interface ReviewBuyerRequestPayload {
  status: 'approved' | 'rejected';
  reviewer_comments?: string;
  linked_buyer_id?: string;
}
