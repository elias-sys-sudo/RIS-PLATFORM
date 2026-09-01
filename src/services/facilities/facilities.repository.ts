import { query } from '../../shared/database/pool';
import type { PoolClient } from 'pg';
import type {
  BankFacility,
  FacilityDrawdown,
  CreateDrawdownInput,
  RecordRepaymentInput,
} from './facilities.types';
import { FacilityStatus } from './facilities.types';

// =========================================================================
// Facility queries
// =========================================================================

/**
 * Fetch all facilities with active status.
 */
export async function getActiveFacilities(): Promise<BankFacility[]> {
  const result = await query<BankFacility>(
    `SELECT id, bank_name, total_limit::text,
            drawn_amount::text, available_amount::text,
            annual_rate::text, maturity_date,
            status, created_at, updated_at
     FROM bank_facilities
     WHERE status = $1
     ORDER BY bank_name ASC`,
    [FacilityStatus.ACTIVE],
  );
  return result.rows;
}

/**
 * Fetch a single facility by ID (non-transactional).
 */
export async function getFacilityById(facilityId: string): Promise<BankFacility | null> {
  const result = await query<BankFacility>(
    `SELECT id, bank_name, total_limit::text,
            drawn_amount::text, available_amount::text,
            annual_rate::text, maturity_date,
            status, created_at, updated_at
     FROM bank_facilities
     WHERE id = $1`,
    [facilityId],
  );
  return result.rows[0] ?? null;
}

/**
 * Aggregate interest accrued + defaulted exposure for one facility.
 * - interest_accrued: SUM(accrued_interest) across drawdowns not yet repaid.
 * - defaulted_exposure: SUM(principal) on drawdowns linked to invoices
 *   whose status = 'defaulted' (bank debt still owed despite supplier default).
 */
export async function getFacilityAggregates(
  facilityId: string,
): Promise<{ interest_accrued: string; defaulted_exposure: string }> {
  const result = await query<{ interest_accrued: string; defaulted_exposure: string }>(
    `SELECT
       COALESCE(SUM(fd.accrued_interest) FILTER (WHERE fd.status <> 'repaid'), 0)::text
         AS interest_accrued,
       COALESCE(SUM(fd.principal) FILTER (WHERE fd.status <> 'repaid' AND i.status = 'defaulted'), 0)::text
         AS defaulted_exposure
     FROM facility_drawdowns fd
     LEFT JOIN invoices i ON i.id = fd.invoice_id
     WHERE fd.facility_id = $1`,
    [facilityId],
  );
  return result.rows[0] ?? { interest_accrued: '0', defaulted_exposure: '0' };
}

/** Drawdown row shape used by the facility-detail endpoint. */
export interface DrawdownDetailRow {
  id: string;
  principal: string;
  invoice_number: string | null;
  created_at: string;
}

/**
 * Drawdowns against a facility, joined to invoice_number for display.
 * Most recent first. Returns [] when facility has no drawdowns.
 */
export async function getDrawdownsForFacility(facilityId: string): Promise<DrawdownDetailRow[]> {
  const result = await query<DrawdownDetailRow>(
    `SELECT fd.id, fd.principal::text,
            i.invoice_number AS invoice_number,
            fd.created_at
     FROM facility_drawdowns fd
     LEFT JOIN invoices i ON i.id = fd.invoice_id
     WHERE fd.facility_id = $1
     ORDER BY fd.created_at DESC`,
    [facilityId],
  );
  return result.rows;
}

/** Repayment row shape used by the facility-detail endpoint. */
export interface RepaymentDetailRow {
  id: string;
  total_amount: string;
  repaid_at: string;
}

/**
 * Repayments against a facility. Most recent first.
 */
export async function getRepaymentsForFacility(facilityId: string): Promise<RepaymentDetailRow[]> {
  const result = await query<RepaymentDetailRow>(
    `SELECT id, total_amount::text, repaid_at
     FROM facility_repayments
     WHERE facility_id = $1
     ORDER BY repaid_at DESC`,
    [facilityId],
  );
  return result.rows;
}

/**
 * Lock facility row with SELECT FOR UPDATE (transactional).
 */
export async function getFacilityByIdWithClient(
  client: PoolClient,
  facilityId: string,
): Promise<BankFacility | null> {
  const result = await client.query<BankFacility>(
    `SELECT id, bank_name, total_limit::text,
            drawn_amount::text, available_amount::text,
            annual_rate::text, maturity_date,
            status, created_at, updated_at
     FROM bank_facilities
     WHERE id = $1
     FOR UPDATE`,
    [facilityId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Drawdown CRUD
// =========================================================================

/**
 * Insert a drawdown record using a transaction client.
 */
export async function createDrawdownWithClient(
  client: PoolClient,
  data: CreateDrawdownInput,
): Promise<void> {
  await client.query(
    `INSERT INTO facility_drawdowns
       (id, facility_id, invoice_id, principal,
        bank_fees, status, last_accrued_date)
     VALUES ($1, $2, $3, $4, $5, 'active', CURRENT_DATE)`,
    [data.id, data.facilityId, data.invoiceId, data.principal, data.bankFees],
  );
}

/**
 * Fetch a drawdown by ID with lock (transactional).
 */
export async function getDrawdownByIdWithClient(
  client: PoolClient,
  drawdownId: string,
): Promise<FacilityDrawdown | null> {
  const result = await client.query<FacilityDrawdown>(
    `SELECT id, facility_id, invoice_id,
            principal::text, accrued_interest::text,
            bank_fees::text, status, last_accrued_date,
            created_at, updated_at
     FROM facility_drawdowns
     WHERE id = $1
     FOR UPDATE`,
    [drawdownId],
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch the active drawdown for a given invoice ID.
 */
export async function getDrawdownByInvoiceId(invoiceId: string): Promise<FacilityDrawdown | null> {
  const result = await query<FacilityDrawdown>(
    `SELECT id, facility_id, invoice_id,
            principal::text, accrued_interest::text,
            bank_fees::text, status, last_accrued_date,
            created_at, updated_at
     FROM facility_drawdowns
     WHERE invoice_id = $1 AND status = 'active'
     LIMIT 1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch all active drawdowns (for interest accrual).
 */
export async function getActiveDrawdowns(): Promise<FacilityDrawdown[]> {
  const result = await query<FacilityDrawdown>(
    `SELECT id, facility_id, invoice_id,
            principal::text, accrued_interest::text,
            bank_fees::text, status, last_accrued_date,
            created_at, updated_at
     FROM facility_drawdowns
     WHERE status = 'active'
     ORDER BY created_at ASC`,
    [],
  );
  return result.rows;
}

/**
 * Count active drawdowns for a facility.
 */
export async function getActiveDrawdownCount(facilityId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM facility_drawdowns
     WHERE facility_id = $1 AND status = 'active'`,
    [facilityId],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

// =========================================================================
// Facility updates
// =========================================================================

/**
 * Update drawn_amount and recalculate available_amount (transactional).
 */
export async function updateDrawnAmountWithClient(
  client: PoolClient,
  facilityId: string,
  newDrawnAmount: string,
): Promise<void> {
  await client.query(
    `UPDATE bank_facilities
     SET drawn_amount = $2,
         available_amount = total_limit - $2,
         updated_at = NOW()
     WHERE id = $1`,
    [facilityId, newDrawnAmount],
  );
}

/**
 * Update facility status (transactional).
 */
export async function updateFacilityStatusWithClient(
  client: PoolClient,
  facilityId: string,
  newStatus: string,
): Promise<void> {
  await client.query(
    `UPDATE bank_facilities
     SET status = $2, updated_at = NOW()
     WHERE id = $1`,
    [facilityId, newStatus],
  );
}

/**
 * Update facility status (non-transactional).
 */
export async function updateFacilityStatus(facilityId: string, newStatus: string): Promise<void> {
  await query(
    `UPDATE bank_facilities
     SET status = $2, updated_at = NOW()
     WHERE id = $1`,
    [facilityId, newStatus],
  );
}

// =========================================================================
// Interest accrual
// =========================================================================

/**
 * Add daily interest and update last_accrued_date (transactional).
 */
export async function accrueDailyInterestWithClient(
  client: PoolClient,
  drawdownId: string,
  interestAmount: string,
  accrualDate: string,
): Promise<void> {
  await client.query(
    `UPDATE facility_drawdowns
     SET accrued_interest = accrued_interest + $2,
         last_accrued_date = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [drawdownId, interestAmount, accrualDate],
  );
}

// =========================================================================
// Drawdown status update
// =========================================================================

/**
 * Update drawdown status (transactional).
 */
export async function updateDrawdownStatusWithClient(
  client: PoolClient,
  drawdownId: string,
  newStatus: string,
): Promise<void> {
  await client.query(
    `UPDATE facility_drawdowns
     SET status = $2, updated_at = NOW()
     WHERE id = $1`,
    [drawdownId, newStatus],
  );
}

// =========================================================================
// Repayment
// =========================================================================

/**
 * Insert a repayment record (transactional).
 */
export async function createRepaymentWithClient(
  client: PoolClient,
  data: RecordRepaymentInput,
): Promise<void> {
  await client.query(
    `INSERT INTO facility_repayments
       (id, drawdown_id, facility_id, principal,
        interest, bank_fees, total_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      data.id,
      data.drawdownId,
      data.facilityId,
      data.principal,
      data.interest,
      data.bankFees,
      data.totalAmount,
    ],
  );
}

// =========================================================================
// Maturity & utilisation queries
// =========================================================================

/**
 * Fetch active facilities maturing within the given days.
 */
export async function getFacilitiesNearMaturity(days: number): Promise<BankFacility[]> {
  const result = await query<BankFacility>(
    `SELECT id, bank_name, total_limit::text,
            drawn_amount::text, available_amount::text,
            annual_rate::text, maturity_date,
            status, created_at, updated_at
     FROM bank_facilities
     WHERE status = 'active'
       AND maturity_date <= CURRENT_DATE + INTERVAL '1 day' * $1
       AND maturity_date >= CURRENT_DATE
     ORDER BY maturity_date ASC`,
    [days],
  );
  return result.rows;
}

/**
 * Fetch active facilities above a utilisation threshold (percentage).
 */
export async function getFacilitiesByUtilisation(threshold: number): Promise<BankFacility[]> {
  const result = await query<BankFacility>(
    `SELECT id, bank_name, total_limit::text,
            drawn_amount::text, available_amount::text,
            annual_rate::text, maturity_date,
            status, created_at, updated_at
     FROM bank_facilities
     WHERE status = 'active'
       AND (drawn_amount::numeric / NULLIF(total_limit::numeric, 0)) * 100 >= $1
     ORDER BY (drawn_amount::numeric / NULLIF(total_limit::numeric, 0)) DESC`,
    [threshold],
  );
  return result.rows;
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
