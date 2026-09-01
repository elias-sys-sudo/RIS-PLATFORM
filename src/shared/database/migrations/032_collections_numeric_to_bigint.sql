-- =============================================================================
-- Migration 032: Change monetary NUMERIC columns to BIGINT
-- =============================================================================
-- Architecture rule: all monetary columns must be BIGINT (raw UGX, no subunits).
-- Migration 009 created collections.total_collected and
-- collection_payments.amount as NUMERIC(15,2). This migration corrects them
-- to BIGINT to match the project standard.
--
-- The USING clause truncates any fractional part during conversion.
-- Existing CHECK (amount > 0) on collection_payments.amount is compatible
-- with BIGINT. The DEFAULT 0 on collections.total_collected is also compatible.
-- =============================================================================

ALTER TABLE collections
  ALTER COLUMN total_collected TYPE BIGINT USING total_collected::bigint;

ALTER TABLE collection_payments
  ALTER COLUMN amount TYPE BIGINT USING amount::bigint;
