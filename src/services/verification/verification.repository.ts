import { query, pool } from '../../shared/database/pool';
import type { PoolClient } from 'pg';
import type {
  InvoiceConfirmationRow,
  ConfirmationPageRow,
  PendingConfirmationRow,
  ReminderCheckRow,
  BuyerContact,
  DisputeRecord,
} from './verification.types';
import type { PaginationParams } from '../invoices/invoices.types';

// =========================================================================
// Token management
// =========================================================================

/**
 * Store a confirmation token hash and expiry on an invoice.
 * Overwrites any existing token (used for resend).
 */
export async function storeConfirmationToken(
  invoiceId: string,
  tokenHash: string,
  expiresAt: string,
): Promise<void> {
  await query(
    `UPDATE invoices
     SET confirmation_token_hash = $1,
         confirmation_token_expires_at = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [tokenHash, expiresAt, invoiceId],
  );
}

/**
 * Find an invoice by its confirmation token hash.
 * Uses idx_invoices_confirmation_token_hash index.
 */
export async function findInvoiceByTokenHash(
  tokenHash: string,
): Promise<InvoiceConfirmationRow | null> {
  const result = await query<InvoiceConfirmationRow>(
    `SELECT id, invoice_number, supplier_id, buyer_id,
            face_value, due_date, description, status,
            confirmation_token_hash, confirmation_token_expires_at,
            buyer_confirmed_at, created_at,
            ura_efris_ref, efris_verified_at
     FROM invoices
     WHERE confirmation_token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

/**
 * Record buyer confirmation on an invoice.
 * Uses WHERE buyer_confirmed_at IS NULL for race-condition safety.
 * Returns the number of rows affected (0 = already confirmed).
 */
export async function confirmInvoice(
  invoiceId: string,
  ip: string,
  userAgent: string,
): Promise<number> {
  const result = await query(
    `UPDATE invoices
     SET buyer_confirmed_at = NOW(),
         buyer_confirmation_ip = $1,
         buyer_confirmation_user_agent = $2,
         status = 'buyer_confirmed',
         updated_at = NOW()
     WHERE id = $3
       AND buyer_confirmed_at IS NULL`,
    [ip, userAgent, invoiceId],
  );
  return result.rowCount ?? 0;
}

// =========================================================================
// Invoice lookups
// =========================================================================

/**
 * Fetch invoice display data for the public confirmation page.
 * Joins to suppliers for company_name.
 */
export async function findInvoiceForConfirmationPage(
  invoiceId: string,
): Promise<ConfirmationPageRow | null> {
  const result = await query<ConfirmationPageRow>(
    `SELECT i.invoice_number, i.face_value, i.due_date,
            i.description, s.company_name AS supplier_name,
            b.company_name AS buyer_name
     FROM invoices i
     JOIN suppliers s ON s.id = i.supplier_id
     JOIN buyers b ON b.id = i.buyer_id
     WHERE i.id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

/**
 * Find invoice by primary key (for resend validation).
 */
export async function findInvoiceById(id: string): Promise<InvoiceConfirmationRow | null> {
  const result = await query<InvoiceConfirmationRow>(
    `SELECT id, invoice_number, supplier_id, buyer_id,
            face_value, due_date, description, status,
            confirmation_token_hash, confirmation_token_expires_at,
            buyer_confirmed_at, created_at,
            ura_efris_ref, efris_verified_at
     FROM invoices
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Admin queries
// =========================================================================

/**
 * List invoices pending buyer confirmation with pagination.
 */
export async function findPendingConfirmations(
  pagination: PaginationParams,
): Promise<{ rows: PendingConfirmationRow[]; total: number }> {
  const offset = (pagination.page - 1) * pagination.limit;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM invoices
     WHERE status = 'submitted'
       AND buyer_confirmed_at IS NULL`,
    [],
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const dataResult = await query<PendingConfirmationRow>(
    `SELECT i.id, i.invoice_number, i.face_value, i.due_date,
            i.created_at AS submitted_at,
            s.company_name AS supplier_name,
            b.company_name AS buyer_name,
            EXTRACT(EPOCH FROM (NOW() - i.created_at)) / 3600
              AS hours_since_submission
     FROM invoices i
     JOIN suppliers s ON s.id = i.supplier_id
     JOIN buyers b ON b.id = i.buyer_id
     WHERE i.status = 'submitted'
       AND i.buyer_confirmed_at IS NULL
     ORDER BY i.created_at ASC
     LIMIT $1 OFFSET $2`,
    [pagination.limit, offset],
  );

  return { rows: dataResult.rows, total };
}

// =========================================================================
// Buyer contact
// =========================================================================

/**
 * Fetch encrypted buyer contact details for notification.
 */
export async function findBuyerEncryptedContact(buyerId: string): Promise<BuyerContact | null> {
  const result = await query<BuyerContact>(
    `SELECT contact_email_encrypted,
            contact_phone_encrypted,
            company_name
     FROM buyers
     WHERE id = $1`,
    [buyerId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Reminder queries
// =========================================================================

/**
 * Find invoices needing reminders in a time window.
 * Returns invoices submitted between minHours and maxHours ago
 * that are still in 'submitted' status without confirmation.
 */
export async function findInvoicesPendingReminder(
  minHours: number,
  maxHours: number,
): Promise<ReminderCheckRow[]> {
  const result = await query<ReminderCheckRow>(
    `SELECT i.id, i.buyer_id, i.invoice_number, i.face_value,
            i.created_at, b.contact_email_encrypted
     FROM invoices i
     JOIN buyers b ON b.id = i.buyer_id
     WHERE i.status = 'submitted'
       AND i.buyer_confirmed_at IS NULL
       AND i.created_at <= NOW() - MAKE_INTERVAL(hours => $1)
       AND i.created_at > NOW() - MAKE_INTERVAL(hours => $2)`,
    [minHours, maxHours],
  );
  return result.rows;
}

/**
 * Check whether a specific reminder has already been sent
 * for an invoice by looking for the action in audit_logs.
 */
export async function hasReminderBeenSent(invoiceId: string, action: string): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM audit_logs
     WHERE record_id = $1
       AND action = $2`,
    [invoiceId, action],
  );
  const count = parseInt(result.rows[0]?.count ?? '0', 10);
  return count > 0;
}

// =========================================================================
// Audit
// =========================================================================

/**
 * Write an audit log entry for a verification event.
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
 * Store confirmation token within a transaction.
 */
export async function storeConfirmationTokenWithClient(
  client: PoolClient,
  invoiceId: string,
  tokenHash: string,
  expiresAt: string,
): Promise<void> {
  await client.query(
    `UPDATE invoices
     SET confirmation_token_hash = $1,
         confirmation_token_expires_at = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [tokenHash, expiresAt, invoiceId],
  );
}

/**
 * Confirm invoice within a transaction.
 */
export async function confirmInvoiceWithClient(
  client: PoolClient,
  invoiceId: string,
  ip: string,
  userAgent: string,
): Promise<number> {
  // efris_verified_at is set at this transition because buyer confirmation
  // only succeeds after verifyEfris() has been called in the service layer.
  const result = await client.query(
    `UPDATE invoices
     SET buyer_confirmed_at = NOW(),
         buyer_confirmation_ip = $1,
         buyer_confirmation_user_agent = $2,
         status = 'buyer_confirmed',
         efris_verified_at = NOW(),
         updated_at = NOW()
     WHERE id = $3
       AND buyer_confirmed_at IS NULL`,
    [ip, userAgent, invoiceId],
  );
  return result.rowCount ?? 0;
}

/**
 * Insert audit log entry within a transaction.
 */
/**
 * Insert an invoice dispute record within a transaction.
 */
export async function createDisputeWithClient(
  client: PoolClient,
  invoiceId: string,
  buyerId: string,
  reason: string,
  disputeType: string,
): Promise<DisputeRecord> {
  const result = await client.query<DisputeRecord>(
    `INSERT INTO invoice_disputes
       (invoice_id, buyer_id, dispute_reason, dispute_type)
     VALUES ($1, $2, $3, $4)
     RETURNING id, invoice_id, buyer_id, dispute_reason,
               dispute_type, status, created_at::text`,
    [invoiceId, buyerId, reason, disputeType],
  );
  return result.rows[0];
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
