-- =============================================================================
-- Migration 007: Reconcile schema conflicts between 001 and 004/006
--
-- Problem: Migration 001 created approvals, bank_facilities, facility_drawdowns
-- with one set of columns/types. Migrations 004 and 006 used CREATE TABLE IF
-- NOT EXISTS which became no-ops, but the application code expects the 004/006
-- column definitions. This migration alters the 001-created tables to match.
-- =============================================================================

-- =========================================================================
-- PART 1: Fix approvals table
-- Code expects: tier VARCHAR ('AUTO','TIER_2','TIER_3'),
--               decision VARCHAR ('APPROVED','REJECTED','ESCALATED'),
--               approver_id VARCHAR(100)
-- 001 created:  tier approval_tier enum ('auto','credit_manager','credit_committee'),
--               decision approval_decision enum ('approved','rejected','escalated'),
--               approver_id UUID REFERENCES users(id)
-- =========================================================================

-- Drop the FK constraint on approver_id (it references users.id as UUID)
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_approver_id_fkey;

-- Change approver_id from UUID to VARCHAR(100)
ALTER TABLE approvals ALTER COLUMN approver_id TYPE VARCHAR(100) USING approver_id::text;

-- Change tier from approval_tier enum to VARCHAR(10)
ALTER TABLE approvals ALTER COLUMN tier TYPE VARCHAR(10) USING tier::text;
ALTER TABLE approvals ADD CONSTRAINT chk_approvals_tier
  CHECK (tier IN ('AUTO', 'TIER_2', 'TIER_3'));

-- Change decision from approval_decision enum to VARCHAR(10)
ALTER TABLE approvals ALTER COLUMN decision TYPE VARCHAR(10) USING decision::text;
ALTER TABLE approvals ADD CONSTRAINT chk_approvals_decision
  CHECK (decision IN ('APPROVED', 'REJECTED', 'ESCALATED'));

-- Add immutability triggers from 004 (IF NOT EXISTS via OR REPLACE)
CREATE OR REPLACE FUNCTION prevent_approval_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Approval records are immutable — UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if any before recreating
DROP TRIGGER IF EXISTS trg_approvals_no_update ON approvals;
DROP TRIGGER IF EXISTS trg_approvals_no_delete ON approvals;

CREATE TRIGGER trg_approvals_no_update
  BEFORE UPDATE ON approvals
  FOR EACH ROW EXECUTE FUNCTION prevent_approval_modification();

CREATE TRIGGER trg_approvals_no_delete
  BEFORE DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION prevent_approval_modification();

-- Add indexes from 004 that may not exist
CREATE INDEX IF NOT EXISTS idx_approvals_tier_decision ON approvals(tier, decision);
CREATE INDEX IF NOT EXISTS idx_approvals_created_at ON approvals(created_at);

-- =========================================================================
-- PART 2: Fix bank_facilities table
-- Code expects:  available_amount, annual_rate, status VARCHAR
-- 001 created:   facility_name, interest_rate_annual, is_active,
--                utilisation_alert_threshold, drawdown_date
-- =========================================================================

-- Add missing columns that the code expects
ALTER TABLE bank_facilities ADD COLUMN IF NOT EXISTS available_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE bank_facilities ADD COLUMN IF NOT EXISTS annual_rate NUMERIC(8,6);
ALTER TABLE bank_facilities ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

-- Populate annual_rate from existing interest_rate_annual
UPDATE bank_facilities SET annual_rate = interest_rate_annual WHERE annual_rate IS NULL;

-- Make annual_rate NOT NULL after backfill
ALTER TABLE bank_facilities ALTER COLUMN annual_rate SET NOT NULL;

-- Add check constraints matching 006 (use DO block since ADD CONSTRAINT IF NOT EXISTS is not supported)
DO $$ BEGIN
  ALTER TABLE bank_facilities ADD CONSTRAINT chk_facilities_annual_rate
    CHECK (annual_rate > 0 AND annual_rate < 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE bank_facilities ADD CONSTRAINT chk_facilities_status
    CHECK (status IN ('active', 'suspended', 'matured', 'closed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill available_amount = total_limit - drawn_amount
UPDATE bank_facilities SET available_amount = total_limit - drawn_amount;

-- Backfill status from is_active
UPDATE bank_facilities SET status = CASE WHEN is_active = true THEN 'active' ELSE 'suspended' END;

-- Create or replace the available_amount trigger from 006
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

-- Add index from 006
CREATE INDEX IF NOT EXISTS idx_bank_facilities_status ON bank_facilities(status);

-- =========================================================================
-- PART 3: Fix facility_drawdowns table
-- Code expects:  bank_fees, status VARCHAR, last_accrued_date
-- 001 created:   daily_interest_amount, drawdown_date, expected_repayment_date,
--                actual_repayment_date, repaid_amount, is_repaid
-- =========================================================================

ALTER TABLE facility_drawdowns ADD COLUMN IF NOT EXISTS bank_fees BIGINT NOT NULL DEFAULT 0;
ALTER TABLE facility_drawdowns ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE facility_drawdowns ADD COLUMN IF NOT EXISTS last_accrued_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- Add check constraints matching 006
DO $$ BEGIN
  ALTER TABLE facility_drawdowns ADD CONSTRAINT chk_drawdowns_bank_fees
    CHECK (bank_fees >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE facility_drawdowns ADD CONSTRAINT chk_drawdowns_status
    CHECK (status IN ('active', 'repaid', 'overdue'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill status from is_repaid
UPDATE facility_drawdowns SET status = CASE WHEN is_repaid = true THEN 'repaid' ELSE 'active' END;

-- Add index from 006
CREATE INDEX IF NOT EXISTS idx_facility_drawdowns_status ON facility_drawdowns(status);

-- =========================================================================
-- PART 4: Create facility_repayments table (from 006, may not exist)
-- =========================================================================

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

CREATE INDEX IF NOT EXISTS idx_facility_repayments_drawdown_id ON facility_repayments(drawdown_id);
CREATE INDEX IF NOT EXISTS idx_facility_repayments_facility_id ON facility_repayments(facility_id);

-- Add comments
COMMENT ON TABLE facility_repayments IS 'Repayment records for completed facility drawdowns';
