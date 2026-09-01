-- ============================================================================
-- Migration 006: Bank Facilities, Drawdowns & Repayments
-- ============================================================================

-- Step 1: Add missing columns first (in case tables already exist from migration 001)
ALTER TABLE bank_facilities ADD COLUMN IF NOT EXISTS available_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE bank_facilities ADD COLUMN IF NOT EXISTS annual_rate NUMERIC(8,6);
ALTER TABLE bank_facilities ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE facility_drawdowns ADD COLUMN IF NOT EXISTS bank_fees BIGINT NOT NULL DEFAULT 0;
ALTER TABLE facility_drawdowns ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE facility_drawdowns ADD COLUMN IF NOT EXISTS last_accrued_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- Step 2: Create tables (no-op if already exist)
CREATE TABLE IF NOT EXISTS bank_facilities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name        VARCHAR(200)  NOT NULL,
  total_limit      BIGINT        NOT NULL CHECK (total_limit > 0),
  drawn_amount     BIGINT        NOT NULL DEFAULT 0 CHECK (drawn_amount >= 0),
  available_amount BIGINT        NOT NULL DEFAULT 0,
  annual_rate      NUMERIC(8,6)  NOT NULL CHECK (annual_rate > 0 AND annual_rate < 1),
  maturity_date    DATE          NOT NULL,
  status           VARCHAR(20)   NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'suspended', 'matured', 'closed')),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS facility_drawdowns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id       UUID          NOT NULL REFERENCES bank_facilities(id),
  invoice_id        UUID          NOT NULL,
  principal         BIGINT        NOT NULL CHECK (principal > 0),
  accrued_interest  BIGINT        NOT NULL DEFAULT 0 CHECK (accrued_interest >= 0),
  bank_fees         BIGINT        NOT NULL DEFAULT 0 CHECK (bank_fees >= 0),
  status            VARCHAR(20)   NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'repaid', 'overdue')),
  last_accrued_date DATE          NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS facility_repayments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drawdown_id   UUID          NOT NULL REFERENCES facility_drawdowns(id),
  facility_id   UUID          NOT NULL REFERENCES bank_facilities(id),
  principal     BIGINT        NOT NULL CHECK (principal > 0),
  interest      BIGINT        NOT NULL DEFAULT 0 CHECK (interest >= 0),
  bank_fees     BIGINT        NOT NULL DEFAULT 0 CHECK (bank_fees >= 0),
  total_amount  BIGINT        NOT NULL CHECK (total_amount > 0),
  repaid_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Step 3: Indexes
CREATE INDEX IF NOT EXISTS idx_facility_drawdowns_facility_id ON facility_drawdowns(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_drawdowns_invoice_id ON facility_drawdowns(invoice_id);
CREATE INDEX IF NOT EXISTS idx_facility_drawdowns_status ON facility_drawdowns(status);
CREATE INDEX IF NOT EXISTS idx_facility_repayments_drawdown_id ON facility_repayments(drawdown_id);
CREATE INDEX IF NOT EXISTS idx_facility_repayments_facility_id ON facility_repayments(facility_id);
CREATE INDEX IF NOT EXISTS idx_bank_facilities_status ON bank_facilities(status);
CREATE INDEX IF NOT EXISTS idx_bank_facilities_maturity_date ON bank_facilities(maturity_date);

-- Step 4: Trigger (available_amount column now guaranteed to exist)
CREATE OR REPLACE FUNCTION update_available_amount()
RETURNS TRIGGER AS $$
BEGIN
  NEW.available_amount := NEW.total_limit - NEW.drawn_amount;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_available_amount ON bank_facilities;
CREATE TRIGGER trg_update_available_amount
  BEFORE INSERT OR UPDATE ON bank_facilities
  FOR EACH ROW
  EXECUTE FUNCTION update_available_amount();