import { query, pool } from '../../shared/database/pool';
import type { PoolClient } from 'pg';
import type {
  InvoiceRecord,
  BuyerLimits,
  InvoiceFilters,
  PaginationParams,
  AuditTimelineEntry,
  EnrichedInvoiceListRow,
  EnrichedInvoiceDetailRow,
  ApprovalHistoryRow,
  InvoiceDocumentRow,
  InvoiceCollateralRow,
} from './invoices.types';

// =========================================================================
// Invoice queries
// =========================================================================

/**
 * Create a new invoice with status='submitted' and 72hr SLA deadline.
 */
export async function createInvoice(data: {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  buyerId: string;
  faceValue: string;
  dueDate: string;
  description: string;
  tenorDays: number;
}): Promise<void> {
  await query(
    `INSERT INTO invoices (
      id, invoice_number, supplier_id, buyer_id,
      face_value, due_date, description, tenor_days,
      status, sla_deadline, aml_flagged
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, 'submitted',
      NOW() + INTERVAL '72 hours', false
    )`,
    [
      data.id,
      data.invoiceNumber,
      data.supplierId,
      data.buyerId,
      data.faceValue,
      data.dueDate,
      data.description,
      data.tenorDays,
    ],
  );
}

/**
 * Find invoice by primary key.
 */
export async function findInvoiceById(id: string): Promise<InvoiceRecord | null> {
  const result = await query<InvoiceRecord>(`SELECT * FROM invoices WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

/**
 * Find invoice by invoice_number + supplier_id (duplicate check).
 */
export async function findInvoiceByNumberAndSupplier(
  invoiceNumber: string,
  supplierId: string,
): Promise<InvoiceRecord | null> {
  const result = await query<InvoiceRecord>(
    `SELECT * FROM invoices
     WHERE invoice_number = $1 AND supplier_id = $2`,
    [invoiceNumber, supplierId],
  );
  return result.rows[0] ?? null;
}

/**
 * Find invoices belonging to a supplier with pagination.
 */
export async function findInvoicesBySupplier(
  supplierId: string,
  pagination: PaginationParams,
): Promise<{ rows: InvoiceRecord[]; total: number }> {
  const offset = (pagination.page - 1) * pagination.limit;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM invoices WHERE supplier_id = $1`,
    [supplierId],
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const dataResult = await query<InvoiceRecord>(
    `SELECT * FROM invoices
     WHERE supplier_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [supplierId, pagination.limit, offset],
  );

  return { rows: dataResult.rows, total };
}

/**
 * Build a parameterised WHERE clause from InvoiceFilters for the bare
 * `invoices` table (no `i.` alias). Returns the clause, its parameters,
 * and the next available $-index for the caller's LIMIT/OFFSET.
 */
function buildFlatInvoiceFilterClause(filters: InvoiceFilters): {
  whereClause: string;
  whereParams: unknown[];
  nextIdx: number;
} {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (filters.status !== undefined) {
    if (Array.isArray(filters.status)) {
      conditions.push(`status = ANY($${String(idx++)}::text[])`);
    } else {
      conditions.push(`status = $${String(idx++)}`);
    }
    params.push(filters.status);
  }
  if (filters.buyer_id !== undefined) {
    conditions.push(`buyer_id = $${String(idx++)}`);
    params.push(filters.buyer_id);
  }
  if (filters.date_from !== undefined) {
    conditions.push(`created_at >= $${String(idx++)}`);
    params.push(filters.date_from);
  }
  if (filters.date_to !== undefined) {
    conditions.push(`created_at <= $${String(idx++)}`);
    params.push(filters.date_to);
  }
  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    whereParams: params,
    nextIdx: idx,
  };
}

/**
 * Find all invoices with filters and pagination (staff view).
 */
export async function findAllInvoices(
  filters: InvoiceFilters,
  pagination: PaginationParams,
): Promise<{ rows: InvoiceRecord[]; total: number }> {
  const offset = (pagination.page - 1) * pagination.limit;
  const { whereClause, whereParams, nextIdx } = buildFlatInvoiceFilterClause(filters);

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM invoices ${whereClause}`,
    whereParams,
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const dataResult = await query<InvoiceRecord>(
    `SELECT * FROM invoices ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${String(nextIdx)} OFFSET $${String(nextIdx + 1)}`,
    [...whereParams, pagination.limit, offset],
  );

  return { rows: dataResult.rows, total };
}

/**
 * Update invoice status with optimistic concurrency guard.
 * Only updates if current status matches expectedStatus, preventing stale transitions.
 */
export async function updateInvoiceStatus(
  id: string,
  newStatus: string,
  expectedStatus: string,
): Promise<void> {
  await query(`UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3`, [
    newStatus,
    id,
    expectedStatus,
  ]);
}

/** Staff-only: called from compliance_officer routes only. No supplier_id guard needed. */
export async function setAmlFlag(id: string, flagged: boolean): Promise<void> {
  await query(`UPDATE invoices SET aml_flagged = $1 WHERE id = $2`, [flagged, id]);
}

/**
 * Get all audit log entries for a specific invoice (timeline).
 */
export async function getInvoiceTimeline(invoiceId: string): Promise<AuditTimelineEntry[]> {
  const result = await query<AuditTimelineEntry>(
    `SELECT id, user_id, action, old_values, new_values,
            ip_address, user_agent, created_at
     FROM audit_logs
     WHERE record_id = $1
     ORDER BY created_at ASC`,
    [invoiceId],
  );
  return result.rows;
}

// =========================================================================
// Cross-module lookups (buyer limits, supplier status)
// =========================================================================

/**
 * Find buyer with credit limit information.
 */
export async function findBuyerWithLimits(buyerId: string): Promise<BuyerLimits | null> {
  const result = await query<BuyerLimits>(
    `SELECT id, company_name, is_active, approved_limit, used_limit
     FROM buyers WHERE id = $1`,
    [buyerId],
  );
  return result.rows[0] ?? null;
}

/**
 * Find supplier KYC status and ID by user_id.
 */
export async function findSupplierByUserId(
  userId: string,
): Promise<{ id: string; kyc_status: string } | null> {
  const result = await query<{ id: string; kyc_status: string }>(
    `SELECT id, kyc_status FROM suppliers WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Find supplier by primary key (for ownership checks).
 */
export async function findSupplierById(
  supplierId: string,
): Promise<{ id: string; user_id: string; kyc_status: string } | null> {
  const result = await query<{ id: string; user_id: string; kyc_status: string }>(
    `SELECT id, user_id, kyc_status FROM suppliers WHERE id = $1`,
    [supplierId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Audit
// =========================================================================

/**
 * Write an audit log entry for an invoice event.
 */
export async function createAuditEntry(
  userId: string | null,
  action: string,
  tableName: string,
  recordId: string,
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown>,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<void> {
  await query(
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
// Draft invoice helpers
// =========================================================================

/**
 * Create a draft invoice (status='draft', no SLA deadline yet).
 */
export async function createDraftInvoice(data: {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  buyerId: string;
  faceValue: string;
  dueDate: string;
  description: string;
  tenorDays: number;
}): Promise<void> {
  await query(
    `INSERT INTO invoices (
       id, invoice_number, supplier_id, buyer_id,
       face_value, due_date, description, tenor_days, status, aml_flagged
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',false)`,
    [
      data.id,
      data.invoiceNumber,
      data.supplierId,
      data.buyerId,
      data.faceValue,
      data.dueDate,
      data.description,
      data.tenorDays,
    ],
  );
}

/**
 * Update editable fields on a draft invoice (supplier-owned, status must be 'draft').
 * Returns updated record or null if not found / not a draft.
 */
export async function updateDraftFields(
  id: string,
  supplierId: string,
  fields: { description?: string; faceValue?: string; dueDate?: string; tenorDays?: number },
): Promise<InvoiceRecord | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (fields.description !== undefined) {
    sets.push(`description = $${i++}`);
    params.push(fields.description);
  }
  if (fields.faceValue !== undefined) {
    sets.push(`face_value = $${i++}`);
    params.push(fields.faceValue);
  }
  if (fields.dueDate !== undefined) {
    sets.push(`due_date = $${i++}`);
    params.push(fields.dueDate);
  }
  if (fields.tenorDays !== undefined) {
    sets.push(`tenor_days = $${i++}`);
    params.push(fields.tenorDays);
  }
  if (sets.length === 0) return findInvoiceById(id);
  sets.push('updated_at = NOW()');
  params.push(id, supplierId);
  const r = await query<InvoiceRecord>(
    `UPDATE invoices SET ${sets.join(', ')}
     WHERE id = $${i} AND supplier_id = $${i + 1} AND status = 'draft'
     RETURNING *`,
    params,
  );
  return r.rows[0] ?? null;
}

/**
 * Promote a draft invoice to 'submitted' within a transaction, setting the 72hr SLA.
 */
export async function promoteToSubmitted(client: PoolClient, id: string): Promise<void> {
  await client.query(
    `UPDATE invoices
     SET status = 'submitted', sla_deadline = NOW() + INTERVAL '72 hours', updated_at = NOW()
     WHERE id = $1 AND status = 'draft'`,
    [id],
  );
}

// =========================================================================
// Cooling-off withdrawal
// =========================================================================

/**
 * Find invoice by ID and supplier_id (ownership-enforced).
 */
export async function findInvoiceByIdForSupplier(
  id: string,
  supplierId: string,
): Promise<InvoiceRecord | null> {
  const result = await query<InvoiceRecord>(
    'SELECT * FROM invoices WHERE id = $1 AND supplier_id = $2',
    [id, supplierId],
  );
  return result.rows[0] ?? null;
}

/**
 * G11 — Assign an invoice to a credit_officer / finance_manager.
 * Passing `null` un-assigns. Returns rowCount (0 if invoice not found).
 */
export async function assignInvoiceWithClient(
  client: PoolClient,
  invoiceId: string,
  assigneeUserId: string | null,
): Promise<number> {
  const result = await client.query(
    `UPDATE invoices
     SET assigned_to_user_id = $1, updated_at = NOW()
     WHERE id = $2`,
    [assigneeUserId, invoiceId],
  );
  return result.rowCount ?? 0;
}

/**
 * G6 — Persist per-invoice bank details after approval.
 * Ownership enforced by AND supplier_id check; returns rowCount = 0 if the
 * caller doesn't own the invoice or it's in the wrong status.
 * All three values are stored as ciphertext — service layer encrypts.
 */
export async function setInvoiceBankDetailsWithClient(
  client: PoolClient,
  invoiceId: string,
  supplierId: string,
  bankAccountNumberEncrypted: string,
  bankAccountNameEncrypted: string,
  bankNameEncrypted: string,
): Promise<number> {
  const result = await client.query(
    `UPDATE invoices
     SET bank_account_number_encrypted = $1,
         bank_account_name_encrypted   = $2,
         bank_name_encrypted           = $3,
         bank_details_captured_at      = NOW(),
         updated_at                    = NOW()
     WHERE id = $4
       AND supplier_id = $5
       AND status = 'approved'`,
    [
      bankAccountNumberEncrypted,
      bankAccountNameEncrypted,
      bankNameEncrypted,
      invoiceId,
      supplierId,
    ],
  );
  return result.rowCount ?? 0;
}

/**
 * Withdraw an invoice within a transaction.
 */
export async function withdrawInvoiceWithClient(
  client: PoolClient,
  invoiceId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `UPDATE invoices
     SET status = 'withdrawn', withdrawn_at = NOW(), withdrawn_reason = $1, updated_at = NOW()
     WHERE id = $2`,
    [reason, invoiceId],
  );
}

// =========================================================================
// Transactional helpers
// =========================================================================

/**
 * Acquire a client from the pool for transactional work.
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/**
 * Create a new invoice within a transaction.
 * `uraEfrisRef`, `fundingTimelineDays`, and `assessmentDueAt` correspond to
 * gaps G1, G9, and G7 respectively. They are optional here so callers that
 * have not yet been updated keep compiling.
 */
export async function createInvoiceWithClient(
  client: PoolClient,
  data: {
    id: string;
    invoiceNumber: string;
    supplierId: string;
    buyerId: string;
    faceValue: string;
    dueDate: string;
    description: string;
    tenorDays: number;
    uraEfrisRef?: string;
    fundingTimelineDays?: number | null;
    assessmentDueAt?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO invoices (
      id, invoice_number, supplier_id, buyer_id,
      face_value, due_date, description, tenor_days,
      status, sla_deadline, aml_flagged,
      ura_efris_ref, funding_timeline_days, assessment_due_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, 'submitted',
      NOW() + INTERVAL '72 hours', false,
      $9, $10, $11
    )`,
    [
      data.id,
      data.invoiceNumber,
      data.supplierId,
      data.buyerId,
      data.faceValue,
      data.dueDate,
      data.description,
      data.tenorDays,
      data.uraEfrisRef ?? null,
      data.fundingTimelineDays ?? null,
      data.assessmentDueAt ?? null,
    ],
  );
}

/**
 * Set AML flag on invoice within a transaction.
 */
export async function setAmlFlagWithClient(
  client: PoolClient,
  id: string,
  flagged: boolean,
): Promise<void> {
  await client.query(`UPDATE invoices SET aml_flagged = $1 WHERE id = $2`, [flagged, id]);
}

// =========================================================================
// AML/CFT — structuring detection + velocity monitoring
// =========================================================================

/**
 * Get rolling 30-day invoice total and count for a supplier–buyer pair.
 */
export async function get30DayRollingTotal(
  supplierId: string,
  buyerId: string,
): Promise<{ total: string; count: number }> {
  const result = await query<{ total: string; count: string }>(
    `SELECT COALESCE(SUM(face_value), 0)::text AS total,
            COUNT(*)::int AS count
     FROM invoices
     WHERE supplier_id = $1
       AND buyer_id = $2
       AND created_at >= NOW() - INTERVAL '30 days'
       AND status != 'draft'`,
    [supplierId, buyerId],
  );
  const row = result.rows[0];
  return {
    total: row?.total ?? '0',
    count: parseInt(row?.count ?? '0', 10),
  };
}

/**
 * Get 6-month invoice count and total for velocity monitoring.
 */
export async function get6MonthVelocityAverage(
  supplierId: string,
): Promise<{ total_count: number; total_value: string }> {
  const result = await query<{ total_count: string; total_value: string }>(
    `SELECT COUNT(*)::text AS total_count,
            COALESCE(SUM(face_value), 0)::text AS total_value
     FROM invoices
     WHERE supplier_id = $1
       AND created_at >= NOW() - INTERVAL '6 months'
       AND status != 'draft'`,
    [supplierId],
  );
  const row = result.rows[0];
  return {
    total_count: parseInt(row?.total_count ?? '0', 10),
    total_value: row?.total_value ?? '0',
  };
}

// =========================================================================
// Enriched LIST + DETAIL queries (JOIN suppliers/buyers/risk_scores/etc.)
// =========================================================================

/** Standard SELECT projection for the enriched list/detail rows. */
const ENRICHED_LIST_COLUMNS = `
  i.id, i.invoice_number, i.supplier_id, i.buyer_id,
  i.face_value, i.advance_amount, i.discount_amount, i.net_payment_to_supplier,
  i.tenor_days, i.status, i.due_date, i.funded_at, i.collected_at,
  i.created_at, i.updated_at, i.bank_details_captured_at,
  COALESCE(s.company_name, '') AS supplier_name,
  COALESCE(b.company_name, '') AS buyer_name,
  rs.final_score AS risk_score,
  rs.recommendation AS risk_recommendation,
  rs.max_advance_pct AS advance_percentage,
  rs.total_discount_rate AS discount_rate
`;

const ENRICHED_LIST_FROM = `
  FROM invoices i
  LEFT JOIN suppliers s ON s.id = i.supplier_id
  LEFT JOIN buyers b ON b.id = i.buyer_id
  LEFT JOIN risk_scores rs ON rs.invoice_id = i.id
`;

/**
 * Enriched list of invoices for staff (no supplier filter).
 * Returns rows with supplier_name, buyer_name, risk_score populated.
 */
export async function findEnrichedAllInvoices(
  filters: InvoiceFilters,
  pagination: PaginationParams,
): Promise<{ rows: EnrichedInvoiceListRow[]; total: number }> {
  const { whereClause, whereParams, nextIdx } = buildInvoiceFilterClause(filters);
  const total = await countEnrichedInvoices(whereClause, whereParams);
  const offset = (pagination.page - 1) * pagination.limit;
  const dataResult = await query<EnrichedInvoiceListRow>(
    `SELECT ${ENRICHED_LIST_COLUMNS}
     ${ENRICHED_LIST_FROM}
     ${whereClause}
     ORDER BY i.created_at DESC
     LIMIT $${String(nextIdx)} OFFSET $${String(nextIdx + 1)}`,
    [...whereParams, pagination.limit, offset],
  );
  return { rows: dataResult.rows, total };
}

/**
 * Enriched list of invoices owned by a single supplier.
 */
export async function findEnrichedInvoicesBySupplier(
  supplierId: string,
  pagination: PaginationParams,
): Promise<{ rows: EnrichedInvoiceListRow[]; total: number }> {
  const total = await countEnrichedInvoices('WHERE i.supplier_id = $1', [supplierId]);
  const offset = (pagination.page - 1) * pagination.limit;
  const dataResult = await query<EnrichedInvoiceListRow>(
    `SELECT ${ENRICHED_LIST_COLUMNS}
     ${ENRICHED_LIST_FROM}
     WHERE i.supplier_id = $1
     ORDER BY i.created_at DESC
     LIMIT $2 OFFSET $3`,
    [supplierId, pagination.limit, offset],
  );
  return { rows: dataResult.rows, total };
}

/** Build a parameterised WHERE clause from InvoiceFilters (≤25 lines). */
function buildInvoiceFilterClause(filters: InvoiceFilters): {
  whereClause: string;
  whereParams: unknown[];
  nextIdx: number;
} {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (filters.status !== undefined) {
    if (Array.isArray(filters.status)) {
      conditions.push(`i.status = ANY($${String(idx++)}::text[])`);
      params.push(filters.status);
    } else {
      conditions.push(`i.status = $${String(idx++)}`);
      params.push(filters.status);
    }
  }
  if (filters.buyer_id !== undefined) {
    conditions.push(`i.buyer_id = $${String(idx++)}`);
    params.push(filters.buyer_id);
  }
  if (filters.date_from !== undefined) {
    conditions.push(`i.created_at >= $${String(idx++)}`);
    params.push(filters.date_from);
  }
  if (filters.date_to !== undefined) {
    conditions.push(`i.created_at <= $${String(idx++)}`);
    params.push(filters.date_to);
  }
  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    whereParams: params,
    nextIdx: idx,
  };
}

/** Count enriched invoices with a pre-built WHERE clause (≤10 lines). */
async function countEnrichedInvoices(whereClause: string, params: unknown[]): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count
     FROM invoices i
     ${whereClause}`,
    params,
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Enriched single invoice for the detail page — JOINs suppliers/buyers/users
 * (twice for dual-auth) / risk_scores / payments. Returns null if not found.
 */
export async function getEnrichedInvoiceDetail(
  invoiceId: string,
): Promise<EnrichedInvoiceDetailRow | null> {
  const result = await query<EnrichedInvoiceDetailRow>(
    `SELECT
       i.id, i.invoice_number, i.supplier_id, i.buyer_id,
       i.face_value, i.advance_amount, i.discount_amount, i.net_payment_to_supplier,
       i.description, i.tenor_days, i.status, i.due_date,
       i.sla_deadline, i.buyer_confirmed_at, i.aml_flagged,
       i.funded_at, i.collected_at,
       i.created_at, i.updated_at, i.bank_details_captured_at,
       COALESCE(s.company_name, '') AS supplier_name,
       s.registration_number,
       sus.email AS supplier_email,
       sus.phone_encrypted AS supplier_phone_enc,
       COALESCE(b.company_name, '') AS buyer_name,
       b.approved_limit::text AS buyer_credit_limit,
       b.contact_email_encrypted AS buyer_email_enc,
       b.contact_phone_encrypted AS buyer_phone_enc,
       rs.final_score AS risk_score,
       rs.recommendation AS risk_recommendation,
       rs.max_advance_pct AS advance_percentage,
       rs.total_discount_rate AS discount_rate,
       rs.buyer_credit_score, rs.tenor_score, rs.track_record_score,
       rs.concentration_score, rs.collateral_score,
       p.dual_auth_user_1 AS dual_auth_user_1_id,
       p.dual_auth_timestamp_1 AS dual_auth_user_1_at,
       u1.email AS dual_auth_user_1_name,
       p.dual_auth_user_2 AS dual_auth_user_2_id,
       p.dual_auth_timestamp_2 AS dual_auth_user_2_at,
       u2.email AS dual_auth_user_2_name,
       p.created_at AS approved_at,
       NULL::text AS pricing_accepted_at
     FROM invoices i
     LEFT JOIN suppliers s ON s.id = i.supplier_id
     LEFT JOIN users sus ON sus.id = s.user_id
     LEFT JOIN buyers b ON b.id = i.buyer_id
     LEFT JOIN risk_scores rs ON rs.invoice_id = i.id
     LEFT JOIN payments p ON p.invoice_id = i.id
     LEFT JOIN users u1 ON u1.id = p.dual_auth_user_1
     LEFT JOIN users u2 ON u2.id = p.dual_auth_user_2
     WHERE i.id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

/**
 * Approval history for an invoice — JOIN users so each row carries actor_name.
 * approver_id is VARCHAR (allows literal 'SYSTEM' for auto-approvals per migration 004).
 */
export async function getInvoiceApprovalHistory(invoiceId: string): Promise<ApprovalHistoryRow[]> {
  const result = await query<ApprovalHistoryRow>(
    `SELECT a.tier, a.decision, a.comments, a.created_at,
            COALESCE(u.email, a.approver_id) AS actor_name,
            COALESCE(u.role::text, 'system') AS actor_role
     FROM approvals a
     LEFT JOIN users u ON u.id::text = a.approver_id
     WHERE a.invoice_id = $1
     ORDER BY a.created_at ASC`,
    [invoiceId],
  );
  return result.rows;
}

/**
 * Documents attached to an invoice (no decryption — file paths are encrypted
 * but only the metadata is returned to the frontend).
 */
export async function getInvoiceDocumentRefs(invoiceId: string): Promise<InvoiceDocumentRow[]> {
  const result = await query<InvoiceDocumentRow>(
    `SELECT id, document_type, file_size_bytes, created_at
     FROM invoice_documents
     WHERE invoice_id = $1
     ORDER BY created_at ASC`,
    [invoiceId],
  );
  return result.rows;
}

/**
 * Collateral linked to an invoice. Mapped to status='active'/'expired' in service.
 */
export async function getInvoiceCollateralRefs(invoiceId: string): Promise<InvoiceCollateralRow[]> {
  const result = await query<InvoiceCollateralRow>(
    `SELECT id, collateral_type, value::text AS value, description,
            expiry_date, is_active, created_at, updated_at
     FROM collateral
     WHERE invoice_id = $1
     ORDER BY created_at ASC`,
    [invoiceId],
  );
  return result.rows;
}

/**
 * Get current month invoice count for a supplier.
 */
export async function getCurrentMonthCount(supplierId: string): Promise<{ count: number }> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM invoices
     WHERE supplier_id = $1
       AND created_at >= date_trunc('month', NOW())
       AND status != 'draft'`,
    [supplierId],
  );
  return {
    count: parseInt(result.rows[0]?.count ?? '0', 10),
  };
}

/**
 * Insert audit log entry within a transaction.
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
