// =============================================================================
// Documents — Service (business logic, access control, audit logging)
// =============================================================================

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Queue } from 'bullmq';
import { logger } from '../../shared/logger';
import { enqueueWithContext } from '../../shared/workers/queue-helpers';
import { decrypt } from '../../shared/crypto';
import { NotFoundError, ForbiddenError, BusinessRuleError } from '../../shared/errors';
import { beginWithRls } from '../../shared/database/pool';
import * as repo from './documents.repository';
import { ALLOWED_MIME_TYPES } from './documents.types';
import type {
  DocumentRecord,
  DocumentCommentView,
  ExpiringDocumentRecord,
} from './documents.types';

// =========================================================================
// Queue reference
// =========================================================================

let notificationQueue: Queue | null = null;

/** Set the BullMQ notification queue (called at startup). */
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

const MAX_DOWNLOADS_PER_HOUR = 100;

// ---------------------------------------------------------------------------
// Download document
// ---------------------------------------------------------------------------

/**
 * Validate access and return document metadata + decrypted file path.
 * Does NOT load file into memory — caller should stream it.
 */
export async function getDocumentForDownload(
  documentId: string,
  userId: string,
  role: string,
  ipAddress: string,
  userAgent: string,
): Promise<{ doc: DocumentRecord; filePath: string }> {
  const doc = await repo.getDocumentById(documentId);
  if (!doc) {
    throw new NotFoundError('Document', documentId);
  }

  const hasAccess = await repo.validateDocumentAccess(documentId, userId, role);
  if (!hasAccess) {
    throw new ForbiddenError('Access denied to this document');
  }

  if (!ALLOWED_MIME_TYPES[doc.mime_type]) {
    throw new BusinessRuleError(
      'UNSUPPORTED_DOCUMENT_TYPE',
      `Document type '${doc.mime_type}' is not supported for download`,
    );
  }

  const downloadCount = await repo.countRecentDownloads(userId);
  if (downloadCount >= MAX_DOWNLOADS_PER_HOUR) {
    throw new BusinessRuleError(
      'RATE_LIMIT_EXCEEDED',
      'Download rate limit exceeded (100 per hour)',
    );
  }

  const filePath = decrypt(doc.encrypted_path);

  await repo.logDownload(userId, documentId, ipAddress, userAgent);

  logger.info('Document download initiated', {
    component: 'documents',
    documentId,
    userId,
  });

  return { doc, filePath };
}

// ---------------------------------------------------------------------------
// Document comments
// ---------------------------------------------------------------------------

/**
 * Add a comment to a document. Staff can comment on any document belonging
 * to a supplier; suppliers can only comment on their own documents.
 * Queues an email notification to the document owner when staff comments.
 */
export async function addDocumentComment(
  documentId: string,
  commentText: string,
  authorId: string,
  authorRole: string,
  ipAddress: string,
  userAgent: string,
): Promise<{ commentId: string }> {
  const doc = await repo.getDocumentById(documentId);
  if (!doc) {
    throw new NotFoundError('Document', documentId);
  }

  const hasAccess = await repo.validateDocumentAccess(documentId, authorId, authorRole);
  if (!hasAccess) {
    throw new ForbiddenError('Access denied to this document');
  }

  const commentId = uuidv4();

  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await repo.createCommentWithClient(client, {
      id: commentId,
      documentId,
      supplierId: doc.supplier_id,
      authorId,
      authorRole,
      commentText,
    });
    await repo.createAuditEntryWithClient(
      client,
      authorId,
      'DOCUMENT_COMMENT_ADDED',
      'document_comments',
      commentId,
      null,
      { documentId, documentType: doc.document_type, authorRole },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (authorRole !== 'supplier' && notificationQueue !== null) {
    await enqueueWithContext(
      notificationQueue,
      'document_comment_added',
      {
        supplierId: doc.supplier_id,
        documentType: doc.document_type,
        commentSnippet: commentText.substring(0, 100),
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
    );
  }

  logger.audit('DOCUMENT_COMMENT_ADDED', {
    component: 'documents',
    documentId,
    commentId,
    authorRole,
  });

  return { commentId };
}

/**
 * List comments for a document. Returns role + text only (no author PII).
 */
export async function listDocumentComments(
  documentId: string,
  userId: string,
  role: string,
): Promise<DocumentCommentView[]> {
  const doc = await repo.getDocumentById(documentId);
  if (!doc) {
    throw new NotFoundError('Document', documentId);
  }

  const hasAccess = await repo.validateDocumentAccess(documentId, userId, role);
  if (!hasAccess) {
    throw new ForbiddenError('Access denied to this document');
  }

  const rows = await repo.getCommentsByDocumentId(documentId);
  return rows.map((r) => ({
    id: r.id,
    author_role: r.author_role,
    comment_text: r.comment_text,
    created_at: r.created_at,
  }));
}

/**
 * Create a readable stream for the document file.
 * Returns null if file does not exist.
 */
export function createFileStream(filePath: string): fs.ReadStream | null {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return null;
  }
  return fs.createReadStream(resolved);
}

// ---------------------------------------------------------------------------
// Document expiry checking
// ---------------------------------------------------------------------------

const EXPIRY_WARNING_DAYS = 30;

/**
 * Check for documents nearing expiry and queue notifications.
 * Intended to be called by a scheduled job.
 */
export async function checkDocumentExpiry(): Promise<ExpiringDocumentRecord[]> {
  const expiring = await repo.getDocumentsNearExpiry(EXPIRY_WARNING_DAYS);

  for (const doc of expiring) {
    await queueExpiryNotification(doc);
    await repo.markExpiryWarningSent(doc.id);
  }

  if (expiring.length > 0) {
    logger.audit('DOCUMENT_EXPIRY_CHECK', {
      component: 'documents',
      expiringCount: expiring.length,
    });
  }

  return expiring;
}

/**
 * Queue a notification for a document nearing expiry.
 */
async function queueExpiryNotification(doc: ExpiringDocumentRecord): Promise<void> {
  if (notificationQueue === null) {
    logger.warn('Notification queue not configured for document expiry', {
      component: 'documents',
      documentId: doc.id,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'document_expiry_warning',
    {
      supplierId: doc.supplier_id,
      documentId: doc.id,
      documentType: doc.document_type,
      expiryDate: doc.expiry_date,
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}
