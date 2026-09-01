-- =============================================================================
-- Migration 036: Backfill funded → collecting transition (issue #35)
-- =============================================================================
-- Source-of-truth (JOURNEY-MAP-001 Stage 11) requires the funded → collecting
-- transition to be performed by the collections module after disbursement.
-- Pre-fix, payments stopped at status='funded' and the T+1 cron jumped
-- straight to 'overdue' without ever marking 'collecting'. As a result,
-- legacy invoices may exist in 'funded' status whose tenor has already
-- elapsed (should be 'overdue') or is still active (should be 'collecting').
--
-- This migration:
--   1. Reclassifies legacy 'funded' rows past their due_date → 'overdue'
--      and inserts a minimal collections row + audit entry per row, so
--      the existing escalation pipeline picks them up.
--   2. Reclassifies legacy 'funded' rows still within tenor → 'collecting'
--      and inserts a 'pending' collections row + audit entry per row.
--
-- Idempotency:
--   - Each invoice gets at most one collections row inserted (LEFT JOIN guard).
--   - Audit rows are tagged with action='BACKFILL_COLLECTION_STARTED' or
--     'BACKFILL_COLLECTION_OVERDUE' so re-running this migration is a no-op
--     (the LEFT JOIN ensures we never re-insert collections; the inserts
--     are gated on the absence of an existing collections row).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Backfill legacy 'funded' rows past their due_date → 'overdue'
-- ---------------------------------------------------------------------------

-- Insert a minimal overdue collections row for each legacy 'funded' invoice
-- past due_date, where no collections row exists yet.
INSERT INTO collections (
  id, invoice_id, buyer_id, face_value, amount_due,
  days_overdue, daily_penalty_rate, penalty_amount, status
)
SELECT
  gen_random_uuid(),
  i.id,
  i.buyer_id,
  i.face_value,
  i.face_value,
  GREATEST((CURRENT_DATE - i.due_date::date), 1),
  COALESCE((SELECT value::numeric FROM risk_config WHERE key='collections_daily_penalty_rate'), 0.001),
  0,
  'overdue'
FROM invoices i
LEFT JOIN collections c ON c.invoice_id = i.id
WHERE i.status = 'funded'
  AND i.due_date::date < CURRENT_DATE
  AND c.id IS NULL;

-- Insert a backfill audit entry for each invoice we just transitioned to overdue.
INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values)
SELECT
  NULL,
  'BACKFILL_COLLECTION_OVERDUE',
  'collections',
  i.id,
  jsonb_build_object('status', 'funded'),
  jsonb_build_object(
    'status', 'overdue',
    'reason', 'issue_35_backfill',
    'collectionId', c.id::text
  )
FROM invoices i
JOIN collections c ON c.invoice_id = i.id
WHERE i.status = 'funded'
  AND i.due_date::date < CURRENT_DATE
  AND c.status = 'overdue'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs al
    WHERE al.action = 'BACKFILL_COLLECTION_OVERDUE'
      AND al.table_name = 'collections'
      AND al.record_id = i.id::text
  );

-- Now flip the invoices themselves to 'overdue'.
UPDATE invoices
SET status = 'overdue', updated_at = NOW()
WHERE status = 'funded'
  AND due_date::date < CURRENT_DATE;

-- ---------------------------------------------------------------------------
-- 2. Backfill legacy 'funded' rows still within tenor → 'collecting'
-- ---------------------------------------------------------------------------

-- Insert a 'pending' collections row for each legacy 'funded' invoice still
-- within its tenor, where no collections row exists yet.
INSERT INTO collections (
  id, invoice_id, buyer_id, face_value, amount_due,
  days_overdue, daily_penalty_rate, penalty_amount, status
)
SELECT
  gen_random_uuid(),
  i.id,
  i.buyer_id,
  i.face_value,
  i.face_value,
  0,
  COALESCE((SELECT value::numeric FROM risk_config WHERE key='collections_daily_penalty_rate'), 0.001),
  0,
  'pending'
FROM invoices i
LEFT JOIN collections c ON c.invoice_id = i.id
WHERE i.status = 'funded'
  AND i.due_date::date >= CURRENT_DATE
  AND c.id IS NULL;

-- Insert a backfill audit entry for each invoice we just transitioned to collecting.
INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values)
SELECT
  NULL,
  'BACKFILL_COLLECTION_STARTED',
  'collections',
  i.id,
  jsonb_build_object('status', 'funded'),
  jsonb_build_object(
    'status', 'collecting',
    'reason', 'issue_35_backfill',
    'collectionId', c.id::text
  )
FROM invoices i
JOIN collections c ON c.invoice_id = i.id
WHERE i.status = 'funded'
  AND i.due_date::date >= CURRENT_DATE
  AND c.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs al
    WHERE al.action = 'BACKFILL_COLLECTION_STARTED'
      AND al.table_name = 'collections'
      AND al.record_id = i.id::text
  );

-- Flip the invoices themselves to 'collecting'.
UPDATE invoices
SET status = 'collecting', updated_at = NOW()
WHERE status = 'funded'
  AND due_date::date >= CURRENT_DATE;

COMMIT;
