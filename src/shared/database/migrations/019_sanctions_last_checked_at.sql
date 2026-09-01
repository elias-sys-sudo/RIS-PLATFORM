-- Migration 019: Add sanctions_last_checked_at to suppliers and buyers
--
-- Bank of Uganda requires documented proof of when sanctions screening was
-- last performed. This column tracks the timestamp of the most recent check.

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS sanctions_last_checked_at TIMESTAMPTZ;

ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS sanctions_last_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_suppliers_sanctions_last_checked
  ON suppliers(sanctions_last_checked_at);

CREATE INDEX IF NOT EXISTS idx_buyers_sanctions_last_checked
  ON buyers(sanctions_last_checked_at);
