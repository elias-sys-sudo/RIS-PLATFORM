// =============================================================================
// Documents — Repository (all SQL lives here, parameterised queries only)
// =============================================================================

import type { PoolClient } from 'pg';
import { query, pool } from '../../shared/database/pool';
import type {
  DocumentRecord,
  DocumentCommentRecord,
  ExpiringDocumentRecord,
} from './documents.types';

// ---------------------------------------------------------------------------
// Document queries
// ---------------------------------------------------------------------------

/**
 * Fetch a document record by ID.
 */
export async function getDocumentById(documentId: string): Promise<DocumentRecord | null> {
  const result = await query<DocumentRecord>(
    `SELECT id, invoice_id, supplier_id, document_type,
            encrypted_path, file_hash, file_size_bytes,
            mime_type, uploaded_by, created_at
     FROM invoice_documents
     WHERE id = $1`,
    [documentId],
  );
  return result.rows[0] ?? null;
}

/**
 * Validate document belongs to user's organisation.
 * Returns true if user has access (staff roles or supplier owns the doc).
 */
export async function validateDocumentAccess(
  documentId: string,
  userId: string,
  role: string,
): Promise<boolean> {
  if (role !== 'supplier') {
    return true; // Staff roles have access to all documents
  }

  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM invoice_documents d
       JOIN suppliers s ON s.id = d.supplier_id
       WHERE d.id = $1 AND s.user_id = $2
     ) AS exists`,
    [documentId, userId],
  );
  return result.rows[0]?.exists ?? false;
}

/**
 * Count downloads by user in the last hour (rate limiting).
 */
export async function countRecentDownloads(userId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM audit_logs
     WHERE user_id = $1
       AND action = 'DOCUMENT_DOWNLOADED'
       AND created_at >= NOW() - INTERVAL '1 hour'`,
    [userId],
  );
  return Number(result.rows[0].count);
}

/**
 * Acquire a pool client for transactional operations.
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

// ---------------------------------------------------------------------------
// Document comment queries
// ---------------------------------------------------------------------------

/**
 * Insert a new document comment (within transaction).
 */
export async function createCommentWithClient(
  client: PoolClient,
  data: {
    id: string;
    documentId: string;
    supplierId: string;
    authorId: string;
    authorRole: string;
    commentText: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO document_comments
       (id, document_id, supplier_id, author_id, author_role, comment_text)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [data.id, data.documentId, data.supplierId, data.authorId, data.authorRole, data.commentText],
  );
}

/**
 * Write audit log entry within a transaction.
 */
export async function createAuditEntryWithClient(
  client: PoolClient,
  userId: string | null,
  action: string,
  tableName: string,
  recordId: string,
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown>,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id,
        old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      action,
      tableName,
      recordId,
      oldValues !== null ? JSON.stringify(oldValues) : null,
      JSON.stringify(newValues),
      ipAddress ?? null,
      userAgent ?? null,
    ],
  );
}

/**
 * Fetch all comments for a document (sorted oldest-first).
 */
export async function getCommentsByDocumentId(
  documentId: string,
): Promise<DocumentCommentRecord[]> {
  const result = await query<DocumentCommentRecord>(
    `SELECT id, document_id, supplier_id, author_id, author_role, comment_text, created_at
     FROM document_comments
     WHERE document_id = $1
     ORDER BY created_at ASC`,
    [documentId],
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Document expiry queries
// ---------------------------------------------------------------------------

/**
 * Fetch documents expiring within the given number of days
 * where a warning has not yet been sent.
 */
export async function getDocumentsNearExpiry(
  daysThreshold: number,
): Promise<ExpiringDocumentRecord[]> {
  const result = await query<ExpiringDocumentRecord>(
    `SELECT id, supplier_id, document_type, expiry_date::text AS expiry_date
     FROM invoice_documents
     WHERE expiry_date IS NOT NULL
       AND expiry_date < NOW() + ($1 || ' days')::INTERVAL
       AND expiry_warning_sent = false`,
    [daysThreshold],
  );
  return result.rows;
}

/**
 * Mark a document's expiry warning as sent.
 */
export async function markExpiryWarningSent(docId: string): Promise<void> {
  await query(`UPDATE invoice_documents SET expiry_warning_sent = true WHERE id = $1`, [docId]);
}

/**
 * Log document download in audit trail.
 */
export async function logDownload(
  userId: string,
  documentId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id,
        old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      'DOCUMENT_DOWNLOADED',
      'invoice_documents',
      documentId,
      null,
      JSON.stringify({ timestamp: new Date().toISOString() }),
      ipAddress,
      userAgent,
    ],
  );
}
