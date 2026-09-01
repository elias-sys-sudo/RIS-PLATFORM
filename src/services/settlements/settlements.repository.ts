// ============================================================
// settlements.repository.ts — All SQL, parameterised only
// ============================================================

import type { PoolClient } from 'pg';
import { pool } from '../../shared/database/pool';
import type {
  SettlementRecord,
  EnrichedSettlement,
  ProfitBookingRecord,
  SettlementSummary,
  DashboardRow,
} from './settlements.types';

// =========================================================================
// Settlements — WithClient variants for transactional use
// =========================================================================

/**
 * INSERT a settlement row. If `idempotency_key` already exists (retried BullMQ
 * job, concurrent enqueue), no row is inserted and the existing row is fetched
 * and returned — the caller gets the same SettlementRecord either way, so a
 * worker retry never produces a duplicate disbursement.
 */
export async function createSettlementWithClient(
  client: PoolClient,
  id: string,
  invoiceId: string,
  collectionId: string,
  drawdownId: string | null,
  buyerPaymentAmount: string,
  facilityRepaymentAmount: string,
  accruedInterest: string,
  penaltyIncome: string,
  idempotencyKey: string,
): Promise<SettlementRecord> {
  const { rows } = await client.query<SettlementRecord>(
    `INSERT INTO settlements
       (id, invoice_id, collection_id, drawdown_id,
        buyer_payment_amount, facility_repayment_amount,
        accrued_interest, penalty_income, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [
      id,
      invoiceId,
      collectionId,
      drawdownId,
      buyerPaymentAmount,
      facilityRepaymentAmount,
      accruedInterest,
      penaltyIncome,
      idempotencyKey,
    ],
  );
  const inserted = rows[0] ?? null;
  if (inserted !== null) return inserted;
  // Conflict — same idempotency_key already present. Read it back inside the
  // same client so the result is consistent with this transaction's view.
  const existing = await client.query<SettlementRecord>(
    `SELECT * FROM settlements WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return existing.rows[0];
}

export async function updateSettlementStatusWithClient(
  client: PoolClient,
  id: string,
  status: string,
  settledBy: string | null,
): Promise<SettlementRecord | null> {
  const { rows } = await client.query<SettlementRecord>(
    `UPDATE settlements
     SET status = $1,
         settled_by = COALESCE($2, settled_by),
         settled_at = CASE WHEN $1 = 'closed' THEN NOW() ELSE settled_at END,
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [status, settledBy, id],
  );
  return rows[0] ?? null;
}

export async function updateNetProfitWithClient(
  client: PoolClient,
  id: string,
  netProfit: string,
): Promise<void> {
  await client.query(`UPDATE settlements SET net_profit = $1, updated_at = NOW() WHERE id = $2`, [
    netProfit,
    id,
  ]);
}

export async function updateFacilityRepaymentWithClient(
  client: PoolClient,
  id: string,
  facilityRepaymentAmount: string,
  accruedInterest: string,
): Promise<void> {
  await client.query(
    `UPDATE settlements
     SET facility_repayment_amount = $1,
         accrued_interest = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [facilityRepaymentAmount, accruedInterest, id],
  );
}

// =========================================================================
// Profit bookings — WithClient (immutable, INSERT only)
// =========================================================================

export async function createProfitBookingWithClient(
  client: PoolClient,
  id: string,
  settlementId: string,
  discountEarned: string,
  bankCostPaid: string,
  penaltyIncome: string,
  netProfit: string,
  bookedBy: string,
): Promise<ProfitBookingRecord> {
  const { rows } = await client.query<ProfitBookingRecord>(
    `INSERT INTO profit_bookings
       (id, settlement_id, discount_earned, bank_cost_paid,
        penalty_income, net_profit, booked_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, settlementId, discountEarned, bankCostPaid, penaltyIncome, netProfit, bookedBy],
  );
  return rows[0];
}

// =========================================================================
// Read operations — standalone (pool)
// =========================================================================

export async function getSettlementById(id: string): Promise<SettlementRecord | null> {
  const { rows } = await pool.query<SettlementRecord>(`SELECT * FROM settlements WHERE id = $1`, [
    id,
  ]);
  return rows[0] ?? null;
}

/**
 * Get a settlement enriched with invoice / supplier / buyer / drawdown
 * details so the frontend's 4-step lifecycle UI has everything it needs.
 */
export async function getEnrichedSettlementById(id: string): Promise<EnrichedSettlement | null> {
  const { rows } = await pool.query<EnrichedSettlement>(
    `SELECT
       s.*,
       COALESCE(i.invoice_number, '') AS invoice_number,
       COALESCE(sup.company_name, '') AS supplier_name,
       COALESCE(b.company_name, '') AS buyer_name,
       COALESCE(i.face_value::text, '0') AS face_value,
       COALESCE(i.advance_amount::text, '0') AS advance_amount,
       fd.principal::text AS drawdown_principal
     FROM settlements s
     LEFT JOIN invoices i ON i.id = s.invoice_id
     LEFT JOIN suppliers sup ON sup.id = i.supplier_id
     LEFT JOIN buyers b ON b.id = i.buyer_id
     LEFT JOIN facility_drawdowns fd ON fd.id = s.drawdown_id
     WHERE s.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getSettlementByInvoiceId(
  invoiceId: string,
): Promise<SettlementRecord | null> {
  const { rows } = await pool.query<SettlementRecord>(
    `SELECT * FROM settlements WHERE invoice_id = $1`,
    [invoiceId],
  );
  return rows[0] ?? null;
}

export async function getSettlementByIdempotencyKey(
  idempotencyKey: string,
): Promise<SettlementRecord | null> {
  const { rows } = await pool.query<SettlementRecord>(
    `SELECT * FROM settlements WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return rows[0] ?? null;
}

export async function listSettlements(
  page: number,
  limit: number,
): Promise<{ data: SettlementSummary[]; total: number }> {
  const offset = (page - 1) * limit;

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM settlements`,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const { rows } = await pool.query<SettlementSummary>(
    `SELECT s.id,
            s.invoice_id,
            COALESCE(i.invoice_number, '') AS invoice_number,
            COALESCE(sup.company_name, '') AS supplier_name,
            COALESCE(b.company_name, '') AS buyer_name,
            s.buyer_payment_amount,
            s.facility_repayment_amount,
            s.net_profit,
            s.status,
            s.settled_at,
            s.created_at
     FROM settlements s
     LEFT JOIN invoices i ON i.id = s.invoice_id
     LEFT JOIN suppliers sup ON sup.id = i.supplier_id
     LEFT JOIN buyers b ON b.id = i.buyer_id
     ORDER BY s.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return { data: rows, total };
}

export async function getProfitBookingBySettlementId(
  settlementId: string,
): Promise<ProfitBookingRecord | null> {
  const { rows } = await pool.query<ProfitBookingRecord>(
    `SELECT * FROM profit_bookings WHERE settlement_id = $1`,
    [settlementId],
  );
  return rows[0] ?? null;
}

// =========================================================================
// Dashboard aggregation — read-only, no transaction
// =========================================================================

/**
 * Aggregate metrics for the management/finance/auditor settlement dashboard.
 * Single parameterised query, all BigInt money fields cast to TEXT so the
 * driver returns strings (matches the wider BigInt-as-string convention).
 */
export async function getDashboardMetrics(
  periodStart: Date,
  periodEnd: Date,
): Promise<DashboardRow> {
  const { rows } = await pool.query<DashboardRow>(
    `SELECT
       COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::TEXT
         AS total_settlements,
       COALESCE(
         SUM(net_profit::numeric)
           FILTER (WHERE (status = 'profit_booked' OR status = 'closed')
                    AND created_at >= $1 AND created_at < $2),
         0
       )::TEXT AS total_profit_booked,
       COALESCE(
         SUM(facility_repayment_amount::numeric)
           FILTER (WHERE status IN ('facility_repaid', 'profit_booked', 'closed')
                    AND created_at >= $1 AND created_at < $2),
         0
       )::TEXT AS total_facility_repayment,
       COUNT(*) FILTER (WHERE status = 'pending'
                          AND created_at >= $1 AND created_at < $2)::TEXT
         AS pending_count,
       COALESCE(
         AVG(net_profit::numeric)
           FILTER (WHERE (status = 'profit_booked' OR status = 'closed')
                    AND created_at >= $1 AND created_at < $2),
         0
       )::TEXT AS avg_profit_per_invoice
     FROM settlements`,
    [periodStart, periodEnd],
  );
  return rows[0];
}

// =========================================================================
// Audit — WithClient for transactional use
// =========================================================================

export async function createAuditEntryWithClient(
  client: PoolClient,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown> | null,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
       (user_id, action, entity_type, entity_id,
        old_values, new_values, ip_address, user_agent, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      userId,
      action,
      entityType,
      entityId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ipAddress,
      userAgent,
    ],
  );
}
