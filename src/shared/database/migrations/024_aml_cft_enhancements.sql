-- 024_aml_cft_enhancements.sql
-- AML/CFT regulatory enhancements: structuring detection, SAR filing, CTR, PEP tracking, velocity

-- Structuring detection tracking
CREATE TABLE IF NOT EXISTS aml_structuring_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  buyer_id UUID NOT NULL,
  rolling_30d_total BIGINT NOT NULL DEFAULT 0,
  invoice_count INT NOT NULL DEFAULT 0,
  flagged BOOLEAN NOT NULL DEFAULT false,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aml_structuring_supplier ON aml_structuring_checks(supplier_id);

-- Suspicious Activity Reports
CREATE TABLE IF NOT EXISTS suspicious_activity_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  collection_id UUID,
  invoice_id UUID,
  reason TEXT NOT NULL,
  report_status VARCHAR(30) NOT NULL DEFAULT 'draft',
  fia_reference VARCHAR(100),
  filed_by UUID REFERENCES users(id),
  filed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sar_entity ON suspicious_activity_reports(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sar_status ON suspicious_activity_reports(report_status);

-- Currency Transaction Reports
CREATE TABLE IF NOT EXISTS cash_transaction_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL,
  payment_id UUID,
  transaction_amount BIGINT NOT NULL,
  report_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  fia_reference VARCHAR(100),
  filed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ctr_status ON cash_transaction_reports(report_status);

-- PEP tracking on suppliers and buyers
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS pep_designation BOOLEAN DEFAULT false;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS pep_checked_at TIMESTAMPTZ;
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS pep_designation BOOLEAN DEFAULT false;
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS pep_checked_at TIMESTAMPTZ;

-- Velocity tracking
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS avg_monthly_volume_6m BIGINT DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_volume_calc_at TIMESTAMPTZ;
