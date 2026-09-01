-- =============================================================================
-- MMS Platform — Initial Schema Migration
-- 13 tables with constraints, indexes, RLS, and audit_log immutability trigger
-- All monetary values stored as BIGINT (raw UGX — no subunits)
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- ENUM types
-- =============================================================================

CREATE TYPE user_role AS ENUM (
  'supplier',
  'credit_officer',
  'finance_manager',
  'management',
  'compliance_officer',
  'auditor'
);

CREATE TYPE kyc_status AS ENUM (
  'pending',
  'documents_submitted',
  'under_review',
  'approved',
  'rejected'
);

CREATE TYPE invoice_status AS ENUM (
  'draft',
  'submitted',
  'buyer_confirmed',
  'scored',
  'approved',
  'rejected',
  'pending_first_auth',
  'pending_second_auth',
  'executing',
  'funded',
  'collecting',
  'overdue',
  'collected',
  'defaulted',
  'cancelled'
);

CREATE TYPE payment_method AS ENUM (
  'MTN_MOMO',
  'AIRTEL',
  'EFT'
);

CREATE TYPE payment_status AS ENUM (
  'pending_first_auth',
  'pending_second_auth',
  'executing',
  'funded',
  'failed',
  'reversed'
);

CREATE TYPE approval_tier AS ENUM (
  'auto',
  'credit_manager',
  'credit_committee'
);

CREATE TYPE approval_decision AS ENUM (
  'approved',
  'rejected',
  'escalated'
);

CREATE TYPE credit_rating AS ENUM ('A', 'B', 'C', 'D');

CREATE TYPE collateral_type AS ENUM (
  'bank_guarantee',
  'fixed_deposit_lien',
  'post_dated_cheque_full_value',
  'corporate_guarantee',
  'none'
);

CREATE TYPE collection_status AS ENUM (
  'pending',
  'reminder_sent',
  'overdue',
  'partial_payment',
  'collected',
  'defaulted'
);

-- =============================================================================
-- TABLE 1: users
-- =============================================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role user_role NOT NULL,
  first_name_encrypted TEXT,
  last_name_encrypted TEXT,
  phone_encrypted TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  two_factor_secret TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_is_active ON users (is_active);

-- =============================================================================
-- TABLE 2: suppliers
-- =============================================================================
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  company_name VARCHAR(255) NOT NULL,
  registration_number VARCHAR(100) NOT NULL UNIQUE,
  tax_id VARCHAR(100),
  directors JSONB NOT NULL DEFAULT '[]',
  bank_name VARCHAR(255),
  bank_account_number_encrypted TEXT,
  bank_account_name_encrypted TEXT,
  bank_branch VARCHAR(255),
  preferred_payment_method payment_method NOT NULL DEFAULT 'MTN_MOMO',
  mobile_money_number_encrypted TEXT,
  kyc_status kyc_status NOT NULL DEFAULT 'pending',
  sanctions_flag BOOLEAN NOT NULL DEFAULT false,
  risk_tier VARCHAR(20) NOT NULL DEFAULT 'Medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_suppliers_user_id ON suppliers (user_id);
CREATE INDEX idx_suppliers_kyc_status ON suppliers (kyc_status);
CREATE INDEX idx_suppliers_registration_number ON suppliers (registration_number);

-- =============================================================================
-- TABLE 3: buyers
-- =============================================================================
CREATE TABLE buyers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name VARCHAR(255) NOT NULL,
  registration_number VARCHAR(100) NOT NULL UNIQUE,
  credit_rating credit_rating NOT NULL,
  approved_limit BIGINT NOT NULL,
  used_limit BIGINT NOT NULL DEFAULT 0,
  mms_margin_rate NUMERIC(5,4) NOT NULL DEFAULT 0.0300,
  payment_score INTEGER NOT NULL DEFAULT 0,
  contact_email_encrypted TEXT,
  contact_phone_encrypted TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sanctions_flag BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_buyers_approved_limit_positive CHECK (approved_limit > 0),
  CONSTRAINT chk_buyers_used_limit_non_negative CHECK (used_limit >= 0)
);

CREATE INDEX idx_buyers_credit_rating ON buyers (credit_rating);
CREATE INDEX idx_buyers_is_active ON buyers (is_active);
CREATE INDEX idx_buyers_created_by ON buyers (created_by);

-- =============================================================================
-- TABLE 4: invoices
-- =============================================================================
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number VARCHAR(100) NOT NULL,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  buyer_id UUID NOT NULL REFERENCES buyers(id),
  face_value BIGINT NOT NULL,
  advance_amount BIGINT,
  discount_amount BIGINT,
  net_payment_to_supplier BIGINT,
  status invoice_status NOT NULL DEFAULT 'draft',
  tenor_days INTEGER,
  due_date DATE NOT NULL,
  sla_deadline TIMESTAMPTZ,
  buyer_confirmed_at TIMESTAMPTZ,
  buyer_confirmation_ip VARCHAR(45),
  buyer_confirmation_user_agent TEXT,
  confirmation_token_hash VARCHAR(64),
  confirmation_token_expires_at TIMESTAMPTZ,
  aml_flagged BOOLEAN NOT NULL DEFAULT false,
  funded_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_invoice_supplier UNIQUE (invoice_number, supplier_id),
  CONSTRAINT chk_invoices_face_value_positive CHECK (face_value > 0),
  CONSTRAINT chk_invoices_buyer_confirmed CHECK (
    status IN ('draft', 'submitted', 'cancelled', 'rejected')
    OR buyer_confirmed_at IS NOT NULL
  )
);

CREATE INDEX idx_invoices_supplier_id ON invoices (supplier_id);
CREATE INDEX idx_invoices_buyer_id ON invoices (buyer_id);
CREATE INDEX idx_invoices_status ON invoices (status);
CREATE INDEX idx_invoices_due_date ON invoices (due_date);
CREATE INDEX idx_invoices_sla_deadline ON invoices (sla_deadline);
CREATE INDEX idx_invoices_confirmation_token_hash ON invoices (confirmation_token_hash);

-- =============================================================================
-- TABLE 5: invoice_documents
-- =============================================================================
CREATE TABLE invoice_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID REFERENCES invoices(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  document_type VARCHAR(100) NOT NULL,
  encrypted_path TEXT NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_documents_invoice_id ON invoice_documents (invoice_id);
CREATE INDEX idx_invoice_documents_supplier_id ON invoice_documents (supplier_id);
CREATE INDEX idx_invoice_documents_uploaded_by ON invoice_documents (uploaded_by);

-- =============================================================================
-- TABLE 6: risk_scores
-- =============================================================================
CREATE TABLE risk_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL UNIQUE REFERENCES invoices(id),
  buyer_credit_score NUMERIC(6,2) NOT NULL,
  tenor_score NUMERIC(6,2) NOT NULL,
  track_record_score NUMERIC(6,2) NOT NULL,
  concentration_score NUMERIC(6,2) NOT NULL,
  collateral_score NUMERIC(6,2) NOT NULL,
  final_score INTEGER NOT NULL,
  recommendation VARCHAR(50) NOT NULL,
  max_advance_pct NUMERIC(5,4) NOT NULL,
  risk_premium_rate NUMERIC(5,4) NOT NULL,
  bank_cost_rate NUMERIC(5,4),
  mms_margin_rate NUMERIC(5,4),
  total_discount_rate NUMERIC(8,6),
  advance_amount BIGINT,
  discount_amount BIGINT,
  net_payment_to_supplier BIGINT,
  scored_by VARCHAR(50) NOT NULL DEFAULT 'SYSTEM',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_risk_scores_final_range CHECK (final_score >= 0 AND final_score <= 100)
);

CREATE INDEX idx_risk_scores_invoice_id ON risk_scores (invoice_id);

-- =============================================================================
-- TABLE 7: approvals
-- =============================================================================
CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  tier approval_tier NOT NULL,
  approver_id UUID NOT NULL REFERENCES users(id),
  decision approval_decision NOT NULL,
  comments TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_approvals_comments_length CHECK (char_length(comments) >= 1)
);

CREATE INDEX idx_approvals_invoice_id ON approvals (invoice_id);
CREATE INDEX idx_approvals_approver_id ON approvals (approver_id);
CREATE INDEX idx_approvals_decision ON approvals (decision);

-- =============================================================================
-- TABLE 8: payments
-- =============================================================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL UNIQUE REFERENCES invoices(id),
  amount BIGINT NOT NULL,
  provider payment_method NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending_first_auth',
  dual_auth_user_1 UUID REFERENCES users(id),
  dual_auth_timestamp_1 TIMESTAMPTZ,
  dual_auth_user_2 UUID REFERENCES users(id),
  dual_auth_timestamp_2 TIMESTAMPTZ,
  transaction_reference VARCHAR(255),
  provider_reference VARCHAR(255),
  funded_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_payments_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_payments_dual_auth_different CHECK (
    dual_auth_user_1 IS NULL
    OR dual_auth_user_2 IS NULL
    OR dual_auth_user_1 != dual_auth_user_2
  )
);

CREATE INDEX idx_payments_invoice_id ON payments (invoice_id);
CREATE INDEX idx_payments_status ON payments (status);
CREATE INDEX idx_payments_dual_auth_user_1 ON payments (dual_auth_user_1);
CREATE INDEX idx_payments_dual_auth_user_2 ON payments (dual_auth_user_2);

-- =============================================================================
-- TABLE 9: collections
-- =============================================================================
CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  status collection_status NOT NULL DEFAULT 'pending',
  days_overdue INTEGER NOT NULL DEFAULT 0,
  daily_penalty_rate NUMERIC(6,4) NOT NULL DEFAULT 0.0010,
  penalty_amount BIGINT NOT NULL DEFAULT 0,
  amount_received BIGINT,
  received_date TIMESTAMPTZ,
  last_reminder_sent_at TIMESTAMPTZ,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collections_invoice_id ON collections (invoice_id);
CREATE INDEX idx_collections_status ON collections (status);

-- =============================================================================
-- TABLE 10: bank_facilities
-- =============================================================================
CREATE TABLE bank_facilities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  facility_name VARCHAR(255) NOT NULL,
  bank_name VARCHAR(255) NOT NULL,
  total_limit BIGINT NOT NULL,
  drawn_amount BIGINT NOT NULL DEFAULT 0,
  interest_rate_annual NUMERIC(5,4) NOT NULL,
  drawdown_date DATE,
  maturity_date DATE NOT NULL,
  utilisation_alert_threshold INTEGER NOT NULL DEFAULT 80,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_facilities_total_limit_positive CHECK (total_limit > 0),
  CONSTRAINT chk_facilities_drawn_non_negative CHECK (drawn_amount >= 0)
);

CREATE INDEX idx_bank_facilities_is_active ON bank_facilities (is_active);
CREATE INDEX idx_bank_facilities_maturity_date ON bank_facilities (maturity_date);

-- =============================================================================
-- TABLE 11: facility_drawdowns
-- =============================================================================
CREATE TABLE facility_drawdowns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  facility_id UUID NOT NULL REFERENCES bank_facilities(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  principal BIGINT NOT NULL,
  accrued_interest BIGINT NOT NULL DEFAULT 0,
  daily_interest_amount BIGINT NOT NULL DEFAULT 0,
  drawdown_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_repayment_date DATE NOT NULL,
  actual_repayment_date DATE,
  repaid_amount BIGINT,
  is_repaid BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_drawdowns_principal_positive CHECK (principal > 0)
);

CREATE INDEX idx_facility_drawdowns_facility_id ON facility_drawdowns (facility_id);
CREATE INDEX idx_facility_drawdowns_invoice_id ON facility_drawdowns (invoice_id);
CREATE INDEX idx_facility_drawdowns_is_repaid ON facility_drawdowns (is_repaid);

-- =============================================================================
-- TABLE 12: collateral
-- =============================================================================
CREATE TABLE collateral (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  invoice_id UUID REFERENCES invoices(id),
  collateral_type collateral_type NOT NULL DEFAULT 'none',
  value BIGINT NOT NULL DEFAULT 0,
  description TEXT,
  expiry_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collateral_supplier_id ON collateral (supplier_id);
CREATE INDEX idx_collateral_invoice_id ON collateral (invoice_id);
CREATE INDEX idx_collateral_collateral_type ON collateral (collateral_type);

-- =============================================================================
-- TABLE 13: audit_logs (IMMUTABLE — INSERT only)
-- =============================================================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(255) NOT NULL,
  table_name VARCHAR(100),
  record_id VARCHAR(255),
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NOTE: audit_logs has NO updated_at column — records are immutable

CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);
CREATE INDEX idx_audit_logs_table_name ON audit_logs (table_name);
CREATE INDEX idx_audit_logs_record_id ON audit_logs (record_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at);

-- =============================================================================
-- TRIGGER: Prevent UPDATE and DELETE on audit_logs
-- =============================================================================
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs table is immutable — UPDATE and DELETE operations are forbidden';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_modification();

-- =============================================================================
-- TRIGGER: Enforce dual auth on payments before status changes to 'funded'
-- =============================================================================
CREATE OR REPLACE FUNCTION enforce_dual_auth_on_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'funded' THEN
    IF NEW.dual_auth_user_1 IS NULL THEN
      RAISE EXCEPTION 'Payment cannot be funded without first authorisation';
    END IF;
    IF NEW.dual_auth_user_2 IS NULL THEN
      RAISE EXCEPTION 'Payment cannot be funded without second authorisation';
    END IF;
    IF NEW.dual_auth_user_1 = NEW.dual_auth_user_2 THEN
      RAISE EXCEPTION 'Payment requires two different authorising users';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_enforce_dual_auth
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_dual_auth_on_payment();

-- =============================================================================
-- ROW-LEVEL SECURITY: Suppliers can only see their own rows
-- =============================================================================

-- Enable RLS on invoices
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_own_invoices ON invoices
  FOR SELECT
  USING (
    current_setting('app.current_user_role', true) != 'supplier'
    OR supplier_id = (
      SELECT s.id FROM suppliers s
      WHERE s.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- Enable RLS on suppliers
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_own_record ON suppliers
  FOR SELECT
  USING (
    current_setting('app.current_user_role', true) != 'supplier'
    OR user_id = current_setting('app.current_user_id', true)::uuid
  );

-- Enable RLS on payments
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_own_payments ON payments
  FOR SELECT
  USING (
    current_setting('app.current_user_role', true) != 'supplier'
    OR invoice_id IN (
      SELECT i.id FROM invoices i
      JOIN suppliers s ON i.supplier_id = s.id
      WHERE s.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- =============================================================================
-- Updated_at trigger function (reusable)
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all mutable tables
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_buyers_updated_at BEFORE UPDATE ON buyers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_collections_updated_at BEFORE UPDATE ON collections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_bank_facilities_updated_at BEFORE UPDATE ON bank_facilities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_facility_drawdowns_updated_at BEFORE UPDATE ON facility_drawdowns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_collateral_updated_at BEFORE UPDATE ON collateral FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
