// =============================================================================
// AML Clearance — Repository (parameterised SQL only)
// =============================================================================
// Refinement 4 (compliance review): the LIST query MUST NOT select decrypted
// supplier/buyer PII. Only IDs and non-PII metadata are SELECTed. The DETAIL
// query MAY SELECT the encrypted company names and the service decrypts +
// audit-logs the read event.

import type { PoolClient } from 'pg';
import { query } from '../../shared/database/pool';
import type { AmlQueueRow, AmlDetailRow, InvoiceClearanceState } from './aml-clearance.types';

// =========================================================================
// Queue list — strictly non-PII columns
// =========================================================================

/**
 * Return all invoices that are AML-flagged and not yet cleared.
 *
 * Selected columns are intentionally narrow: invoice_id, supplier_id,
 * buyer_id, face_value, the timestamp the flag was raised and a derived
 * `days_flagged` value. No company names, emails, phones, or bank details.
 */
export async function listAmlQueue(): Promise<AmlQueueRow[]> {
  const result = await query<AmlQueueRow>(
    `SELECT
       i.id           AS invoice_id,
       i.supplier_id  AS supplier_id,
       i.buyer_id     AS buyer_id,
       i.face_value   AS face_value,
       i.created_at   AS aml_flagged_at,
       i.created_at   AS created_at,
       FLOOR(EXTRACT(EPOCH FROM (NOW() - i.created_at)) / 86400)::int
                      AS days_flagged
     FROM invoices i
     WHERE i.aml_flagged = true
       AND i.aml_cleared_at IS NULL
     ORDER BY i.created_at ASC`,
    [],
  );
  return result.rows;
}

// =========================================================================
// Detail view — encrypted PII included; service decrypts + audits
// =========================================================================

/**
 * Fetch a single AML-flagged invoice with encrypted company names alongside
 * the clearance status. The caller MUST write an `AML_DETAIL_VIEWED` audit
 * entry whenever the encrypted columns are decrypted (PDPA 2019).
 */
export async function getAmlDetail(invoiceId: string): Promise<AmlDetailRow | null> {
  const result = await query<AmlDetailRow>(
    `SELECT
       i.id                          AS invoice_id,
       i.supplier_id                 AS supplier_id,
       i.buyer_id                    AS buyer_id,
       i.face_value                  AS face_value,
       i.aml_flagged                 AS aml_flagged,
       i.aml_cleared_at              AS aml_cleared_at,
       i.aml_cleared_by              AS aml_cleared_by,
       i.aml_clearance_reason        AS aml_clearance_reason,
       i.status                      AS status,
       i.created_at                  AS created_at,
       s.company_name_encrypted      AS supplier_company_name_encrypted,
       b.company_name_encrypted      AS buyer_company_name_encrypted,
       i.invoice_number              AS invoice_number
     FROM invoices i
     LEFT JOIN suppliers s ON s.id = i.supplier_id
     LEFT JOIN buyers    b ON b.id = i.buyer_id
     WHERE i.id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Invoice clearance state — for service-side immutability check
// =========================================================================

/** Read just the columns needed to evaluate refinement 3 (no re-clearance). */
export async function getInvoiceClearanceState(
  invoiceId: string,
): Promise<InvoiceClearanceState | null> {
  const result = await query<InvoiceClearanceState>(
    `SELECT id, aml_flagged, aml_cleared_at
     FROM invoices
     WHERE id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Mutating writes — transactional only
// =========================================================================

/**
 * Apply the three-column clearance atomically inside a transaction.
 * The DB CHECK constraint `invoices_aml_clearance_complete` enforces
 * atomicity at the storage layer too (refinement 1).
 */
export async function applyAmlClearanceWithClient(
  client: PoolClient,
  invoiceId: string,
  officerId: string,
  reason: string,
): Promise<{ aml_cleared_at: string } | null> {
  const result = await client.query<{ aml_cleared_at: string }>(
    `UPDATE invoices
     SET aml_cleared_at       = NOW(),
         aml_cleared_by       = $1,
         aml_clearance_reason = $2,
         updated_at           = NOW()
     WHERE id = $3
       AND aml_flagged = true
       AND aml_cleared_at IS NULL
     RETURNING aml_cleared_at`,
    [officerId, reason, invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Audit log writers
// =========================================================================

/**
 * Insert an audit log entry within a transaction.
 * Mirrors the canonical signature used in payments.repository to avoid
 * importing across modules; metadata MUST NOT include `reason` (Rule 3).
 */
export async function createAuditEntryWithClient(
  client: PoolClient,
  userId: string | null,
  action: string,
  tableName: string,
  recordId: string,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      action,
      tableName,
      recordId,
      JSON.stringify(oldValues),
      JSON.stringify(newValues),
      ipAddress ?? null,
      userAgent ?? null,
    ],
  );
}

/**
 * Insert an audit log entry outside any transaction. Used for the
 * AML_DETAIL_VIEWED read-event log emitted from the detail endpoint.
 */
export async function createAuditEntry(
  userId: string | null,
  action: string,
  tableName: string,
  recordId: string,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      action,
      tableName,
      recordId,
      JSON.stringify(oldValues),
      JSON.stringify(newValues),
      ipAddress ?? null,
      userAgent ?? null,
    ],
  );
}
