-- Migration 016: Settlements, profit bookings, collateral enforcement
-- Closes Stage 13 (Settlement & Profit Booking) and hardens Stage 10 (Collateral)

-- =========================================================================
-- Settlement status enum
-- =========================================================================

DO $$ BEGIN
  CREATE TYPE settlement_status AS ENUM (
    'pending',
    'facility_repaid',
    'profit_booked',
    'closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =========================================================================
-- Settlements table — one per invoice, created when collection completes
-- =========================================================================

CREATE TABLE IF NOT EXISTS settlements (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id              UUID NOT NULL UNIQUE REFERENCES invoices(id),
  collection_id           UUID NOT NULL REFERENCES collections(id),
  drawdown_id             UUID REFERENCES facility_drawdowns(id),
  buyer_payment_amount    BIGINT NOT NULL CHECK (buyer_payment_amount > 0),
  facility_repayment_amount BIGINT NOT NULL DEFAULT 0 CHECK (facility_repayment_amount >= 0),
  accrued_interest        BIGINT NOT NULL DEFAULT 0 CHECK (accrued_interest >= 0),
  penalty_income          BIGINT NOT NULL DEFAULT 0 CHECK (penalty_income >= 0),
  net_profit              BIGINT NOT NULL DEFAULT 0,
  status                  settlement_status NOT NULL DEFAULT 'pending',
  settled_by              UUID REFERENCES users(id),
  settled_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlements_invoice_id ON settlements(invoice_id);
CREATE INDEX IF NOT EXISTS idx_settlements_collection_id ON settlements(collection_id);
CREATE INDEX IF NOT EXISTS idx_settlements_drawdown_id ON settlements(drawdown_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);

-- =========================================================================
-- Profit bookings — immutable record of profit calculation
-- =========================================================================

CREATE TABLE IF NOT EXISTS profit_bookings (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  settlement_id     UUID NOT NULL UNIQUE REFERENCES settlements(id),
  discount_earned   BIGINT NOT NULL CHECK (discount_earned >= 0),
  bank_cost_paid    BIGINT NOT NULL CHECK (bank_cost_paid >= 0),
  penalty_income    BIGINT NOT NULL DEFAULT 0 CHECK (penalty_income >= 0),
  net_profit        BIGINT NOT NULL,
  booked_by         UUID NOT NULL REFERENCES users(id),
  booked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profit_bookings_settlement_id ON profit_bookings(settlement_id);

-- Immutability trigger on profit_bookings (prevent UPDATE/DELETE like audit_logs)
CREATE OR REPLACE FUNCTION prevent_profit_booking_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'profit_bookings table is immutable — UPDATE and DELETE are prohibited';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profit_bookings_immutable ON profit_bookings;
CREATE TRIGGER trg_profit_bookings_immutable
  BEFORE UPDATE OR DELETE ON profit_bookings
  FOR EACH ROW EXECUTE FUNCTION prevent_profit_booking_mutation();

-- =========================================================================
-- Collateral enforcement: add new types to enum + coverage flag on invoices
-- =========================================================================

-- Add missing collateral types
DO $$ BEGIN
  ALTER TYPE collateral_type ADD VALUE IF NOT EXISTS 'assignment_of_receivables';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE collateral_type ADD VALUE IF NOT EXISTS 'performance_bond';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Coverage check flag on invoices
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS collateral_coverage_met BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN invoices.collateral_coverage_met
  IS 'True when collateral coverage ratio meets requirements for disbursement (Migration 016)';

-- =========================================================================
-- Pricing acceptance columns on invoices (for Phase H, added now for schema)
-- =========================================================================

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS pricing_accepted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pricing_accepted_by   UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS pricing_rejected_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pricing_rejection_reason TEXT;

-- =========================================================================
-- RLS policies for settlements and profit_bookings
-- =========================================================================

ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE profit_bookings ENABLE ROW LEVEL SECURITY;

-- Finance managers, management, and auditors can access settlements
-- Note: CREATE POLICY IF NOT EXISTS requires PG17+; use DROP/CREATE for portability
DROP POLICY IF EXISTS settlements_read_policy ON settlements;
CREATE POLICY settlements_read_policy ON settlements
  FOR SELECT
  USING (
    current_setting('app.user_role', true) IN ('finance_manager', 'management', 'auditor')
  );

DROP POLICY IF EXISTS settlements_write_policy ON settlements;
CREATE POLICY settlements_write_policy ON settlements
  FOR ALL
  USING (
    current_setting('app.user_role', true) IN ('finance_manager', 'management')
  );

DROP POLICY IF EXISTS profit_bookings_read_policy ON profit_bookings;
CREATE POLICY profit_bookings_read_policy ON profit_bookings
  FOR SELECT
  USING (
    current_setting('app.user_role', true) IN ('finance_manager', 'management', 'auditor')
  );

DROP POLICY IF EXISTS profit_bookings_insert_policy ON profit_bookings;
CREATE POLICY profit_bookings_insert_policy ON profit_bookings
  FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', true) IN ('finance_manager')
  );
