-- Migration 004: Create approvals table for Module 7 — Approval Workflow Engine
-- Immutable approval records with tier routing and committee quorum tracking

CREATE TABLE IF NOT EXISTS approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES invoices(id),
  tier          VARCHAR(10) NOT NULL CHECK (tier IN ('AUTO', 'TIER_2', 'TIER_3')),
  decision      VARCHAR(10) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'ESCALATED')),
  approver_id   VARCHAR(100) NOT NULL,
  comments      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Approvals are immutable — prevent UPDATE and DELETE
CREATE OR REPLACE FUNCTION prevent_approval_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Approval records are immutable — UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_approvals_no_update
  BEFORE UPDATE ON approvals
  FOR EACH ROW EXECUTE FUNCTION prevent_approval_modification();

CREATE TRIGGER trg_approvals_no_delete
  BEFORE DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION prevent_approval_modification();

-- Index: fast lookup by invoice_id (foreign key)
CREATE INDEX IF NOT EXISTS idx_approvals_invoice_id ON approvals(invoice_id);

-- Index: fast lookup by approver for queue queries
CREATE INDEX IF NOT EXISTS idx_approvals_approver_id ON approvals(approver_id);

-- Index: tier + decision for committee quorum queries
CREATE INDEX IF NOT EXISTS idx_approvals_tier_decision ON approvals(tier, decision);

-- Index: created_at for SLA monitoring queries
CREATE INDEX IF NOT EXISTS idx_approvals_created_at ON approvals(created_at);

COMMENT ON TABLE approvals IS 'Immutable approval decision records for invoice workflow (Module 7)';
