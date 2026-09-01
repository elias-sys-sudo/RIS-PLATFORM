-- =============================================================================
-- Migration 030: Pricing Dispute Flow
-- =============================================================================
-- Adds a dedicated pricing_disputes table so suppliers can raise a structured
-- concern about a pricing offer (rate too high, advance too low, etc.) before
-- deciding to accept or reject. Keeps the invoice in 'priced' status and
-- eligible for funding while credit team reviews the dispute within 24h SLA.
--
-- Also adds pricing_disputed_at to invoices for fast status lookups.
-- =============================================================================

-- Idempotent: add pricing_disputed_at only if it does not already exist
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'pricing_disputed_at'
  ) THEN
    ALTER TABLE invoices ADD COLUMN pricing_disputed_at TIMESTAMPTZ;
  END IF;
END $$;

-- pricing_disputes table
CREATE TABLE IF NOT EXISTS pricing_disputes (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id                UUID        NOT NULL REFERENCES invoices(id),
  submitted_by              UUID        NOT NULL REFERENCES users(id),
  reason                    TEXT        NOT NULL
                              CHECK (reason IN (
                                'rate_too_high',
                                'advance_too_low',
                                'tenor_mismatch',
                                'calculation_error',
                                'other'
                              )),
  proposed_rate             NUMERIC(8,6),                  -- supplier's counter-rate (annual %)
  proposed_advance_pct      NUMERIC(5,2),                  -- supplier's counter-advance %
  notes                     TEXT,                          -- free-text context
  submitted_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sla_deadline              TIMESTAMPTZ NOT NULL,          -- submitted_at + 24 business hours
  status                    TEXT        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_at               TIMESTAMPTZ,
  resolved_by               UUID        REFERENCES users(id),
  resolution_notes          TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pricing_disputes_invoice_id
  ON pricing_disputes (invoice_id);

CREATE INDEX IF NOT EXISTS idx_pricing_disputes_status_open
  ON pricing_disputes (status)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_pricing_disputes_sla_deadline
  ON pricing_disputes (sla_deadline)
  WHERE status = 'open';

-- RLS: suppliers read their own disputes; staff read all
-- Note: CREATE POLICY IF NOT EXISTS requires PG17+; use DROP/CREATE for portability (PG15 CI)
ALTER TABLE pricing_disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_disputes_supplier_read ON pricing_disputes;
CREATE POLICY pricing_disputes_supplier_read
  ON pricing_disputes FOR SELECT
  USING (
    submitted_by = current_setting('app.user_id', true)::uuid
    OR current_setting('app.user_role', true) IN (
      'credit_officer', 'finance_manager', 'management', 'compliance_officer', 'auditor'
    )
  );

DROP POLICY IF EXISTS pricing_disputes_supplier_insert ON pricing_disputes;
CREATE POLICY pricing_disputes_supplier_insert
  ON pricing_disputes FOR INSERT
  WITH CHECK (submitted_by = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS pricing_disputes_staff_update ON pricing_disputes;
CREATE POLICY pricing_disputes_staff_update
  ON pricing_disputes FOR UPDATE
  USING (
    current_setting('app.user_role', true) IN (
      'credit_officer', 'finance_manager', 'management'
    )
  );
