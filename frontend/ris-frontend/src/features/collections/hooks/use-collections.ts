import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CollectionFilters, RecordPaymentPayload, EscalatePayload } from '@/types/collection.types';
import {
  fetchCollections,
  fetchCollectionById,
  recordCollectionPayment,
  escalateCollection,
  deescalateCollection,
  resolveCollection,
  fetchCollectionDocuments,
  generateDocumentDraft,
  updateDocumentDraft,
  sendDocument,
} from '../api/collections.api';
import { parseApiError } from '@/lib/parse-api-error';

export function useCollections(filters: CollectionFilters = {}) {
  return useQuery({
    queryKey: ['collections', filters],
    queryFn: () => fetchCollections(filters),
    staleTime: 30 * 1000,
  });
}

export function useCollectionDetail(id: string) {
  return useQuery({
    queryKey: ['collections', id],
    queryFn: () => fetchCollectionById(id),
    enabled: !!id,
  });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: RecordPaymentPayload }) =>
      recordCollectionPayment(id, payload),
    onSuccess: () => {
      toast.success('Payment recorded');
      void qc.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useEscalate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: EscalatePayload }) =>
      escalateCollection(id, payload),
    onSuccess: () => {
      toast.success('Collection escalated');
      void qc.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useDeescalate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      deescalateCollection(id, { reason }),
    onSuccess: () => {
      toast.success('Collection de-escalated');
      void qc.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useResolveCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resolveCollection(id),
    onSuccess: () => {
      toast.success('Collection resolved');
      void qc.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

// -------------------------------------------------------------------------
// Escalation Documents
// -------------------------------------------------------------------------

export function useCollectionDocuments(collectionId: string) {
  return useQuery({
    queryKey: ['collections', collectionId, 'documents'],
    queryFn: () => fetchCollectionDocuments(collectionId),
    enabled: !!collectionId,
  });
}

export function useGenerateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, documentType }: { collectionId: string; documentType: string }) =>
      generateDocumentDraft(collectionId, documentType),
    onSuccess: (_data, vars) => {
      toast.success('Draft document generated');
      void qc.invalidateQueries({ queryKey: ['collections', vars.collectionId, 'documents'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, docId, params }: {
      collectionId: string;
      docId: string;
      params: { deadlineDays?: number; additionalNotes?: string };
    }) => updateDocumentDraft(collectionId, docId, params),
    onSuccess: (_data, vars) => {
      toast.success('Draft updated');
      void qc.invalidateQueries({ queryKey: ['collections', vars.collectionId, 'documents'] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

export function useSendDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, docId }: { collectionId: string; docId: string }) =>
      sendDocument(collectionId, docId),
    onSuccess: (_data, vars) => {
      toast.success('Document sent to buyer');
      void qc.invalidateQueries({ queryKey: ['collections', vars.collectionId, 'documents'] });
      void qc.invalidateQueries({ queryKey: ['collections', vars.collectionId] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}
