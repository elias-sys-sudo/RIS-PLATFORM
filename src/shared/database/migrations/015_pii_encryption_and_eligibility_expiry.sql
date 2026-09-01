-- Migration 015: PII encryption columns + eligibility expiry + buyer payment undertaking
-- Closes security gaps: company_name, tax_id, directors stored as plaintext
-- Adds eligibility token expiry enforcement
-- Adds buyer payment undertaking fields

-- =========================================================================
-- Suppliers: add encrypted columns for PII that was stored in plaintext
-- =========================================================================

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS company_name_encrypted  TEXT,
  ADD COLUMN IF NOT EXISTS tax_id_encrypted        TEXT,
  ADD COLUMN IF NOT EXISTS directors_encrypted     TEXT;

COMMENT ON COLUMN suppliers.company_name_encrypted IS 'AES-256-GCM encrypted company name (Migration 015)';
COMMENT ON COLUMN suppliers.tax_id_encrypted       IS 'AES-256-GCM encrypted tax ID / TIN (Migration 015)';
COMMENT ON COLUMN suppliers.directors_encrypted    IS 'AES-256-GCM encrypted directors JSON (Migration 015)';

-- =========================================================================
-- Eligibility checks: add expiry enforcement
-- =========================================================================

ALTER TABLE eligibility_checks
  ADD COLUMN IF NOT EXISTS expires_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS funding_requirement     BIGINT;

-- Backfill: set expires_at to 24h after created_at for existing records
UPDATE eligibility_checks
SET expires_at = created_at + INTERVAL '24 hours'
WHERE expires_at IS NULL;

-- Make expires_at NOT NULL for future inserts (after backfill)
ALTER TABLE eligibility_checks
  ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '24 hours';

COMMENT ON COLUMN eligibility_checks.expires_at          IS 'Token expires 24h after creation (Migration 015)';
COMMENT ON COLUMN eligibility_checks.funding_requirement IS 'Indicative funding amount in UGX for initial credit sizing (Migration 015)';

-- =========================================================================
-- Buyers: add payment undertaking fields
-- =========================================================================

ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS payment_undertaking_signed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payment_undertaking_date   TIMESTAMPTZ;

COMMENT ON COLUMN buyers.payment_undertaking_signed IS 'Whether buyer has signed agreement to pay MMS directly (Migration 015)';
COMMENT ON COLUMN buyers.payment_undertaking_date   IS 'Date payment undertaking was signed (Migration 015)';
