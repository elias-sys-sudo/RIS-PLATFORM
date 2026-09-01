-- Migration 038: AML clearance workflow (FIA 2013 traceability)
-- Closes issue #37 — adds the three-column atomic clearance record on
-- invoices.aml_flagged so that the deployed AML gate is no longer one-way.
--
-- Refinement 1 (compliance review): the three columns are atomically coupled
-- by a CHECK constraint — either ALL three are NULL (uncleared) or ALL three
-- are NOT NULL (cleared). This prevents a malformed UPDATE from creating a
-- "cleared at unknown time by unknown officer with no reason" row.
--
-- Refinement 3: re-clearance is rejected at the application layer; this
-- migration adds the storage but the app guards immutability — once
-- aml_cleared_at IS NOT NULL the record is regulatorily immutable.

-- =========================================================================
-- 1. Three clearance columns — atomic group
-- =========================================================================

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS aml_cleared_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aml_cleared_by        UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS aml_clearance_reason  TEXT;

COMMENT ON COLUMN invoices.aml_cleared_at       IS 'Timestamp of compliance officer clearance — AML gate (Migration 038)';
COMMENT ON COLUMN invoices.aml_cleared_by       IS 'Compliance officer user ID — clearance is immutable per FIA 2013 (Migration 038)';
COMMENT ON COLUMN invoices.aml_clearance_reason IS 'Free-text rationale (>=10 chars) — never copied into audit_logs.metadata (Migration 038)';

-- =========================================================================
-- 2. CHECK constraint — atomicity (refinement 1)
-- =========================================================================
-- Postgres < 12 lacks `ADD CONSTRAINT IF NOT EXISTS`; emulate via DO block.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_aml_clearance_complete'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_aml_clearance_complete CHECK (
        (aml_cleared_at IS NULL AND aml_cleared_by IS NULL AND aml_clearance_reason IS NULL)
        OR
        (aml_cleared_at IS NOT NULL AND aml_cleared_by IS NOT NULL AND aml_clearance_reason IS NOT NULL)
      );
  END IF;
END $$;

-- =========================================================================
-- 3. Partial index — compliance queue lookup
-- =========================================================================
-- Compliance officers query "flagged but not yet cleared" frequently; a
-- partial index on this exact predicate keeps the queue endpoint cheap
-- regardless of total invoice volume.

CREATE INDEX IF NOT EXISTS idx_invoices_aml_pending_clearance
  ON invoices (aml_flagged, aml_cleared_at)
  WHERE aml_flagged = true AND aml_cleared_at IS NULL;
