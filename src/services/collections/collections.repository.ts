import { query } from '../../shared/database/pool';
import type { PoolClient } from 'pg';
import type {
  CollectionRecord,
  InvoiceForCollection,
  InvoiceDueForReminder,
  PenaltyCalculation,
  CreateCollectionInput,
  OverdueInvoiceSummary,
  CollectionListFilters,
  CollectionListRow,
  CollectionSummaryRow,
  CollectionDetailRow,
  PaymentHistoryRow,
  EscalationHistoryRow,
  BuyerContactRow,
  DefaultableCollection,
  FundedOverdueInvoiceRow,
  EscalationCandidateRow,
  EscalationDocumentRow,
} from './collections.types';

// =========================================================================
// Create overdue / collections record (transactional)
// =========================================================================

/**
 * Insert a new collections record for an overdue invoice.
 */
export async function createOverdueRecord(
  client: PoolClient,
  invoiceId: string,
  data: CreateCollectionInput,
): Promise<void> {
  await client.query(
    `INSERT INTO collections
       (id, invoice_id, buyer_id, face_value, amount_due,
        days_overdue, daily_penalty_rate, penalty_amount, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      data.id,
      invoiceId,
      data.buyerId,
      data.faceValue,
      data.amountDue,
      data.daysOverdue,
      data.dailyPenaltyRate,
      data.penaltyAmount,
      'overdue',
    ],
  );
}

/**
 * Insert a pending collection record for a freshly funded invoice.
 * Used by the collection-monitoring worker to mark the invoice as
 * being tracked. Status is 'pending' until the due date elapses.
 */
export async function createPendingCollectionRecord(
  client: PoolClient,
  invoiceId: string,
  data: CreateCollectionInput,
): Promise<void> {
  await client.query(
    `INSERT INTO collections
       (id, invoice_id, buyer_id, face_value, amount_due,
        days_overdue, daily_penalty_rate, penalty_amount, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      data.id,
      invoiceId,
      data.buyerId,
      data.faceValue,
      data.amountDue,
      0,
      data.dailyPenaltyRate,
      '0',
      'pending',
    ],
  );
}

// =========================================================================
// Update collection status (transactional)
// =========================================================================

/**
 * Update the status of a collection record.
 */
export async function updateCollectionStatus(
  client: PoolClient,
  collectionId: string,
  status: string,
): Promise<void> {
  await client.query(
    `UPDATE collections
     SET status = $1, updated_at = NOW()
     WHERE id = $2`,
    [status, collectionId],
  );
}

/**
 * Update escalation level, days_overdue, and recalculated penalty.
 */
export async function updateEscalationLevel(
  client: PoolClient,
  collectionId: string,
  level: number,
  daysOverdue: number,
  penaltyAmount: string,
): Promise<void> {
  await client.query(
    `UPDATE collections
     SET escalation_level = $1,
         days_overdue = $2,
         penalty_amount = $3,
         escalation_date = NOW(),
         demand_notice_sent = CASE WHEN $1 >= 2 THEN true ELSE demand_notice_sent END,
         updated_at = NOW()
     WHERE id = $4`,
    [level, daysOverdue, penaltyAmount, collectionId],
  );
}

/**
 * Reset escalation when collection is fully paid.
 */
export async function resolveCollection(
  client: PoolClient,
  collectionId: string,
  totalCollected: string,
): Promise<void> {
  await client.query(
    `UPDATE collections
     SET status = 'collected',
         escalation_level = 0,
         total_collected = $1,
         last_payment_at = NOW(),
         updated_at = NOW()
     WHERE id = $2`,
    [totalCollected, collectionId],
  );
}

// =========================================================================
// Record payment received (transactional)
// =========================================================================

/**
 * Insert a payment received record against a collection.
 */
export async function recordPaymentReceived(
  client: PoolClient,
  collectionId: string,
  amount: string,
  paymentMethod: string,
  paidBy: string,
  paidAt: string,
  recordedBy: string,
  paymentReference?: string,
  notes?: string,
): Promise<void> {
  await client.query(
    `INSERT INTO collection_payments
       (collection_id, amount, payment_method,
        paid_by, paid_at, recorded_by,
        payment_reference, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      collectionId,
      amount,
      paymentMethod,
      paidBy,
      paidAt,
      recordedBy,
      paymentReference ?? null,
      notes ?? null,
    ],
  );
}

// =========================================================================
// Reduce buyer used_limit (transactional)
// =========================================================================

/**
 * Reduce a buyer's used credit limit by the given amount.
 */
export async function reduceBuyerUsedLimit(
  client: PoolClient,
  buyerId: string,
  amount: string,
): Promise<void> {
  await client.query(
    `UPDATE buyers
     SET used_limit = used_limit - $1::bigint,
         updated_at = NOW()
     WHERE id = $2`,
    [amount, buyerId],
  );
}

// =========================================================================
// Invoice lookups
// =========================================================================

/**
 * Fetch invoice fields needed for collections processing.
 */
export async function getInvoiceForCollection(
  invoiceId: string,
): Promise<InvoiceForCollection | null> {
  const result = await query<InvoiceForCollection>(
    `SELECT id, face_value::text, advance_amount::text,
            status, supplier_id, buyer_id, due_date::text
     FROM invoices WHERE id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch collection record by invoice ID.
 */
export async function getCollectionByInvoiceId(
  invoiceId: string,
): Promise<CollectionRecord | null> {
  const result = await query<CollectionRecord>(
    `SELECT id, invoice_id, buyer_id, face_value::text,
            amount_due::text, days_overdue,
            daily_penalty_rate::text, penalty_amount::text,
            status, escalation_level, demand_notice_sent,
            sar_flagged, total_collected::text,
            last_payment_at::text,
            created_at, updated_at
     FROM collections
     WHERE invoice_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Invoices due for reminder
// =========================================================================

/**
 * Fetch invoices that match reminder trigger points.
 */
export async function getInvoicesDueForReminder(): Promise<InvoiceDueForReminder[]> {
  const result = await query<InvoiceDueForReminder>(
    `SELECT i.id, i.face_value::text, i.buyer_id,
            i.supplier_id, i.due_date::text,
            (i.due_date::date - CURRENT_DATE) AS days_until_due,
            CASE
              WHEN (i.due_date::date - CURRENT_DATE) = 7  THEN 'T_MINUS_7'
              WHEN (i.due_date::date - CURRENT_DATE) = 3  THEN 'T_MINUS_3'
              WHEN (i.due_date::date - CURRENT_DATE) = 0  THEN 'T_DUE'
              WHEN (i.due_date::date - CURRENT_DATE) = -1 THEN 'T_PLUS_1'
              WHEN (i.due_date::date - CURRENT_DATE) = -3 THEN 'T_PLUS_3'
              WHEN (i.due_date::date - CURRENT_DATE) = -7 THEN 'T_PLUS_7'
            END AS reminder_type
     FROM invoices i
     WHERE i.status IN ('collecting', 'overdue')
       AND (i.due_date::date - CURRENT_DATE) IN (7, 3, 0, -1, -3, -7)
     ORDER BY i.due_date ASC`,
    [],
  );
  return result.rows;
}

// =========================================================================
// Penalty lookup
// =========================================================================

/**
 * Get penalty calculation for an invoice.
 */
export async function getPenaltyByInvoiceId(invoiceId: string): Promise<PenaltyCalculation | null> {
  const result = await query<PenaltyCalculation>(
    `SELECT invoice_id AS "invoiceId",
            face_value::text AS "faceValue",
            days_overdue AS "daysOverdue",
            daily_penalty_rate::text AS "dailyPenaltyRate",
            penalty_amount::text AS "penaltyAmount"
     FROM collections
     WHERE invoice_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Overdue invoices list
// =========================================================================

/**
 * Get all overdue collection records.
 */
export async function getOverdueInvoices(): Promise<OverdueInvoiceSummary[]> {
  const result = await query<OverdueInvoiceSummary>(
    `SELECT id, invoice_id, buyer_id, face_value::text,
            amount_due::text, days_overdue, penalty_amount::text,
            status, escalation_level, sar_flagged
     FROM collections
     WHERE status IN ('overdue', 'escalated')
     ORDER BY days_overdue DESC`,
    [],
  );
  return result.rows;
}

// =========================================================================
// Defaultable collections
// =========================================================================

/**
 * Get collections at escalation level 3 with 90+ days overdue.
 */
export async function getDefaultableCollections(): Promise<DefaultableCollection[]> {
  const result = await query<DefaultableCollection>(
    `SELECT id, invoice_id, buyer_id, days_overdue, face_value::text
     FROM collections
     WHERE escalation_level = 3
       AND days_overdue >= 90
       AND status IN ('overdue', 'escalated')
     ORDER BY days_overdue DESC`,
    [],
  );
  return result.rows;
}

// =========================================================================
// SAR flag (transactional)
// =========================================================================

/**
 * Flag a collection record for SAR review.
 */
export async function flagForSarReview(client: PoolClient, collectionId: string): Promise<void> {
  await client.query(
    `UPDATE collections
     SET sar_flagged = true, updated_at = NOW()
     WHERE id = $1`,
    [collectionId],
  );
}

// =========================================================================
// Update invoice status (transactional)
// =========================================================================

/**
 * Update invoice status using the transaction client. Returns true iff a row
 * was actually updated (i.e. the prior status matched `expectedStatus`).
 *
 * The optimistic-concurrency `WHERE status = $expected` clause makes the
 * UPDATE a no-op when the row has already transitioned. Callers in the
 * money-path (e.g. `executePaymentReceivedTxn`) MUST inspect the boolean
 * and abort the transaction on `false` — otherwise the other side effects
 * (e.g. `reduceBuyerUsedLimit`) commit twice on a concurrent payment race.
 */
export async function updateInvoiceStatus(
  client: PoolClient,
  invoiceId: string,
  newStatus: string,
  expectedStatus: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE invoices
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND status = $3`,
    [newStatus, invoiceId, expectedStatus],
  );
  return (result.rowCount ?? 0) > 0;
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
// Paginated collections list (frontend-aligned)
// =========================================================================

/** Allowed sort columns to prevent SQL injection. */
const ALLOWED_SORT_COLUMNS: Record<string, string> = {
  invoice_number: 'i.invoice_number',
  buyer_name: 'b.company_name',
  face_value: 'c.face_value',
  outstanding_amount: 'outstanding_amount',
  days_overdue: 'c.days_overdue',
  escalation_level: 'c.escalation_level',
  last_payment_date: 'c.last_payment_at',
  due_date: 'i.due_date',
};

/**
 * Build WHERE clause fragments and params from filters.
 */
function buildFilterClause(
  filters: CollectionListFilters,
  paramOffset: number,
): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = paramOffset;

  if (filters.status !== undefined) {
    idx += 1;
    clauses.push(`c.status = $${idx}`);
    params.push(filters.status);
  }

  if (filters.escalation_level !== undefined) {
    idx += 1;
    clauses.push(`c.escalation_level = $${idx}`);
    const levelMap: Record<string, number> = {
      none: 0,
      reminder: 1,
      formal: 2,
      legal: 3,
    };
    params.push(levelMap[filters.escalation_level] ?? 0);
  }

  if (filters.days_overdue_min !== undefined) {
    idx += 1;
    clauses.push(`c.days_overdue >= $${idx}`);
    params.push(filters.days_overdue_min);
  }

  if (filters.days_overdue_max !== undefined) {
    idx += 1;
    clauses.push(`c.days_overdue <= $${idx}`);
    params.push(filters.days_overdue_max);
  }

  if (filters.search !== undefined) {
    idx += 1;
    const searchParam = `%${filters.search}%`;
    clauses.push(
      `(i.invoice_number ILIKE $${idx} OR b.company_name ILIKE $${idx} OR s.company_name ILIKE $${idx})`,
    );
    params.push(searchParam);
  }

  return { clauses, params };
}

/**
 * List collections with filters, pagination, and sorting.
 */
export async function listCollections(
  filters: CollectionListFilters,
): Promise<{ rows: CollectionListRow[]; total: number }> {
  const page = filters.page ?? 1;
  const pageSize = filters.page_size ?? 20;
  const offset = (page - 1) * pageSize;

  const { clauses, params: filterParams } = buildFilterClause(filters, 0);
  const whereClause = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';

  const sortCol = ALLOWED_SORT_COLUMNS[filters.sort_by ?? ''] ?? 'c.days_overdue';
  const sortDir = filters.sort_dir === 'asc' ? 'ASC' : 'DESC';

  const baseParams = [...filterParams];
  const limitIdx = baseParams.length + 1;
  const offsetIdx = baseParams.length + 2;

  const dataQuery = `
    SELECT
      c.id,
      c.invoice_id,
      i.invoice_number,
      b.company_name AS buyer_name,
      s.company_name AS supplier_name,
      c.face_value::text AS face_value,
      (c.face_value - COALESCE(c.total_collected, 0))::text AS outstanding_amount,
      i.due_date::text AS due_date,
      c.days_overdue,
      c.status,
      COALESCE(c.escalation_level, 0) AS escalation_level,
      c.last_payment_at::text AS last_payment_date,
      (
        SELECT cp.amount::text
        FROM collection_payments cp
        WHERE cp.collection_id = c.id
        ORDER BY cp.paid_at DESC
        LIMIT 1
      ) AS last_payment_amount,
      COALESCE(c.total_collected, 0)::text AS total_collected
    FROM collections c
    JOIN invoices i ON i.id = c.invoice_id
    JOIN buyers b ON b.id = c.buyer_id
    JOIN suppliers s ON s.id = i.supplier_id
    WHERE 1=1 ${whereClause}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const countQuery = `
    SELECT COUNT(*)::text AS total
    FROM collections c
    JOIN invoices i ON i.id = c.invoice_id
    JOIN buyers b ON b.id = c.buyer_id
    JOIN suppliers s ON s.id = i.supplier_id
    WHERE 1=1 ${whereClause}
  `;

  const dataResult = await query<CollectionListRow>(dataQuery, [...baseParams, pageSize, offset]);
  const countResult = await query<{ total: string }>(countQuery, baseParams);
  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

  return { rows: dataResult.rows, total };
}

/**
 * Get summary stats across all collections (ignoring pagination).
 */
export async function getCollectionSummaryStats(
  filters: CollectionListFilters,
): Promise<CollectionSummaryRow> {
  const { clauses, params } = buildFilterClause(filters, 0);
  const whereClause = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';

  const statsQuery = `
    SELECT
      COALESCE(SUM(c.face_value - COALESCE(c.total_collected, 0)), 0)::text
        AS total_outstanding_ugx,
      COUNT(*) FILTER (WHERE c.status IN ('overdue', 'escalated'))::text
        AS overdue_count,
      COALESCE(
        AVG(c.days_overdue) FILTER (WHERE c.status IN ('overdue', 'escalated')),
        0
      )::text AS avg_days_overdue,
      CASE
        WHEN COALESCE(SUM(c.face_value), 0) = 0 THEN '0'
        ELSE (
          COALESCE(SUM(c.total_collected), 0)::numeric * 100
          / SUM(c.face_value)::numeric
        )::text
      END AS collection_rate
    FROM collections c
    JOIN invoices i ON i.id = c.invoice_id
    JOIN buyers b ON b.id = c.buyer_id
    JOIN suppliers s ON s.id = i.supplier_id
    WHERE 1=1 ${whereClause}
  `;

  const result = await query<CollectionSummaryRow>(statsQuery, params);
  return (
    result.rows[0] ?? {
      total_outstanding_ugx: '0',
      overdue_count: '0',
      avg_days_overdue: '0',
      collection_rate: '0',
    }
  );
}

// =========================================================================
// Collection detail (frontend-aligned)
// =========================================================================

/**
 * Get full collection detail by collection ID.
 */
export async function getCollectionDetail(
  collectionId: string,
): Promise<CollectionDetailRow | null> {
  const result = await query<CollectionDetailRow>(
    `SELECT
      c.id,
      c.invoice_id,
      i.invoice_number,
      b.company_name AS buyer_name,
      s.company_name AS supplier_name,
      c.buyer_id,
      i.supplier_id,
      c.face_value::text AS face_value,
      COALESCE(c.total_collected, 0)::text AS total_collected,
      (c.face_value - COALESCE(c.total_collected, 0))::text AS outstanding_amount,
      i.due_date::text AS due_date,
      c.days_overdue,
      c.status,
      COALESCE(c.escalation_level, 0) AS escalation_level,
      c.sar_flagged,
      c.last_payment_at::text AS last_payment_date,
      c.created_at::text,
      c.updated_at::text
    FROM collections c
    JOIN invoices i ON i.id = c.invoice_id
    JOIN buyers b ON b.id = c.buyer_id
    JOIN suppliers s ON s.id = i.supplier_id
    WHERE c.id = $1`,
    [collectionId],
  );
  return result.rows[0] ?? null;
}

/**
 * Get payment history for a collection.
 */
export async function getPaymentHistory(collectionId: string): Promise<PaymentHistoryRow[]> {
  const result = await query<PaymentHistoryRow>(
    `SELECT
      cp.id,
      cp.amount::text AS amount,
      cp.paid_at::text AS payment_date,
      cp.payment_method AS method,
      COALESCE(cp.payment_reference, '') AS reference,
      (
        c.face_value - COALESCE(
          (SELECT SUM(cp2.amount)
           FROM collection_payments cp2
           WHERE cp2.collection_id = cp.collection_id
             AND cp2.paid_at <= cp.paid_at),
          0
        )
      )::text AS running_balance,
      cp.notes
    FROM collection_payments cp
    JOIN collections c ON c.id = cp.collection_id
    WHERE cp.collection_id = $1
    ORDER BY cp.paid_at ASC`,
    [collectionId],
  );
  return result.rows;
}

/**
 * Get escalation history from audit_logs.
 */
export async function getEscalationHistory(collectionId: string): Promise<EscalationHistoryRow[]> {
  const result = await query<EscalationHistoryRow>(
    `SELECT
      al.id::text AS id,
      (al.new_values->>'escalationLevel')::int AS escalation_level,
      al.created_at::text AS occurred_at,
      COALESCE(u.email, 'System') AS actor_name,
      COALESCE(u.role::text, 'system') AS actor_role,
      al.new_values->>'reason' AS notes
    FROM audit_logs al
    LEFT JOIN users u ON u.id::text = al.user_id::text
    WHERE al.record_id = $1
      AND al.action IN ('COLLECTION_ESCALATED', 'COLLECTION_DEESCALATED')
    ORDER BY al.created_at ASC`,
    [collectionId],
  );
  return result.rows;
}

/**
 * Get buyer contact info by buyer ID.
 */
export async function getBuyerContact(buyerId: string): Promise<BuyerContactRow | null> {
  const result = await query<BuyerContactRow>(
    `SELECT
      id,
      company_name,
      contact_email_encrypted,
      contact_phone_encrypted,
      approved_limit::text,
      payment_score
    FROM buyers
    WHERE id = $1`,
    [buyerId],
  );
  return result.rows[0] ?? null;
}

/**
 * Get collection record by its own ID.
 */
export async function getCollectionById(collectionId: string): Promise<CollectionRecord | null> {
  const result = await query<CollectionRecord>(
    `SELECT id, invoice_id, buyer_id, face_value::text,
            amount_due::text, days_overdue,
            daily_penalty_rate::text, penalty_amount::text,
            status, escalation_level, demand_notice_sent,
            sar_flagged, total_collected::text,
            last_payment_at::text,
            created_at, updated_at
     FROM collections
     WHERE id = $1`,
    [collectionId],
  );
  return result.rows[0] ?? null;
}

/**
 * Set escalation level on a collection (non-transactional).
 */
export async function setEscalationLevel(
  client: PoolClient,
  collectionId: string,
  level: number,
): Promise<void> {
  await client.query(
    `UPDATE collections
     SET escalation_level = $1,
         escalation_date = NOW(),
         status = CASE
           WHEN $1 > 0 THEN 'escalated'
           ELSE status
         END,
         updated_at = NOW()
     WHERE id = $2`,
    [level, collectionId],
  );
}

/**
 * Update collection total_collected and last_payment_at after a partial payment.
 */
export async function updateCollectionAfterPayment(
  client: PoolClient,
  collectionId: string,
  paymentAmount: string,
): Promise<void> {
  await client.query(
    `UPDATE collections
     SET total_collected = COALESCE(total_collected, 0) + $1::numeric,
         last_payment_at = NOW(),
         updated_at = NOW()
     WHERE id = $2`,
    [paymentAmount, collectionId],
  );
}

/**
 * Mark a collection as resolved (collected).
 */
export async function resolveCollectionById(
  client: PoolClient,
  collectionId: string,
): Promise<void> {
  await client.query(
    `UPDATE collections
     SET status = 'collected',
         updated_at = NOW()
     WHERE id = $1`,
    [collectionId],
  );
}

// =========================================================================
// Funded overdue invoices (batch processing)
// =========================================================================

/**
 * Get all collecting invoices past their due date.
 * Returns invoices owned by the collections module (status = 'collecting')
 * whose due_date has elapsed — eligible for the funded → overdue transition.
 */
export async function getFundedOverdueInvoices(): Promise<FundedOverdueInvoiceRow[]> {
  const result = await query<FundedOverdueInvoiceRow>(
    `SELECT id
     FROM invoices
     WHERE status = 'collecting'
       AND due_date::date < CURRENT_DATE`,
    [],
  );
  return result.rows;
}

// =========================================================================
// Escalation candidates (batch processing)
// =========================================================================

/**
 * Get collections eligible for escalation processing.
 */
export async function getEscalationCandidates(): Promise<EscalationCandidateRow[]> {
  const result = await query<EscalationCandidateRow>(
    `SELECT c.id, c.invoice_id, c.days_overdue,
            COALESCE(c.escalation_level, 0)::int AS escalation_level
     FROM collections c
     WHERE c.status IN ('overdue', 'escalated')
       AND COALESCE(c.escalation_level, 0) < 3`,
    [],
  );
  return result.rows;
}

// =========================================================================
// Buyer payment score adjustment
// =========================================================================

/**
 * Adjust buyer payment_score based on payment timeliness.
 * Score increases for on-time/early, decreases for late.
 * Clamped to 0-100 range.
 */
export async function adjustBuyerPaymentScore(
  client: PoolClient,
  buyerId: string,
  daysLate: number,
): Promise<void> {
  const adjustment = daysLate <= 0 ? 5 : Math.min(daysLate, 20) * -1;
  await client.query(
    `UPDATE buyers
     SET payment_score = GREATEST(0, LEAST(100, payment_score + $1)),
         updated_at = NOW()
     WHERE id = $2`,
    [adjustment, buyerId],
  );
}

// =========================================================================
// SAR filing (Suspicious Activity Reports)
// =========================================================================

/** SAR record shape returned from queries. */
export interface SarRecord {
  id: string;
  entity_type: string;
  entity_id: string;
  collection_id: string | null;
  invoice_id: string | null;
  reason: string;
  report_status: string;
  fia_reference: string | null;
  filed_by: string | null;
  filed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Create a SAR report within a transaction.
 */
export async function createSarReportWithClient(
  client: PoolClient,
  data: {
    id: string;
    entityType: string;
    entityId: string;
    collectionId: string | null;
    invoiceId: string | null;
    reason: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO suspicious_activity_reports
       (id, entity_type, entity_id, collection_id,
        invoice_id, reason, report_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft')`,
    [data.id, data.entityType, data.entityId, data.collectionId, data.invoiceId, data.reason],
  );
}

/**
 * Update SAR status, FIA reference, and filed_by within a transaction.
 */
export async function updateSarStatusWithClient(
  client: PoolClient,
  sarId: string,
  status: string,
  fiaRef: string | null,
  filedBy: string,
): Promise<void> {
  await client.query(
    `UPDATE suspicious_activity_reports
     SET report_status = $1,
         fia_reference = $2,
         filed_by = $3,
         filed_at = CASE WHEN $1 = 'filed' THEN NOW() ELSE filed_at END,
         updated_at = NOW()
     WHERE id = $4`,
    [status, fiaRef, filedBy, sarId],
  );
}

/**
 * Get SAR records by collection ID.
 */
export async function getSarByCollectionId(collectionId: string): Promise<SarRecord[]> {
  const result = await query<SarRecord>(
    `SELECT id, entity_type, entity_id, collection_id,
            invoice_id, reason, report_status,
            fia_reference, filed_by::text, filed_at::text,
            created_at::text, updated_at::text
     FROM suspicious_activity_reports
     WHERE collection_id = $1
     ORDER BY created_at DESC`,
    [collectionId],
  );
  return result.rows;
}

/**
 * Get SAR record by ID.
 */
export async function getSarById(sarId: string): Promise<SarRecord | null> {
  const result = await query<SarRecord>(
    `SELECT id, entity_type, entity_id, collection_id,
            invoice_id, reason, report_status,
            fia_reference, filed_by::text, filed_at::text,
            created_at::text, updated_at::text
     FROM suspicious_activity_reports
     WHERE id = $1`,
    [sarId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Escalation Documents
// =========================================================================

export async function createEscalationDocumentWithClient(
  client: PoolClient,
  data: {
    id: string;
    collectionId: string;
    documentType: string;
    contentEncrypted: string;
    fileHash: string;
    draftParams: Record<string, unknown>;
    generatedBy: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO escalation_documents
       (id, collection_id, document_type, content_encrypted, file_hash, draft_params, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      data.id,
      data.collectionId,
      data.documentType,
      data.contentEncrypted,
      data.fileHash,
      JSON.stringify(data.draftParams),
      data.generatedBy,
    ],
  );
}

export async function updateDocumentContentWithClient(
  client: PoolClient,
  documentId: string,
  contentEncrypted: string,
  fileHash: string,
  draftParams: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `UPDATE escalation_documents
     SET content_encrypted = $1, file_hash = $2, draft_params = $3::jsonb
     WHERE id = $4 AND status = 'draft'`,
    [contentEncrypted, fileHash, JSON.stringify(draftParams), documentId],
  );
}

export async function finalizeDocumentWithClient(
  client: PoolClient,
  documentId: string,
  finalizedBy: string,
  sentToEmailEncrypted: string,
): Promise<void> {
  await client.query(
    `UPDATE escalation_documents
     SET status = 'sent', finalized_by = $1, sent_at = NOW(), sent_to_email = $2
     WHERE id = $3 AND status = 'draft'`,
    [finalizedBy, sentToEmailEncrypted, documentId],
  );
}

export async function getEscalationDocumentById(
  documentId: string,
): Promise<EscalationDocumentRow | null> {
  const result = await query<EscalationDocumentRow>(
    `SELECT * FROM escalation_documents WHERE id = $1`,
    [documentId],
  );
  return result.rows[0] ?? null;
}

export async function getDocumentByType(
  collectionId: string,
  documentType: string,
): Promise<EscalationDocumentRow | null> {
  const result = await query<EscalationDocumentRow>(
    `SELECT * FROM escalation_documents
     WHERE collection_id = $1 AND document_type = $2
     ORDER BY created_at DESC LIMIT 1`,
    [collectionId, documentType],
  );
  return result.rows[0] ?? null;
}

export async function listEscalationDocumentsByCollection(
  collectionId: string,
): Promise<EscalationDocumentRow[]> {
  const result = await query<EscalationDocumentRow>(
    `SELECT * FROM escalation_documents
     WHERE collection_id = $1
     ORDER BY created_at DESC`,
    [collectionId],
  );
  return result.rows;
}
