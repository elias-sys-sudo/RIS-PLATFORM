-- =============================================================================
-- Migration 014: user_settings + approval_info_requests
--
-- Gap 4: user_settings stores per-user notification preferences.
--        Replaces the hard-coded defaults in settings.service.ts.
--
-- Gap 6: approval_info_requests persists credit officer requests for
--        additional information on an invoice under review.
--        Replaces the stub in approvals-facade.routes.ts that logged
--        but never wrote to the database or notified the supplier.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- user_settings
-- One row per user. UPSERT on conflict user_id.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_settings (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_notifications   BOOLEAN     NOT NULL DEFAULT true,
  sms_notifications     BOOLEAN     NOT NULL DEFAULT true,
  in_app_notifications  BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT user_settings_user_id_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- approval_info_requests
-- Persists requests from credit officers asking suppliers/buyers to
-- provide additional documents or clarifications before a decision.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS approval_info_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID        NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  requested_by UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message      TEXT        NOT NULL CHECK (char_length(message) >= 10),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_info_requests_invoice_id
  ON approval_info_requests(invoice_id);

CREATE INDEX IF NOT EXISTS idx_approval_info_requests_requested_by
  ON approval_info_requests(requested_by);
