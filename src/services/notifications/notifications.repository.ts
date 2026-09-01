// =============================================================================
// Notifications — Repository
//
// Tiny module that hosts SQL for two operator-visible signals:
//   - audit_logs row when a BullMQ notification job exhausts retries
//   - query for recent terminal failures (drives /admin/email/failed-verifications)
//
// The notifications module is normally worker-only and has no SQL of its own.
// These two functions exist so terminal-failure observability and operator
// triage land in the same parameterised-SQL / WithClient pattern the rest of
// the codebase uses.
// =============================================================================

import type { PoolClient } from 'pg';
import { query } from '../../shared/database/pool';

// -------------------------------------------------------------------------
// Audit
// -------------------------------------------------------------------------

/**
 * Insert an audit log entry within a transaction. Mirrors the pattern in
 * payments.repository.ts so the audit row lands inside the same transaction
 * as any state change the caller is making.
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

// -------------------------------------------------------------------------
// Failed-verification triage
// -------------------------------------------------------------------------

/**
 * One row per unverified user who has at least one
 * EMAIL_VERIFICATION_DELIVERY_FAILED audit row in the lookback window.
 * Joined to users so the operator gets the email address they need to act
 * on (re-verify in SES sandbox, re-send manually, contact support, etc.).
 *
 * Returned shape is camelCase via SQL aliases so the controller does not
 * have to re-map. PII (email) is included by design — this endpoint is
 * restricted to management / finance_manager / compliance_officer roles.
 */
export interface FailedVerificationRow {
  userId: string;
  email: string;
  attempts: number;
  lastErrorCode: string;
  lastFailedAt: string;
  lastJobId: string;
}

export async function findRecentFailedVerifications(
  lookbackHours: number,
): Promise<FailedVerificationRow[]> {
  const result = await query<FailedVerificationRow>(
    `SELECT
       u.id                                         AS "userId",
       u.email                                      AS "email",
       COUNT(*)::int                                AS "attempts",
       (array_agg(a.new_values->>'errorCode' ORDER BY a.created_at DESC))[1] AS "lastErrorCode",
       MAX(a.created_at)::text                      AS "lastFailedAt",
       (array_agg(a.record_id ORDER BY a.created_at DESC))[1]                AS "lastJobId"
     FROM audit_logs a
     JOIN users u ON u.id = (a.new_values->>'recipientUserId')::uuid
     WHERE a.action = 'EMAIL_VERIFICATION_DELIVERY_FAILED'
       AND a.created_at > NOW() - ($1 || ' hours')::interval
       AND u.email_verified = false
       AND u.is_active = true
     GROUP BY u.id, u.email
     ORDER BY MAX(a.created_at) DESC`,
    [String(lookbackHours)],
  );
  return result.rows;
}
