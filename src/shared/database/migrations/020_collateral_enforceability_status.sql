-- Migration 020: Add enforceability_status to collateral
--
-- The workflow requires "enforceability status recorded" for collateral items.
-- Currently only an is_active boolean exists. This adds a proper status field
-- tracking legal enforceability (e.g., perfected, pending, expired, contested).

DO $$ BEGIN
  CREATE TYPE collateral_enforceability_status AS ENUM (
    'pending_perfection',
    'perfected',
    'expired',
    'contested',
    'released'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE collateral
  ADD COLUMN IF NOT EXISTS enforceability_status collateral_enforceability_status
  DEFAULT 'pending_perfection';

CREATE INDEX IF NOT EXISTS idx_collateral_enforceability_status
  ON collateral(enforceability_status);
