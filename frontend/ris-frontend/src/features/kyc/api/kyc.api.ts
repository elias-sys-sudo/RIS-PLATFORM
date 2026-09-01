import { apiClient } from '@/lib/axios';

// ── Types ───────────────────────────────────────────────────────────────────

export type KycDocumentType =
  | 'certificate_of_incorporation'
  | 'directors_shareholders'
  | 'tax_registration'
  | 'bank_account_details'
  | 'supplier_agreement'
  | 'board_resolution'
  | 'id_document'
  | 'additional';

export type KycDocStatus = 'pending' | 'approved' | 'rejected';

export type KycOverallStatus = 'pending' | 'in_progress' | 'approved' | 'rejected';

export interface KycDocument {
  id: string;
  type: KycDocumentType;
  fileName: string;
  uploadedAt: string;
  status: KycDocStatus;
  reviewerComments: string | null;
}

export interface KycStatus {
  supplierId: string;
  overallStatus: KycOverallStatus;
  documents: KycDocument[];
}

export interface KycReviewPayload {
  documentId: string;
  decision: 'approved' | 'rejected';
  comments: string;
}

// ── API functions ───────────────────────────────────────────────────────────

export async function fetchKycStatus(supplierId: string): Promise<KycStatus> {
  const { data } = await apiClient.get<KycStatus>(`/onboarding/suppliers/${supplierId}/kyc`);
  return data;
}

export async function uploadKycDocument(
  supplierId: string,
  type: KycDocumentType,
  file: File,
): Promise<KycDocument> {
  const formData = new FormData();
  formData.append('file', file);
  // Backend Joi schema (onboarding.routes.ts documentBodySchema) expects
  // the field name 'document_type', not 'type'.
  formData.append('document_type', type);
  const { data } = await apiClient.post<KycDocument>(
    `/onboarding/suppliers/${supplierId}/documents`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function reviewKycDocument(
  supplierId: string,
  payload: KycReviewPayload,
): Promise<void> {
  // Backend route: PUT /onboarding/admin/suppliers/:id/documents/:docId/review
  // Body: { decision: 'approved' | 'rejected', comments: string }
  await apiClient.put(
    `/onboarding/admin/suppliers/${supplierId}/documents/${payload.documentId}/review`,
    { decision: payload.decision, comments: payload.comments },
  );
}

/**
 * Fetch the decrypted bytes of a single uploaded KYC document for preview.
 * Returns the path itself (relative to /api) so callers can also build a
 * direct anchor link for the "Download original" button without re-fetching.
 *
 * The backend route is auth-gated and never returns the file to suppliers
 * who don't own it; admin/auditor roles may fetch any. The Blob carries the
 * MIME type set by the server, which we use to pick the right renderer
 * (iframe for PDFs, <img> for images).
 */
export function buildKycDocumentFileUrl(supplierId: string, documentId: string): string {
  return `/onboarding/suppliers/${supplierId}/documents/${documentId}/file`;
}

export async function fetchKycDocumentFile(
  supplierId: string,
  documentId: string,
): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(
    buildKycDocumentFileUrl(supplierId, documentId),
    { responseType: 'blob' },
  );
  return data;
}
