-- 023_operational_controls.sql
-- Adds operational controls: payment kill switch, config maker-checker, KYC maker-checker

-- System settings table for platform-wide config like kill switch
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value)
VALUES ('payment_kill_switch', 'false')
ON CONFLICT (key) DO NOTHING;

-- KYC maker-checker columns on suppliers
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS kyc_reviewer_id UUID REFERENCES users(id);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS kyc_approver_id UUID REFERENCES users(id);

-- Pending config changes for maker-checker on risk/system config
CREATE TABLE IF NOT EXISTS pending_config_changes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_key VARCHAR(100) NOT NULL,
  current_value TEXT,
  proposed_value TEXT NOT NULL,
  proposed_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_config_status ON pending_config_changes(status);
