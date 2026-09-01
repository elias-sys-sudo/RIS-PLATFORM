-- Migration 017: Invoice disputes table for buyer dispute routing
-- Idempotent: uses IF NOT EXISTS

-- =========================================================================
-- Invoice disputes table
-- =========================================================================

CREATE TABLE IF NOT EXISTS invoice_disputes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES invoices(id),
  buyer_id      UUID NOT NULL REFERENCES buyers(id),
  dispute_reason TEXT NOT NULL,
  dispute_type  TEXT NOT NULL DEFAULT 'general',
  status        TEXT NOT NULL DEFAULT 'open',
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID REFERENCES users(id),
  resolution_notes TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for looking up disputes by invoice
CREATE INDEX IF NOT EXISTS idx_invoice_disputes_invoice_id
  ON invoice_disputes(invoice_id);

-- Index for listing open disputes
CREATE INDEX IF NOT EXISTS idx_invoice_disputes_status
  ON invoice_disputes(status) WHERE status = 'open';
