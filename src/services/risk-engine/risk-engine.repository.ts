import { query, pool } from '../../shared/database/pool';
import type { PoolClient } from 'pg';
import type {
  InvoiceForScoring,
  BuyerForScoring,
  TrackRecordResult,
  BuyerUtilisation,
  CollateralForScoring,
  RiskScoreInsert,
  RiskScoreRecord,
} from './risk-engine.types';

// =========================================================================
// Invoice & buyer lookups
// =========================================================================

/**
 * Fetch the invoice fields needed for risk scoring.
 */
export async function findInvoiceForScoring(invoiceId: string): Promise<InvoiceForScoring | null> {
  const result = await query<InvoiceForScoring>(
    `SELECT id, invoice_number, face_value::text,
            tenor_days, status, buyer_id,
            supplier_id, aml_flagged
     FROM invoices WHERE id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch buyer fields needed for risk scoring.
 */
export async function findBuyerForScoring(buyerId: string): Promise<BuyerForScoring | null> {
  const result = await query<BuyerForScoring>(
    `SELECT id, credit_rating,
            approved_limit::text, used_limit::text,
            ris_margin_rate::text, payment_score
     FROM buyers WHERE id = $1`,
    [buyerId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Scoring data lookups
// =========================================================================

/**
 * Get supplier's track record from collections history.
 */
export async function getSupplierTrackRecord(supplierId: string): Promise<TrackRecordResult> {
  const result = await query<{
    invoice_count: string;
    collected_count: string;
    defaulted_count: string;
  }>(
    `SELECT
       COUNT(*)::text AS invoice_count,
       COUNT(*) FILTER (
         WHERE c.status = 'collected'
       )::text AS collected_count,
       COUNT(*) FILTER (
         WHERE c.status = 'defaulted'
       )::text AS defaulted_count
     FROM invoices i
     JOIN collections c ON c.invoice_id = i.id
     WHERE i.supplier_id = $1
       AND c.status IN ('collected', 'defaulted')`,
    [supplierId],
  );

  const row = result.rows[0];
  const total = parseInt(row?.invoice_count ?? '0', 10);
  const collected = parseInt(row?.collected_count ?? '0', 10);
  const defaults = parseInt(row?.defaulted_count ?? '0', 10);

  return {
    invoice_count: total,
    on_time_pct: total > 0 ? (collected / total) * 100 : 0,
    has_defaults: defaults > 0,
  };
}

/**
 * Calculate buyer utilisation: (used_limit + invoice face_value) / approved_limit.
 */
export async function getBuyerUtilisation(
  buyerId: string,
  invoiceAmount: string,
): Promise<BuyerUtilisation> {
  const result = await query<{
    used_limit: string;
    approved_limit: string;
  }>(
    `SELECT used_limit::text, approved_limit::text
     FROM buyers WHERE id = $1`,
    [buyerId],
  );

  const row = result.rows[0] as { used_limit: string; approved_limit: string } | undefined;
  if (row === undefined) {
    return {
      used_limit: '0',
      approved_limit: '0',
      projected_utilisation_pct: 100,
    };
  }

  const used = BigInt(row.used_limit);
  const approved = BigInt(row.approved_limit);
  const invoice = BigInt(invoiceAmount);

  const projectedPct = approved > 0n ? Number(((used + invoice) * 100n) / approved) : 100;

  return {
    used_limit: row.used_limit,
    approved_limit: row.approved_limit,
    projected_utilisation_pct: projectedPct,
  };
}

/**
 * Find the best active collateral for an invoice or supplier.
 * Prefers invoice-specific over supplier-level, ranked by type value.
 */
export async function findBestCollateral(
  invoiceId: string,
  supplierId: string,
): Promise<CollateralForScoring | null> {
  const result = await query<CollateralForScoring>(
    `SELECT collateral_type, value::text, is_active
     FROM collateral
     WHERE (invoice_id = $1 OR
            (supplier_id = $2 AND invoice_id IS NULL))
       AND is_active = true
     ORDER BY
       CASE collateral_type
         WHEN 'bank_guarantee' THEN 1
         WHEN 'fixed_deposit_lien' THEN 2
         WHEN 'post_dated_cheque_full_value' THEN 3
         WHEN 'corporate_guarantee' THEN 4
         WHEN 'none' THEN 5
       END,
       CASE WHEN invoice_id = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [invoiceId, supplierId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Risk score persistence
// =========================================================================

/**
 * Insert a risk score row. Pricing fields left NULL for Module 6.
 */
export async function saveRiskScore(data: RiskScoreInsert): Promise<void> {
  await query(
    `INSERT INTO risk_scores (
       id, invoice_id,
       buyer_credit_score, tenor_score,
       track_record_score, concentration_score,
       collateral_score, final_score,
       recommendation, max_advance_pct,
       risk_premium_rate, scored_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12
     )`,
    [
      data.id,
      data.invoice_id,
      data.buyer_credit_score,
      data.tenor_score,
      data.track_record_score,
      data.concentration_score,
      data.collateral_score,
      data.final_score,
      data.recommendation,
      data.max_advance_pct,
      data.risk_premium_rate,
      data.scored_by,
    ],
  );
}

/**
 * Fetch a risk score by invoice ID.
 */
export async function getRiskScoreByInvoiceId(invoiceId: string): Promise<RiskScoreRecord | null> {
  const result = await query<RiskScoreRecord>(
    `SELECT id, invoice_id,
            buyer_credit_score::text,
            tenor_score::text,
            track_record_score::text,
            concentration_score::text,
            collateral_score::text,
            final_score, recommendation,
            max_advance_pct::text,
            risk_premium_rate::text,
            scored_by, created_at::text
     FROM risk_scores WHERE invoice_id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Invoice status transition
// =========================================================================

/**
 * Update invoice status with optimistic concurrency.
 */
export async function updateInvoiceStatus(
  invoiceId: string,
  newStatus: string,
  expectedCurrentStatus: string,
): Promise<number> {
  const result = await query(
    `UPDATE invoices
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND status = $3`,
    [newStatus, invoiceId, expectedCurrentStatus],
  );
  return result.rowCount ?? 0;
}

// =========================================================================
// Audit logging
// =========================================================================

/**
 * Insert an immutable audit log entry.
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
// Transactional helpers
// =========================================================================

/**
 * Acquire a client from the pool for transactional work.
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/**
 * Insert risk score within a transaction.
 */
export async function saveRiskScoreWithClient(
  client: PoolClient,
  data: RiskScoreInsert,
): Promise<void> {
  await client.query(
    `INSERT INTO risk_scores (
       id, invoice_id,
       buyer_credit_score, tenor_score,
       track_record_score, concentration_score,
       collateral_score, final_score,
       recommendation, max_advance_pct,
       risk_premium_rate, scored_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12
     )`,
    [
      data.id,
      data.invoice_id,
      data.buyer_credit_score,
      data.tenor_score,
      data.track_record_score,
      data.concentration_score,
      data.collateral_score,
      data.final_score,
      data.recommendation,
      data.max_advance_pct,
      data.risk_premium_rate,
      data.scored_by,
    ],
  );
}

/**
 * Update invoice status within a transaction.
 */
export async function updateInvoiceStatusWithClient(
  client: PoolClient,
  invoiceId: string,
  newStatus: string,
  expectedCurrentStatus: string,
): Promise<number> {
  const result = await client.query(
    `UPDATE invoices
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND status = $3`,
    [newStatus, invoiceId, expectedCurrentStatus],
  );
  return result.rowCount ?? 0;
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
