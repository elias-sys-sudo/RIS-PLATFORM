-- =============================================================================
-- Migration 042: TOTP backup codes (REQ-AUTH-008)
--
-- Stores SHA-256 hashes of 8-character backup codes generated at 2FA setup.
-- Each code is single-use: verifying a code stamps verified_at = NOW() so the
-- next attempt with the same code is rejected.
--
-- Pattern mirrors password_reset_tokens (migration 010) and
-- email_verification_tokens (migration 040): raw token only ever shown to the
-- user once at generation; only its hash is stored.
--
-- Codes are not encrypted (just hashed) because backup codes are designed to
-- be displayed/printed by the user, then verified by raw value comparison.
-- Encryption would force decryption at verify time, weakening the security
-- model. Hash + lookup is the standard pattern.
--
-- Idempotent: ADD COLUMN / CREATE TABLE / CREATE INDEX all use IF NOT EXISTS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS totp_backup_codes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   VARCHAR(64) NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_totp_backup_codes_user_id
    ON totp_backup_codes (user_id);

-- Partial index for the common verify path: "find unused code for this user".
CREATE INDEX IF NOT EXISTS idx_totp_backup_codes_unused
    ON totp_backup_codes (user_id, code_hash)
    WHERE used_at IS NULL;

COMMENT ON TABLE totp_backup_codes IS
    'Single-use 8-char backup codes for 2FA account recovery. SHA-256 hash '
    'stored; raw value shown to user only at generation time. Falls back to '
    'TOTP-style verification path when totp_code length is 8 chars (not 6).';

COMMENT ON COLUMN totp_backup_codes.code_hash IS
    'SHA-256 hex digest of the raw 8-character code (uppercase alphanumeric).';
