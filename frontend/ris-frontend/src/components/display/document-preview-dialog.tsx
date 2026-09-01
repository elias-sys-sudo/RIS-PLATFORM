/**
 * Shared document-preview dialog — single consistent preview used across the
 * app (KYC review, KYC upload supplier view, invoice documents, and any new
 * feature that previews a document).
 *
 * The actual implementation lives in `features/kyc/components/` because it
 * was born there. This re-export gives non-KYC features a stable import path
 * under `@/components/display/` without a cross-feature reach.
 */
export { DocumentPreviewDialog } from '@/features/kyc/components/document-preview-dialog';
