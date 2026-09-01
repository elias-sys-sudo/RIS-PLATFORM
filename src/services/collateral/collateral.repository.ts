// =============================================================================
// Collateral — Repository (all SQL lives here, parameterised queries only)
// =============================================================================

import { query, pool, beginWithRls } from '../../shared/database/pool';
import { ValidationError } from '../../shared/errors';
import type {
  CollateralRecord,
  CollateralDocumentRef,
  CreateCollateralInput,
} from './collateral.types';

/**
 * Column allowlist for updateCollateral().
 * Only these columns may appear in the SET clause — prevents SQL column injection.
 */
const COLLATERAL_UPDATABLE_COLUMNS = new Set([
  'collateral_type',
  'description',
  'value',
  'currency',
  'expiry_date',
  'is_active',
  'enforceability_status',
]);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Insert a new collateral record with document references.
 * Uses a transaction for multi-table insert.
 */
export async function createCollateral(
  id: string,
  supplierId: string,
  input: CreateCollateralInput,
): Promise<CollateralRecord> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    const result = await client.query<CollateralRecord>(
      `INSERT INTO collateral
         (id, invoice_id, supplier_id, collateral_type,
          value, description, currency, expiry_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        id,
        input.invoice_id,
        supplierId,
        input.type,
        input.estimated_value,
        input.description,
        input.currency,
        input.expiry_date ?? null,
      ],
    );

    for (const docId of input.documents) {
      await client.query(
        `INSERT INTO collateral_documents (collateral_id, document_id)
         VALUES ($1, $2)`,
        [id, docId],
      );
    }

    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Get a single collateral by ID (excludes soft-deleted).
 */
export async function getCollateralById(id: string): Promise<CollateralRecord | null> {
  const result = await query<CollateralRecord>(
    `SELECT * FROM collateral
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Get collateral documents for a collateral record.
 */
export async function getCollateralDocuments(
  collateralId: string,
): Promise<CollateralDocumentRef[]> {
  const result = await query<CollateralDocumentRef>(
    `SELECT id, document_id, created_at
     FROM collateral_documents
     WHERE collateral_id = $1`,
    [collateralId],
  );
  return result.rows;
}

/**
 * List collateral for an invoice (paginated, excludes soft-deleted).
 */
export async function listByInvoice(
  invoiceId: string,
  page: number,
  limit: number,
): Promise<{ data: CollateralRecord[]; total: number }> {
  const offset = (page - 1) * limit;

  const countResult = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM collateral
     WHERE invoice_id = $1 AND deleted_at IS NULL`,
    [invoiceId],
  );

  const dataResult = await query<CollateralRecord>(
    `SELECT * FROM collateral
     WHERE invoice_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [invoiceId, limit, offset],
  );

  return {
    data: dataResult.rows,
    total: Number(countResult.rows[0].total),
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Update collateral fields. Returns updated record.
 */
export async function updateCollateral(
  id: string,
  fields: Record<string, unknown>,
): Promise<CollateralRecord | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(fields)) {
    if (!COLLATERAL_UPDATABLE_COLUMNS.has(key)) {
      throw new ValidationError(`Column '${key}' is not updatable`);
    }
    setClauses.push(`${key} = $${idx}`);
    params.push(value);
    idx++;
  }

  setClauses.push(`updated_at = NOW()`);
  params.push(id);

  const result = await query<CollateralRecord>(
    `UPDATE collateral
     SET ${setClauses.join(', ')}
     WHERE id = $${idx} AND deleted_at IS NULL
     RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

/**
 * Replace document references for a collateral record.
 */
export async function replaceDocuments(collateralId: string, documentIds: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await beginWithRls(client);

    await client.query(`DELETE FROM collateral_documents WHERE collateral_id = $1`, [collateralId]);

    for (const docId of documentIds) {
      await client.query(
        `INSERT INTO collateral_documents (collateral_id, document_id)
         VALUES ($1, $2)`,
        [collateralId, docId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

/**
 * Soft delete a collateral record (set deleted_at).
 */
export async function softDelete(id: string): Promise<CollateralRecord | null> {
  const result = await query<CollateralRecord>(
    `UPDATE collateral
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id],
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Invoice queries
// ---------------------------------------------------------------------------

/**
 * Get invoice status for business rule validation.
 */
export async function getInvoiceStatus(
  invoiceId: string,
): Promise<{ status: string; supplier_id: string } | null> {
  const result = await query<{ status: string; supplier_id: string }>(
    `SELECT status, supplier_id FROM invoices WHERE id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

/**
 * Validate user has access to the invoice's supplier.
 */
export async function validateInvoiceAccess(
  invoiceId: string,
  userId: string,
  role: string,
): Promise<boolean> {
  if (role !== 'supplier') {
    return true;
  }

  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM invoices i
       JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.id = $1 AND s.user_id = $2
     ) AS exists`,
    [invoiceId, userId],
  );
  return result.rows[0]?.exists ?? false;
}

// ---------------------------------------------------------------------------
// Coverage check
// ---------------------------------------------------------------------------

/**
 * Get total active collateral value for an invoice (SUM of value where active).
 */
export async function getTotalCollateralValueForInvoice(invoiceId: string): Promise<string> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(value), 0)::text AS total
     FROM collateral
     WHERE invoice_id = $1
       AND is_active = true
       AND deleted_at IS NULL`,
    [invoiceId],
  );
  return rows[0].total;
}

/**
 * Get collateral items expiring within a given number of days.
 */
export async function getExpiringCollateral(daysAhead: number): Promise<CollateralRecord[]> {
  const { rows } = await pool.query<CollateralRecord>(
    `SELECT *
     FROM collateral
     WHERE is_active = true
       AND deleted_at IS NULL
       AND expiry_date IS NOT NULL
       AND expiry_date <= NOW() + ($1 || ' days')::INTERVAL
       AND expiry_date > NOW()
     ORDER BY expiry_date ASC`,
    [daysAhead],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

/**
 * Insert audit log entry for collateral actions.
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
       (user_id, action, table_name, record_id,
        old_values, new_values, ip_address, user_agent)
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
