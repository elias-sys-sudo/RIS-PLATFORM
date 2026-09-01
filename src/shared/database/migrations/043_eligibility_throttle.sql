-- =============================================================================
-- Migration 043: Eligibility 30-day re-attempt throttle (REQ-ELIG-006)
--
-- The existing eligibility_checks schema (migration 013) records IP and pass/
-- fail but never captured the applicant's email. The throttle requirement
-- ("re-attempt after 30 days from the same IP/email") needs both keys, so we
-- add the email column + indexes here.
--
-- Existing rows are left with email=NULL (we never had it); the throttle
-- query treats NULL as "no email match", falling back to IP-only matching for
-- legacy rows. Going forward, eligibility checks capture email when supplied.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- =============================================================================

ALTER TABLE eligibility_checks
    ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Lowercase comparison: store/query with LOWER() to make the throttle
-- match case-insensitive. We do not index the lowered form because the
-- application normalises before INSERT and before SELECT.
CREATE INDEX IF NOT EXISTS idx_eligibility_checks_throttle_email
    ON eligibility_checks (email, created_at DESC)
    WHERE passed = false;

CREATE INDEX IF NOT EXISTS idx_eligibility_checks_throttle_ip
    ON eligibility_checks (ip_address, created_at DESC)
    WHERE passed = false;

COMMENT ON COLUMN eligibility_checks.email IS
    'Optional applicant email captured at eligibility check time, used by the '
    '30-day re-attempt throttle (REQ-ELIG-006). Stored lowercased.';
