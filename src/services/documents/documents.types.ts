// =============================================================================
// Documents — Types, Interfaces & Enums
// =============================================================================

/** Supported MIME types for document download. */
export const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

/** Error codes for the documents module. */
export enum DocumentErrorCode {
  NOT_FOUND = 'DOCUMENT_NOT_FOUND',
  ACCESS_DENIED = 'DOCUMENT_ACCESS_DENIED',
  COMMENT_TOO_SHORT = 'DOCUMENT_COMMENT_TOO_SHORT',
  COMMENT_TOO_LONG = 'DOCUMENT_COMMENT_TOO_LONG',
}

/** A single comment on a document. */
export interface DocumentCommentRecord {
  id: string;
  document_id: string;
  supplier_id: string;
  author_id: string;
  author_role: string;
  comment_text: string;
  created_at: string;
}

/** Public-facing comment (no PII — author identified by role only). */
export interface DocumentCommentView {
  id: string;
  author_role: string;
  comment_text: string;
  created_at: string;
}

/** Document record from invoice_documents table. */
export interface DocumentRecord {
  id: string;
  invoice_id: string | null;
  supplier_id: string;
  document_type: string;
  encrypted_path: string;
  file_hash: string;
  file_size_bytes: number;
  mime_type: string;
  uploaded_by: string;
  created_at: string;
  expiry_date: string | null;
}

/** A document approaching expiry. */
export interface ExpiringDocumentRecord {
  id: string;
  supplier_id: string;
  document_type: string;
  expiry_date: string;
}
