import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/parse-api-error';
import {
  fetchKycStatus,
  uploadKycDocument,
  reviewKycDocument,
  fetchKycDocumentFile,
  type KycDocumentType,
  type KycReviewPayload,
} from '../api/kyc.api';

// ── Query keys ──────────────────────────────────────────────────────────────

const kycKeys = {
  status: (supplierId: string) => ['kyc', supplierId] as const,
  documentFile: (supplierId: string, documentId: string) =>
    ['kyc-document-file', supplierId, documentId] as const,
};

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useKycStatus(supplierId: string) {
  return useQuery({
    queryKey: kycKeys.status(supplierId),
    queryFn: () => fetchKycStatus(supplierId),
    enabled: !!supplierId,
    staleTime: 30 * 1000,
  });
}

export function useUploadKycDocument(supplierId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, file }: { type: KycDocumentType; file: File }) =>
      uploadKycDocument(supplierId, type, file),
    onSuccess: () => {
      toast.success('Document uploaded successfully');
      void qc.invalidateQueries({ queryKey: kycKeys.status(supplierId) });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}

/**
 * Fetch the decrypted bytes of a single KYC document. Cached for 5 minutes
 * so the preview dialog can reopen without a re-fetch, but never persisted
 * to localStorage (Blob isn't serialisable, and these are PII anyway).
 *
 * Pass `enabled: false` from the caller while the dialog is closed; the
 * hook is keyed on (supplierId, documentId) so opening a different doc
 * triggers a fresh request automatically.
 */
export function useKycDocumentFile(
  supplierId: string,
  documentId: string,
  options: { enabled?: boolean } = {},
) {
  const enabled = (options.enabled ?? true) && !!supplierId && !!documentId;
  return useQuery({
    queryKey: kycKeys.documentFile(supplierId, documentId),
    queryFn: () => fetchKycDocumentFile(supplierId, documentId),
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useReviewKycDocument(supplierId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: KycReviewPayload) =>
      reviewKycDocument(supplierId, payload),
    onSuccess: (_data, variables) => {
      const action = variables.decision === 'approved' ? 'approved' : 'rejected';
      toast.success(`Document ${action} successfully`);
      void qc.invalidateQueries({ queryKey: kycKeys.status(supplierId) });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });
}
