import { apiClient } from '@/lib/axios';
import type {
  PaginatedCollections,
  CollectionDetail,
  CollectionFilters,
  CollectionMutationResponse,
  RecordPaymentPayload,
  EscalatePayload,
  DeescalatePayload,
} from '@/types/collection.types';

export async function fetchCollections(filters: CollectionFilters = {}): Promise<PaginatedCollections> {
  const { data } = await apiClient.get<PaginatedCollections>('/collections', { params: filters });
  return data;
}

export async function fetchCollectionById(id: string): Promise<CollectionDetail> {
  const { data } = await apiClient.get<{ data: CollectionDetail }>(`/collections/${id}`);
  return data.data;
}

export async function recordCollectionPayment(
  id: string,
  payload: RecordPaymentPayload,
): Promise<CollectionMutationResponse> {
  const { data } = await apiClient.post<CollectionMutationResponse>(
    `/collections/${id}/payments`,
    payload,
  );
  return data;
}

export async function escalateCollection(
  id: string,
  payload: EscalatePayload,
): Promise<CollectionMutationResponse> {
  const { data } = await apiClient.post<CollectionMutationResponse>(
    `/collections/${id}/escalate`,
    payload,
  );
  return data;
}

export async function deescalateCollection(
  id: string,
  payload: DeescalatePayload,
): Promise<CollectionMutationResponse> {
  const { data } = await apiClient.post<CollectionMutationResponse>(
    `/collections/${id}/de-escalate`,
    payload,
  );
  return data;
}

export async function resolveCollection(id: string): Promise<CollectionMutationResponse> {
  const { data } = await apiClient.post<CollectionMutationResponse>(
    `/collections/${id}/resolve`,
  );
  return data;
}

// -------------------------------------------------------------------------
// Escalation Documents
// -------------------------------------------------------------------------

export interface EscalationDocumentSummary {
  id: string;
  documentType: 'demand_letter' | 'legal_notice' | 'reminder_letter';
  status: 'draft' | 'finalized' | 'sent';
  draftParams: { deadlineDays: number; additionalNotes: string };
  generatedBy: string;
  finalizedBy: string | null;
  sentAt: string | null;
  createdAt: string;
}

export async function fetchCollectionDocuments(
  collectionId: string,
): Promise<EscalationDocumentSummary[]> {
  const { data } = await apiClient.get<{ data: EscalationDocumentSummary[] }>(
    `/collections/${collectionId}/documents`,
  );
  return data.data;
}

export async function generateDocumentDraft(
  collectionId: string,
  documentType: string,
): Promise<{ documentId: string; message: string }> {
  const { data } = await apiClient.post<{ documentId: string; message: string }>(
    `/collections/${collectionId}/documents/draft`,
    { documentType },
  );
  return data;
}

export async function downloadDocument(
  collectionId: string,
  docId: string,
): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(
    `/collections/${collectionId}/documents/${docId}`,
    { responseType: 'blob' },
  );
  return data;
}

export async function updateDocumentDraft(
  collectionId: string,
  docId: string,
  params: { deadlineDays?: number; additionalNotes?: string },
): Promise<{ message: string }> {
  const { data } = await apiClient.patch<{ message: string }>(
    `/collections/${collectionId}/documents/${docId}`,
    params,
  );
  return data;
}

export async function sendDocument(
  collectionId: string,
  docId: string,
): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(
    `/collections/${collectionId}/documents/${docId}/send`,
  );
  return data;
}
