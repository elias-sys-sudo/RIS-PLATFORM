-- =============================================================================
-- Migration 040: Supplier email verification
--
-- Adds the email_verified column to users (so login can be gated on it) and
-- the email_verification_tokens table that holds the hashed magic-link tokens
-- handed out at supplier registration.
--
-- Staff users (credit_officer, finance_manager, management, compliance_officer,
-- auditor, legal) are seeded with email_verified=true because they are
-- onboarded out-of-band, not through self-registration. The supplier role is
-- the only one that goes through the registration flow, so suppliers are the
-- only users that start with email_verified=false.
--
-- Pattern mirrors password_reset_tokens (migration 010): SHA-256 hash of the
-- raw token stored in DB, raw token only ever sent in the email link. Tokens
-- expire after 24h. verified_at stamps the moment the user clicked the link.
--
-- Idempotent: all ADD COLUMN and CREATE TABLE statements use IF NOT EXISTS.
-- =============================================================================

-- ── users.email_verified ───────────────────────────────────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

-- Existing rows: every row prior to this migration is a staff user
-- (suppliers are the only role that registers through the public flow, and
-- prior to this migration that flow couldn't gate on verification anyway).
-- Mark all existing rows verified so we don't lock anyone out on deploy.
UPDATE users SET email_verified = true WHERE email_verified = false;

-- Index for the login-time gate. Filters out unverified rows during a
-- planner-considered email lookup.
CREATE INDEX IF NOT EXISTS idx_users_email_verified ON users (email_verified);

-- ── email_verification_tokens ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id
    ON email_verification_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires_at
    ON email_verification_tokens (expires_at);

-- Partial index for the common case: "find the unverified token for this hash".
-- WHERE clause keeps the index small by excluding already-consumed tokens.
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_pending
    ON email_verification_tokens (token_hash)
    WHERE verified_at IS NULL;

-- ── Comments ────────────────────────────────────────────────────────────────
COMMENT ON TABLE email_verification_tokens IS
    'One-shot magic links for supplier email verification at registration. '
    'Raw token sent in the email, SHA-256 hash stored here. Token consumed '
    'when user clicks the link (verified_at = NOW()), tied to users.id via '
    'ON DELETE CASCADE so cleaning up a user wipes their pending tokens.';

COMMENT ON COLUMN users.email_verified IS
    'Set to true after supplier completes email verification via magic link. '
    'Staff users are seeded with true (onboarded out-of-band). Login is '
    'rejected with AuthError when this is false.';
