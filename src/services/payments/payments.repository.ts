import { query } from '../../shared/database/pool';
import type { PoolClient } from 'pg';
import { PaymentStatus } from './payments.types';
import type {
  PaymentRecord,
  EnrichedPaymentRecord,
  InvoiceForPayment,
  SlaBreachPayment,
  CreatePaymentInput,
  PaymentProviderResult,
  OrphanedApprovedInvoice,
} from './payments.types';

// =========================================================================
// Create payment
// =========================================================================

/**
 * Insert a new payment record with idempotency key.
 */
export async function createPayment(data: CreatePaymentInput): Promise<void> {
  await query(
    `INSERT INTO payments
       (id, invoice_id, amount, provider, idempotency_key)
     VALUES ($1, $2, $3, $4, $5)`,
    [data.id, data.invoiceId, data.amount, data.provider, data.idempotencyKey],
  );
}

/**
 * Insert a new payment record with idempotency key (within a transaction).
 */
export async function createPaymentWithClient(
  client: PoolClient,
  data: CreatePaymentInput,
): Promise<void> {
  await client.query(
    `INSERT INTO payments
       (id, invoice_id, amount, provider, idempotency_key)
     VALUES ($1, $2, $3, $4, $5)`,
    [data.id, data.invoiceId, data.amount, data.provider, data.idempotencyKey],
  );
}

// =========================================================================
// Row-level locking for concurrent authorisation prevention
// =========================================================================

/**
 * Lock a payment row with FOR UPDATE NOWAIT inside a transaction.
 * Prevents concurrent authorisations on the same payment.
 * Caller must handle PostgreSQL error code 55P03 (LOCK_NOT_AVAILABLE).
 */
export async function getPaymentByIdForUpdate(
  client: PoolClient,
  paymentId: string,
): Promise<PaymentRecord | null> {
  const result = await client.query<PaymentRecord>(
    `SELECT * FROM payments WHERE id = $1 FOR UPDATE NOWAIT`,
    [paymentId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Dual auth recording
// =========================================================================

/**
 * Record first authorisation — sets dual_auth_user_1, advances to pending_second_auth.
 */
export async function recordFirstAuth(
  paymentId: string,
  userId: string,
): Promise<PaymentRecord | null> {
  const result = await query<PaymentRecord>(
    `UPDATE payments
     SET dual_auth_user_1 = $1,
         dual_auth_timestamp_1 = NOW(),
         status = $2,
         updated_at = NOW()
     WHERE id = $3
       AND status = $4
     RETURNING *`,
    [userId, PaymentStatus.PENDING_SECOND_AUTH, paymentId, PaymentStatus.PENDING_FIRST_AUTH],
  );
  return result.rows[0] ?? null;
}

/**
 * Record first authorisation within a transaction.
 */
export async function recordFirstAuthWithClient(
  client: PoolClient,
  paymentId: string,
  userId: string,
): Promise<PaymentRecord | null> {
  const result = await client.query<PaymentRecord>(
    `UPDATE payments
     SET dual_auth_user_1 = $1,
         dual_auth_timestamp_1 = NOW(),
         status = $2,
         updated_at = NOW()
     WHERE id = $3
       AND status = $4
     RETURNING *`,
    [userId, PaymentStatus.PENDING_SECOND_AUTH, paymentId, PaymentStatus.PENDING_FIRST_AUTH],
  );
  return result.rows[0] ?? null;
}

/**
 * Record second authorisation — sets dual_auth_user_2, advances to executing.
 */
export async function recordSecondAuth(
  paymentId: string,
  userId: string,
): Promise<PaymentRecord | null> {
  const result = await query<PaymentRecord>(
    `UPDATE payments
     SET dual_auth_user_2 = $1,
         dual_auth_timestamp_2 = NOW(),
         status = $2,
         updated_at = NOW()
     WHERE id = $3
       AND status = $4
     RETURNING *`,
    [userId, PaymentStatus.EXECUTING, paymentId, PaymentStatus.PENDING_SECOND_AUTH],
  );
  return result.rows[0] ?? null;
}

/**
 * Record second authorisation within a transaction.
 */
export async function recordSecondAuthWithClient(
  client: PoolClient,
  paymentId: string,
  userId: string,
): Promise<PaymentRecord | null> {
  const result = await client.query<PaymentRecord>(
    `UPDATE payments
     SET dual_auth_user_2 = $1,
         dual_auth_timestamp_2 = NOW(),
         status = $2,
         updated_at = NOW()
     WHERE id = $3
       AND status = $4
     RETURNING *`,
    [userId, PaymentStatus.EXECUTING, paymentId, PaymentStatus.PENDING_SECOND_AUTH],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Update payment result
// =========================================================================

/**
 * Update payment after provider execution (non-transactional).
 */
export async function updatePaymentResult(
  paymentId: string,
  providerResult: PaymentProviderResult,
): Promise<void> {
  if (providerResult.success) {
    await query(
      `UPDATE payments
       SET status = $1,
           transaction_reference = $2,
           provider_reference = $3,
           funded_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [
        PaymentStatus.FUNDED,
        providerResult.transactionReference,
        providerResult.providerReference,
        paymentId,
      ],
    );
  } else {
    await query(
      `UPDATE payments
       SET status = $1,
           failure_reason = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [PaymentStatus.FAILED, providerResult.failureReason ?? 'Unknown error', paymentId],
    );
  }
}

/**
 * Update payment after provider execution (within a transaction).
 */
export async function updatePaymentResultWithClient(
  client: PoolClient,
  paymentId: string,
  providerResult: PaymentProviderResult,
): Promise<void> {
  if (providerResult.success) {
    await client.query(
      `UPDATE payments
       SET status = $1,
           transaction_reference = $2,
           provider_reference = $3,
           funded_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [
        PaymentStatus.FUNDED,
        providerResult.transactionReference,
        providerResult.providerReference,
        paymentId,
      ],
    );
  } else {
    await client.query(
      `UPDATE payments
       SET status = $1,
           failure_reason = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [PaymentStatus.FAILED, providerResult.failureReason ?? 'Unknown error', paymentId],
    );
  }
}

/**
 * Record provider references while keeping status as executing (pending bank confirmation).
 */
export async function recordPendingConfirmationWithClient(
  client: PoolClient,
  paymentId: string,
  providerResult: PaymentProviderResult,
): Promise<void> {
  await client.query(
    `UPDATE payments
     SET transaction_reference = $1,
         provider_reference = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [providerResult.transactionReference, providerResult.providerReference, paymentId],
  );
}

// =========================================================================
// Queries
// =========================================================================

/**
 * Retrieve payment by idempotency key — for duplicate detection.
 */
export async function getByIdempotencyKey(key: string): Promise<PaymentRecord | null> {
  const result = await query<PaymentRecord>(`SELECT * FROM payments WHERE idempotency_key = $1`, [
    key,
  ]);
  return result.rows[0] ?? null;
}

/**
 * Retrieve payment by ID.
 */
export async function getPaymentById(paymentId: string): Promise<PaymentRecord | null> {
  const result = await query<PaymentRecord>(`SELECT * FROM payments WHERE id = $1`, [paymentId]);
  return result.rows[0] ?? null;
}

/**
 * Retrieve payment by invoice ID.
 */
export async function getPaymentByInvoiceId(invoiceId: string): Promise<PaymentRecord | null> {
  const result = await query<PaymentRecord>(`SELECT * FROM payments WHERE invoice_id = $1`, [
    invoiceId,
  ]);
  return result.rows[0] ?? null;
}

/**
 * Retrieve payment by transaction reference (for webhook matching).
 */
export async function getPaymentByTransactionRef(ref: string): Promise<PaymentRecord | null> {
  const result = await query<PaymentRecord>(
    `SELECT * FROM payments WHERE transaction_reference = $1`,
    [ref],
  );
  return result.rows[0] ?? null;
}

/**
 * Retrieve payments by status.
 */
export async function getPaymentsByStatus(status: PaymentStatus): Promise<PaymentRecord[]> {
  const result = await query<PaymentRecord>(
    `SELECT * FROM payments WHERE status = $1 ORDER BY created_at ASC`,
    [status],
  );
  return result.rows;
}

/**
 * Retrieve enriched payments for the public pending queue.
 * JOINs invoices/suppliers/buyers/users so the response carries names
 * (not just FK UUIDs) — matches the frontend PaymentRecord shape.
 */
export async function getEnrichedPaymentsByStatuses(
  statuses: PaymentStatus[],
): Promise<EnrichedPaymentRecord[]> {
  const result = await query<EnrichedPaymentRecord>(
    `SELECT
       p.*,
       COALESCE(i.invoice_number, '') AS invoice_number,
       COALESCE(s.company_name, '') AS supplier_name,
       COALESCE(b.company_name, '') AS buyer_name,
       u1.email AS dual_auth_user_1_name,
       u2.email AS dual_auth_user_2_name
     FROM payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     LEFT JOIN suppliers s ON s.id = i.supplier_id
     LEFT JOIN buyers b ON b.id = i.buyer_id
     LEFT JOIN users u1 ON u1.id = p.dual_auth_user_1
     LEFT JOIN users u2 ON u2.id = p.dual_auth_user_2
     WHERE p.status = ANY($1)
     ORDER BY p.created_at ASC`,
    [statuses],
  );
  return result.rows;
}

/**
 * Retrieve a single enriched payment by ID. Returns null if not found.
 */
export async function getEnrichedPaymentById(
  paymentId: string,
): Promise<EnrichedPaymentRecord | null> {
  const result = await query<EnrichedPaymentRecord>(
    `SELECT
       p.*,
       COALESCE(i.invoice_number, '') AS invoice_number,
       COALESCE(s.company_name, '') AS supplier_name,
       COALESCE(b.company_name, '') AS buyer_name,
       u1.email AS dual_auth_user_1_name,
       u2.email AS dual_auth_user_2_name
     FROM payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     LEFT JOIN suppliers s ON s.id = i.supplier_id
     LEFT JOIN buyers b ON b.id = i.buyer_id
     LEFT JOIN users u1 ON u1.id = p.dual_auth_user_1
     LEFT JOIN users u2 ON u2.id = p.dual_auth_user_2
     WHERE p.id = $1`,
    [paymentId],
  );
  return result.rows[0] ?? null;
}

/**
 * Find invoices stuck in 'approved' status with no payment row — surfaces
 * orphans left behind by a worker job that exhausted retries before
 * createPaymentTxn ran. Five-minute grace window suppresses transient
 * in-flight approvals. PII-free: IDs and numerics only.
 */
export async function findOrphanedApprovedInvoices(): Promise<OrphanedApprovedInvoice[]> {
  const result = await query<OrphanedApprovedInvoice>(
    `SELECT
       i.id           AS invoice_id,
       i.supplier_id,
       i.face_value::text AS face_value,
       i.updated_at   AS approved_at,
       EXTRACT(EPOCH FROM (NOW() - i.updated_at)) / 3600 AS age_hours
     FROM invoices i
     LEFT JOIN payments p ON p.invoice_id = i.id
     WHERE i.status = 'approved'
       AND p.id IS NULL
       AND i.updated_at < NOW() - INTERVAL '5 minutes'
     ORDER BY i.updated_at ASC`,
    [],
  );
  return result.rows;
}

/**
 * Get payments within 6 hours of 72-hour SLA breach and not yet funded.
 */
export async function getPaymentsPendingSLA(): Promise<SlaBreachPayment[]> {
  const result = await query<SlaBreachPayment>(
    `SELECT id, invoice_id, amount, status, created_at,
            EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS hours_pending
     FROM payments
     WHERE status NOT IN ($1, $2)
       AND EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 >= 66
       AND EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 < 72
     ORDER BY created_at ASC`,
    [PaymentStatus.FUNDED, PaymentStatus.FAILED],
  );
  return result.rows;
}

// =========================================================================
// Supplier payments query
// =========================================================================

/**
 * Retrieve paginated payments for a given supplier (via invoice join).
 * Ownership enforced by WHERE invoices.supplier_id = $1.
 */
export async function getPaymentsBySupplierId(
  supplierId: string,
  page: number,
  pageSize: number,
): Promise<{ rows: PaymentRecord[]; total: number }> {
  const offset = (page - 1) * pageSize;

  const dataResult = await query<PaymentRecord>(
    `SELECT p.*
     FROM payments p
     JOIN invoices i ON p.invoice_id = i.id
     WHERE i.supplier_id = $1
     ORDER BY p.created_at DESC
     LIMIT $2 OFFSET $3`,
    [supplierId, pageSize, offset],
  );

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM payments p
     JOIN invoices i ON p.invoice_id = i.id
     WHERE i.supplier_id = $1`,
    [supplierId],
  );

  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
  return { rows: dataResult.rows, total };
}

// =========================================================================
// Invoice query for payment initiation
// =========================================================================

/**
 * Fetch invoice with supplier preferred payment method.
 *
 * Includes aml_cleared_at so the payment AML guard can distinguish a
 * still-flagged invoice from one that compliance has already cleared.
 */
export async function getInvoiceForPayment(invoiceId: string): Promise<InvoiceForPayment | null> {
  const result = await query<InvoiceForPayment>(
    `SELECT i.id, i.face_value, i.advance_amount, i.status,
            i.supplier_id, i.buyer_id, i.aml_flagged, i.aml_cleared_at,
            s.preferred_payment_method
     FROM invoices i
     JOIN suppliers s ON s.id = i.supplier_id
     WHERE i.id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Invoice status update (transactional)
// =========================================================================

/**
 * Update invoice status within a transaction.
 */
export async function updateInvoiceStatusWithClient(
  client: PoolClient,
  invoiceId: string,
  newStatus: string,
  expectedStatus: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `UPDATE invoices
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND status = $3
     RETURNING id`,
    [newStatus, invoiceId, expectedStatus],
  );
  return (result.rows[0] as Record<string, unknown>) ?? null;
}

// =========================================================================
// Audit logging
// =========================================================================

/**
 * Insert audit log entry (non-transactional).
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

// =========================================================================
// Webhook idempotency
// =========================================================================

/**
 * Check if a webhook event has already been processed.
 */
export async function checkWebhookIdempotency(provider: string, eventId: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM webhook_events
       WHERE provider = $1 AND event_id = $2
     ) AS exists`,
    [provider, eventId],
  );
  return result.rows[0]?.exists ?? false;
}

/**
 * Record a webhook event for idempotency tracking.
 */
export async function recordWebhookEvent(
  provider: string,
  eventId: string,
  payload: unknown,
): Promise<void> {
  await query(
    `INSERT INTO webhook_events (provider, event_id, payload, status, processed_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (provider, event_id) DO NOTHING`,
    [provider, eventId, JSON.stringify(payload), 'processed'],
  );
}

// =========================================================================
// System settings
// =========================================================================

/**
 * Retrieve a system setting value by key.
 */
export async function getSystemSetting(key: string): Promise<string | null> {
  const result = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = $1`,
    [key],
  );
  return result.rows[0]?.value ?? null;
}

/**
 * Set a system_settings key (UPSERT) within a transaction. Used by the
 * payment kill switch (REQ-PAYMENT-010).
 */
export async function setSystemSettingWithClient(
  client: PoolClient,
  key: string,
  value: string,
): Promise<void> {
  await client.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value],
  );
}

/**
 * Bulk-fail all payments in `executing` status. Returns the IDs transitioned
 * so the caller can write a per-payment audit log. Used by the kill switch
 * on activation (REQ-PAYMENT-010).
 */
export async function failExecutingPaymentsWithClient(
  client: PoolClient,
  reason: string,
): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `UPDATE payments
     SET status = 'failed', failure_reason = $1, updated_at = NOW()
     WHERE status = 'executing'
     RETURNING id`,
    [reason],
  );
  return rows.map((r) => r.id);
}

/**
 * Get the last 2FA verification timestamp for a user.
 */
export async function getLast2faVerifiedAt(userId: string): Promise<Date | null> {
  const result = await query<{ last_2fa_verified_at: Date | null }>(
    `SELECT last_2fa_verified_at FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0]?.last_2fa_verified_at ?? null;
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
