-- Migration 035: Drop NOT NULL on suppliers.company_name
--
-- Migration 015 introduced suppliers.company_name_encrypted as the canonical
-- storage for company names. The onboarding service was updated to write only
-- the encrypted column (see src/services/onboarding/onboarding.repository.ts:42
-- INSERT — populates company_name_encrypted, not company_name).
--
-- The original plaintext column from Migration 001 retained its NOT NULL
-- constraint, so every new supplier registration fails at the DB layer with:
--   null value in column "company_name" of relation "suppliers"
--   violates not-null constraint
--
-- Fix: drop NOT NULL on the stale column. Existing plaintext values are
-- preserved so decryptOrFallback() (onboarding.service.ts:1177) can still read
-- rows written before Migration 015.
--
-- Idempotent: ALTER COLUMN ... DROP NOT NULL is safe to re-apply.

ALTER TABLE suppliers ALTER COLUMN company_name DROP NOT NULL;
