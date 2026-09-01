import { query } from '../../shared/database/pool';
import type { PoolClient } from 'pg';
import type {
  ApprovalRecord,
  InvoiceForApproval,
  RiskScoreForApproval,
  ApprovalQueueItem,
  SlaBreachInvoice,
  InfoRequestRow,
} from './approvals.types';

// =========================================================================
// Create approval input
// =========================================================================

export interface CreateApprovalInput {
  id: string;
  invoiceId: string;
  tier: string;
  decision: string;
  approverId: string;
  comments: string;
  creditMemo?: string | null;
  /** G10 — structured case-summary writeup required for TIER_2/TIER_3/TIER_4. */
  reviewSummary?: string | null;
}

// =========================================================================
// Approval CRUD
// =========================================================================

/**
 * Insert an approval record (non-transactional, e.g. for reads).
 */
export async function createApproval(data: CreateApprovalInput): Promise<void> {
  await query(
    `INSERT INTO approvals
       (id, invoice_id, tier, decision, approver_id, comments, credit_memo, review_summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.id,
      data.invoiceId,
      data.tier,
      data.decision,
      data.approverId,
      data.comments,
      data.creditMemo ?? null,
      data.reviewSummary ?? null,
    ],
  );
}

/**
 * Insert an approval record using a transaction client.
 */
export async function createApprovalWithClient(
  client: PoolClient,
  data: CreateApprovalInput,
): Promise<void> {
  await client.query(
    `INSERT INTO approvals
       (id, invoice_id, tier, decision, approver_id, comments, credit_memo, review_summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.id,
      data.invoiceId,
      data.tier,
      data.decision,
      data.approverId,
      data.comments,
      data.creditMemo ?? null,
      data.reviewSummary ?? null,
    ],
  );
}

// =========================================================================
// Lock invoice for concurrent approval prevention
// =========================================================================

/**
 * Lock invoice row with SELECT FOR UPDATE to prevent concurrent approvals.
 */
export async function lockInvoiceForReview(
  client: PoolClient,
  invoiceId: string,
): Promise<InvoiceForApproval | null> {
  const result = await client.query<InvoiceForApproval>(
    `SELECT id, face_value::text, status, supplier_id,
            buyer_id, aml_flagged
     FROM invoices
     WHERE id = $1
     FOR UPDATE NOWAIT`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Query approvals
// =========================================================================

/**
 * Fetch all approval records for an invoice.
 */
export async function getApprovalsByInvoiceId(invoiceId: string): Promise<ApprovalRecord[]> {
  const result = await query<ApprovalRecord>(
    `SELECT id, invoice_id, tier, decision, approver_id,
            comments, created_at
     FROM approvals
     WHERE invoice_id = $1
     ORDER BY created_at ASC`,
    [invoiceId],
  );
  return result.rows;
}

/**
 * Fetch pending invoices in the approval queue for a credit officer.
 */
export async function getPendingApprovalsByOfficer(
  officerId: string,
): Promise<ApprovalQueueItem[]> {
  const result = await query<ApprovalQueueItem>(
    `SELECT i.id AS invoice_id, i.face_value::text,
            i.supplier_id, i.buyer_id,
            rs.final_score, i.aml_flagged,
            i.status, i.created_at,
            CASE
              WHEN i.face_value > 50000000 OR rs.final_score < 50
                THEN 'TIER_3'
              WHEN i.face_value >= 10000000
                OR (rs.final_score >= 50 AND rs.final_score < 75)
                OR i.aml_flagged = true
                THEN 'TIER_2'
              ELSE 'AUTO'
            END AS tier
     FROM invoices i
     JOIN risk_scores rs ON rs.invoice_id = i.id
     WHERE i.status = 'scored'
       AND NOT EXISTS (
         SELECT 1 FROM approvals a
         WHERE a.invoice_id = i.id
           AND a.approver_id = $1
       )
     ORDER BY i.created_at ASC`,
    [officerId],
  );
  return result.rows;
}

// =========================================================================
// SLA monitoring
// =========================================================================

/**
 * Find invoices that have been pending approval longer than the given hours.
 */
export async function getInvoicesExceedingSLA(hours: number): Promise<SlaBreachInvoice[]> {
  const result = await query<SlaBreachInvoice>(
    `SELECT i.id AS invoice_id, i.face_value::text,
            i.status, i.created_at,
            EXTRACT(EPOCH FROM (NOW() - i.updated_at)) / 3600
              AS hours_pending,
            CASE
              WHEN i.face_value > 50000000 OR rs.final_score < 50
                THEN 'TIER_3'
              WHEN i.face_value >= 10000000
                OR (rs.final_score >= 50 AND rs.final_score < 75)
                OR i.aml_flagged = true
                THEN 'TIER_2'
              ELSE 'AUTO'
            END AS tier
     FROM invoices i
     JOIN risk_scores rs ON rs.invoice_id = i.id
     WHERE i.status = 'scored'
       AND i.updated_at < NOW() - INTERVAL '1 hour' * $1
     ORDER BY i.updated_at ASC`,
    [hours],
  );
  return result.rows;
}

// =========================================================================
// Tier 3 rejection count tracking
// =========================================================================

/**
 * Increment the tier3_rejection_count on an invoice.
 */
export async function incrementTier3RejectionCount(
  client: PoolClient,
  invoiceId: string,
): Promise<number> {
  const result = await client.query<{ tier3_rejection_count: number }>(
    `UPDATE invoices
     SET tier3_rejection_count = COALESCE(tier3_rejection_count, 0) + 1,
         updated_at = NOW()
     WHERE id = $1
     RETURNING tier3_rejection_count`,
    [invoiceId],
  );
  return result.rows[0]?.tier3_rejection_count ?? 1;
}

/**
 * Reset tier3_rejection_count (admin override).
 */
export async function resetTier3RejectionCount(
  client: PoolClient,
  invoiceId: string,
): Promise<void> {
  await client.query(
    `UPDATE invoices
     SET tier3_rejection_count = 0, updated_at = NOW()
     WHERE id = $1`,
    [invoiceId],
  );
}

// =========================================================================
// Invoice & risk score lookups
// =========================================================================

/**
 * Fetch invoice fields needed for approval routing.
 */
export async function getInvoiceForApproval(invoiceId: string): Promise<InvoiceForApproval | null> {
  const result = await query<InvoiceForApproval>(
    `SELECT id, face_value::text, status, supplier_id,
            buyer_id, aml_flagged
     FROM invoices WHERE id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch risk score for approval tier routing.
 */
export async function getRiskScoreForApproval(
  invoiceId: string,
): Promise<RiskScoreForApproval | null> {
  const result = await query<RiskScoreForApproval>(
    `SELECT id, invoice_id, final_score, recommendation
     FROM risk_scores WHERE invoice_id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Invoice status update (transactional)
// =========================================================================

/**
 * Update invoice status using the transaction client.
 */
export async function updateInvoiceStatus(
  client: PoolClient,
  invoiceId: string,
  newStatus: string,
  expectedStatus: string,
): Promise<void> {
  await client.query(
    `UPDATE invoices
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND status = $3`,
    [newStatus, invoiceId, expectedStatus],
  );
}

// =========================================================================
// Audit logging (transactional)
// =========================================================================

/**
 * Insert an immutable audit log entry using the transaction client.
 */
export async function createAuditEntry(
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

// =========================================================================
// Info requests (transactional)
// =========================================================================

/**
 * Insert an approval info request row using the transaction client.
 */
export async function createInfoRequestWithClient(
  client: PoolClient,
  id: string,
  invoiceId: string,
  requestedBy: string,
  message: string,
): Promise<InfoRequestRow> {
  const result = await client.query<InfoRequestRow>(
    `INSERT INTO approval_info_requests (id, invoice_id, requested_by, message)
     VALUES ($1, $2, $3, $4)
     RETURNING id, invoice_id, requested_by, message, created_at`,
    [id, invoiceId, requestedBy, message],
  );
  return result.rows[0];
}
