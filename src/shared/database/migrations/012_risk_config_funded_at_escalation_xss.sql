-- Migration 012: Risk config table, funded_at immutability, escalation levels, Tier 3 rejection tracking
-- =============================================================================

-- 1. risk_config table — configurable risk weights and thresholds
-- =============================================================================
CREATE TABLE IF NOT EXISTS risk_config (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT         NOT NULL,
  description TEXT         NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by  VARCHAR(100) NOT NULL DEFAULT 'SYSTEM'
);

-- Risk factor weights (must sum to 1.0)
INSERT INTO risk_config (key, value, description) VALUES
  ('weight_buyer_credit',     '0.30', 'Weight for buyer credit rating factor (0-1)'),
  ('weight_tenor',            '0.20', 'Weight for invoice tenor factor (0-1)'),
  ('weight_track_record',     '0.20', 'Weight for supplier track record factor (0-1)'),
  ('weight_concentration',    '0.15', 'Weight for concentration risk factor (0-1)'),
  ('weight_collateral',       '0.15', 'Weight for collateral factor (0-1)'),

  -- Score thresholds for recommendation
  ('threshold_auto_approve',  '75',   'Minimum score for AUTO_APPROVE recommendation'),
  ('threshold_refer_manager', '50',   'Minimum score for REFER_TO_MANAGER recommendation'),

  -- Max advance percentages by score band
  ('advance_pct_high',        '0.95', 'Max advance % for scores >= 75'),
  ('advance_pct_mid',         '0.90', 'Max advance % for scores 60-74'),
  ('advance_pct_low',         '0.85', 'Max advance % for scores 50-59'),

  -- Risk premium rates by score band
  ('premium_score_80_plus',   '0',     'Risk premium for scores >= 80'),
  ('premium_score_70_79',     '0.005', 'Risk premium for scores 70-79'),
  ('premium_score_60_69',     '0.01',  'Risk premium for scores 60-69'),
  ('premium_score_50_59',     '0.015', 'Risk premium for scores 50-59'),

  -- Tier 3 auto-rejection threshold
  ('tier3_auto_reject_threshold', '3', 'Number of rejections before auto-reject at Tier 3')
ON CONFLICT (key) DO NOTHING;

-- 2. funded_at immutability — prevent overwrite once set
-- =============================================================================
CREATE OR REPLACE FUNCTION prevent_funded_at_overwrite()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.funded_at IS NOT NULL AND NEW.funded_at IS DISTINCT FROM OLD.funded_at THEN
    RAISE EXCEPTION 'funded_at is immutable once set — cannot be overwritten';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_funded_at_immutable ON payments;
CREATE TRIGGER trg_payments_funded_at_immutable
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION prevent_funded_at_overwrite();

DROP TRIGGER IF EXISTS trg_invoices_funded_at_immutable ON invoices;
CREATE TRIGGER trg_invoices_funded_at_immutable
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION prevent_funded_at_overwrite();

-- 3. Update invoices to set funded_at when status transitions to funded
-- =============================================================================
CREATE OR REPLACE FUNCTION set_funded_at_on_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'funded' AND OLD.status <> 'funded' AND NEW.funded_at IS NULL THEN
    NEW.funded_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_set_funded_at ON invoices;
CREATE TRIGGER trg_invoices_set_funded_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION set_funded_at_on_status_change();

-- 4. Indexes for escalation queries
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_collections_escalation_level
  ON collections (escalation_level) WHERE status IN ('overdue', 'escalated');

CREATE INDEX IF NOT EXISTS idx_collections_status_days
  ON collections (status, days_overdue) WHERE status IN ('overdue', 'escalated');

CREATE INDEX IF NOT EXISTS idx_risk_config_key
  ON risk_config (key);

-- 5. Tier 3 rejection count tracking — add column to invoices
-- =============================================================================
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tier3_rejection_count INTEGER DEFAULT 0;

-- Down migration
-- =============================================================================
-- DROP TABLE IF EXISTS risk_config;
-- DROP TRIGGER IF EXISTS trg_payments_funded_at_immutable ON payments;
-- DROP TRIGGER IF EXISTS trg_invoices_funded_at_immutable ON invoices;
-- DROP TRIGGER IF EXISTS trg_invoices_set_funded_at ON invoices;
-- DROP FUNCTION IF EXISTS prevent_funded_at_overwrite();
-- DROP FUNCTION IF EXISTS set_funded_at_on_status_change();
-- DROP INDEX IF EXISTS idx_collections_escalation_level;
-- DROP INDEX IF EXISTS idx_collections_status_days;
-- DROP INDEX IF EXISTS idx_risk_config_key;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS tier3_rejection_count;
