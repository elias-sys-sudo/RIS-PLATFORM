-- 027_consumer_protection.sql
-- Consumer protection features: cooling-off period, dispute SLA, complaints module, max rate cap

-- Invoice cooling-off period columns
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS withdrawal_eligible_until TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS withdrawn_reason TEXT;

-- Dispute resolution SLA columns
ALTER TABLE invoice_disputes ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMPTZ;
ALTER TABLE invoice_disputes ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
ALTER TABLE invoice_disputes ADD COLUMN IF NOT EXISTS escalation_reason TEXT;

-- Complaints table
CREATE TABLE IF NOT EXISTS complaints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  complainant_id UUID NOT NULL REFERENCES users(id),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  assigned_to UUID REFERENCES users(id),
  resolution TEXT,
  amount_involved BIGINT DEFAULT 0,
  escalated BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_complainant ON complaints(complainant_id);

-- Max annual discount rate in system config
INSERT INTO system_settings (key, value) VALUES ('max_annual_discount_rate', '0.15') ON CONFLICT (key) DO NOTHING;
