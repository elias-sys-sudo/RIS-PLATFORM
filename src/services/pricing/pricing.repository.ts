import { query } from '../../shared/database/pool';
import type { PoolClient } from 'pg';
import type {
  InvoiceForPricing,
  RiskScoreForPricing,
  FacilityForPricing,
  BuyerMargin,
  PricingUpdate,
  PricingDisputeRecord,
} from './pricing.types';

// =========================================================================
// Invoice lookup
// =========================================================================

/**
 * Fetch invoice fields needed for pricing.
 */
export async function getInvoiceForPricing(invoiceId: string): Promise<InvoiceForPricing | null> {
  const result = await query<InvoiceForPricing>(
    `SELECT id, face_value::text, tenor_days,
            status, buyer_id, due_date::text
     FROM invoices WHERE id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Risk score lookup
// =========================================================================

/**
 * Fetch the risk score for pricing calculations.
 */
export async function getRiskScoreForPricing(
  invoiceId: string,
): Promise<RiskScoreForPricing | null> {
  const result = await query<RiskScoreForPricing>(
    `SELECT id, invoice_id,
            max_advance_pct::text,
            risk_premium_rate::text,
            bank_cost_rate::text
     FROM risk_scores WHERE invoice_id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Bank facility lookup
// =========================================================================

/**
 * Fetch the active bank facility with the best interest rate.
 */
export async function getActiveFacility(): Promise<FacilityForPricing | null> {
  const result = await query<FacilityForPricing>(
    `SELECT id, facility_name,
            interest_rate_annual::text
     FROM bank_facilities
     WHERE is_active = true
       AND maturity_date > NOW()
     ORDER BY interest_rate_annual ASC
     LIMIT 1`,
    [],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Buyer margin lookup
// =========================================================================

/**
 * Fetch the buyer-specific RIS margin rate.
 */
export async function getBuyerRisMargin(buyerId: string): Promise<BuyerMargin | null> {
  const result = await query<BuyerMargin>(
    `SELECT ris_margin_rate::text
     FROM buyers WHERE id = $1`,
    [buyerId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Pricing details (read endpoint)
// =========================================================================

export interface PricingDetailsRow {
  id: string;
  invoice_id: string;
  bank_cost_rate: string;
  ris_margin_rate: string;
  risk_premium_rate: string;
  total_discount_rate: string;
  max_advance_pct: string;
  advance_amount: string;
  discount_amount: string;
  net_payment_to_supplier: string;
  face_value: string;
  tenor_days: number;
  due_date: string;
}

/**
 * Fetch full pricing details for an invoice (read endpoint).
 */
export async function getPricingDetails(invoiceId: string): Promise<PricingDetailsRow | null> {
  const result = await query<PricingDetailsRow>(
    `SELECT rs.id, rs.invoice_id,
            rs.bank_cost_rate::text,
            rs.ris_margin_rate::text,
            rs.risk_premium_rate::text,
            rs.total_discount_rate::text,
            rs.max_advance_pct::text,
            rs.advance_amount::text,
            rs.discount_amount::text,
            rs.net_payment_to_supplier::text,
            i.face_value::text,
            i.tenor_days,
            i.due_date::text
     FROM risk_scores rs
     JOIN invoices i ON i.id = rs.invoice_id
     WHERE rs.invoice_id = $1
       AND rs.bank_cost_rate IS NOT NULL`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Pricing persistence (within transaction)
// =========================================================================

/**
 * Update risk_scores with pricing data (transactional).
 */
export async function updateRiskScoreWithPricing(
  client: PoolClient,
  riskScoreId: string,
  data: PricingUpdate,
): Promise<void> {
  await client.query(
    `UPDATE risk_scores
     SET bank_cost_rate = $1,
         ris_margin_rate = $2,
         total_discount_rate = $3,
         advance_amount = $4,
         discount_amount = $5,
         net_payment_to_supplier = $6
     WHERE id = $7`,
    [
      data.bank_cost_rate,
      data.ris_margin_rate,
      data.total_discount_rate,
      data.advance_amount,
      data.discount_amount,
      data.net_payment_to_supplier,
      riskScoreId,
    ],
  );
}

/**
 * Update invoice with pricing amounts (transactional).
 */
export async function updateInvoiceWithPricing(
  client: PoolClient,
  invoiceId: string,
  data: Pick<PricingUpdate, 'advance_amount' | 'discount_amount' | 'net_payment_to_supplier'>,
): Promise<void> {
  await client.query(
    `UPDATE invoices
     SET advance_amount = $1,
         discount_amount = $2,
         net_payment_to_supplier = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [data.advance_amount, data.discount_amount, data.net_payment_to_supplier, invoiceId],
  );
}

// =========================================================================
// Invoice status update (within transaction)
// =========================================================================

/**
 * Update invoice status atomically, guarded by expected current status.
 */
export async function updateInvoiceStatusWithClient(
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
// Pricing acceptance status lookup
// =========================================================================

export interface PricingAcceptanceRow {
  id: string;
  status: string;
  supplier_id: string;
  pricing_accepted_at: string | null;
  pricing_rejected_at: string | null;
  pricing_disputed_at: string | null;
  advance_amount: string | null;
}

/**
 * Fetch invoice pricing acceptance/rejection/dispute state.
 */
export async function getInvoicePricingStatus(
  invoiceId: string,
  supplierId: string,
): Promise<PricingAcceptanceRow | null> {
  const result = await query<PricingAcceptanceRow>(
    `SELECT id, status, supplier_id,
            pricing_accepted_at::text,
            pricing_rejected_at::text,
            pricing_disputed_at::text,
            advance_amount::text
     FROM invoices
     WHERE id = $1 AND supplier_id = $2`,
    [invoiceId, supplierId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Accept pricing (transactional)
// =========================================================================

/**
 * Mark invoice pricing as accepted by supplier.
 */
export async function acceptPricingWithClient(
  client: PoolClient,
  invoiceId: string,
  userId: string,
): Promise<void> {
  await client.query(
    `UPDATE invoices
     SET pricing_accepted_at = NOW(),
         pricing_accepted_by = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [userId, invoiceId],
  );
}

// =========================================================================
// Reject pricing (transactional)
// =========================================================================

/**
 * Mark invoice pricing as rejected by supplier.
 */
export async function rejectPricingWithClient(
  client: PoolClient,
  invoiceId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `UPDATE invoices
     SET pricing_rejected_at = NOW(),
         pricing_rejection_reason = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [reason, invoiceId],
  );
}

// =========================================================================
// Pricing dispute (transactional)
// =========================================================================

/**
 * Set pricing_disputed_at on the invoice (within transaction).
 */
export async function setDisputedAtWithClient(
  client: PoolClient,
  invoiceId: string,
): Promise<void> {
  await client.query(
    `UPDATE invoices
     SET pricing_disputed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [invoiceId],
  );
}

/**
 * Insert a pricing dispute record (within transaction).
 * Returns the newly created dispute row.
 */
export async function createPricingDisputeWithClient(
  client: PoolClient,
  invoiceId: string,
  submittedBy: string,
  reason: string,
  proposedRate: number | null,
  proposedAdvancePct: number | null,
  notes: string | null,
  slaDeadline: Date,
): Promise<PricingDisputeRecord> {
  const result = await client.query<PricingDisputeRecord>(
    `INSERT INTO pricing_disputes
       (invoice_id, submitted_by, reason,
        proposed_rate, proposed_advance_pct,
        notes, sla_deadline)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING
       id, invoice_id, submitted_by, reason,
       proposed_rate::text,
       proposed_advance_pct::text,
       notes,
       submitted_at::text, sla_deadline::text,
       status,
       resolved_at::text, resolved_by, resolution_notes`,
    [
      invoiceId,
      submittedBy,
      reason,
      proposedRate ?? null,
      proposedAdvancePct ?? null,
      notes ?? null,
      slaDeadline.toISOString(),
    ],
  );
  return result.rows[0];
}

/**
 * Fetch the open pricing dispute for an invoice (if any).
 */
export async function getOpenPricingDispute(
  invoiceId: string,
): Promise<PricingDisputeRecord | null> {
  const result = await query<PricingDisputeRecord>(
    `SELECT id, invoice_id, submitted_by, reason,
            proposed_rate::text,
            proposed_advance_pct::text,
            notes,
            submitted_at::text, sla_deadline::text,
            status,
            resolved_at::text, resolved_by, resolution_notes
     FROM pricing_disputes
     WHERE invoice_id = $1
       AND status = 'open'
     ORDER BY submitted_at DESC
     LIMIT 1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Audit logging (within transaction)
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
