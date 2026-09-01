-- 025_kyc_enhancements.sql
-- KYC regulatory enhancements: beneficial owners, KYC renewal, document expiry

-- Beneficial owners table
CREATE TABLE IF NOT EXISTS beneficial_owners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  full_name_encrypted TEXT NOT NULL,
  nationality VARCHAR(100),
  id_type VARCHAR(50) NOT NULL,
  id_number_encrypted TEXT NOT NULL,
  ownership_percentage NUMERIC(5,2) NOT NULL CHECK (ownership_percentage > 0 AND ownership_percentage <= 100),
  is_pep BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_beneficial_owners_supplier_id ON beneficial_owners(supplier_id);

-- KYC renewal and tiering columns on suppliers
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS kyc_renewal_due_at TIMESTAMPTZ;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS kyc_last_reviewed_at TIMESTAMPTZ;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS kyc_tier VARCHAR(20) DEFAULT 'STANDARD';

-- Document expiry tracking
ALTER TABLE invoice_documents ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE invoice_documents ADD COLUMN IF NOT EXISTS expiry_warning_sent BOOLEAN DEFAULT false;
