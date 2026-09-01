-- =============================================================================
-- Migration 002: Add missing description column to invoices table
--                + backfill tenor_days from due_date for existing rows
-- =============================================================================
-- The application code (invoices.repository.ts, verification.repository.ts)
-- references invoices.description in INSERT and SELECT statements,
-- but this column was omitted from the initial schema.
--
-- Additionally, invoices.tenor_days (present in schema but never populated
-- during INSERT) is now backfilled for any existing rows using due_date.
-- =============================================================================

-- 1. Add the missing description column
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. Backfill tenor_days for any existing rows where it is NULL
UPDATE invoices
SET tenor_days = (due_date - created_at::date)
WHERE tenor_days IS NULL;
