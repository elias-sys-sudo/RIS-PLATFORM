-- =============================================================================
-- Migration 022: Buyer Onboarding Requests
-- Suppliers can request MMS to onboard a new buyer (Stage 4 of workflow).
-- Credit officers review and action these requests.
-- =============================================================================

-- Request status enum
DO $$ BEGIN
  CREATE TYPE buyer_request_status AS ENUM ('pending', 'in_review', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Buyer onboarding request table
CREATE TABLE IF NOT EXISTS buyer_onboarding_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES users(id),
  company_name VARCHAR(255) NOT NULL,
  registration_number VARCHAR(100),
  contact_name_encrypted TEXT,
  contact_email_encrypted TEXT,
  contact_phone_encrypted TEXT,
  reason TEXT NOT NULL,
  status buyer_request_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id),
  reviewer_comments TEXT,
  linked_buyer_id UUID REFERENCES buyers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buyer_onboarding_requests_supplier_id
  ON buyer_onboarding_requests(supplier_id);
CREATE INDEX IF NOT EXISTS idx_buyer_onboarding_requests_status
  ON buyer_onboarding_requests(status);
CREATE INDEX IF NOT EXISTS idx_buyer_onboarding_requests_reviewed_by
  ON buyer_onboarding_requests(reviewed_by);

-- RLS policy: suppliers see only their own requests
ALTER TABLE buyer_onboarding_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buyer_onboarding_requests_supplier_read ON buyer_onboarding_requests;
CREATE POLICY buyer_onboarding_requests_supplier_read
  ON buyer_onboarding_requests
  FOR SELECT
  USING (
    supplier_id = current_setting('app.current_user_id', true)::uuid
    OR current_setting('app.current_role', true) IN ('credit_officer', 'finance_manager', 'management', 'legal')
  );
