-- =============================================================================
-- Migration 009: Create collection_payments table + add missing collections columns
--
-- 1. Adds missing columns to collections that the repository code expects:
--    buyer_id, face_value, amount_due, escalation_level, demand_notice_sent,
--    sar_flagged, total_collected, last_payment_at, escalation_date
-- 2. Adds new enum values to collection_status for the service layer
-- 3. Creates collection_payments table for granular payment tracking
-- =============================================================================

-- =========================================================================
-- PART 1: Add missing enum values to collection_status
-- The types file expects: reminded, escalated, bad_debt
-- The enum already has: pending, reminder_sent, overdue, partial_payment,
--                       collected, defaulted
-- =========================================================================

ALTER TYPE collection_status ADD VALUE IF NOT EXISTS 'reminded';
ALTER TYPE collection_status ADD VALUE IF NOT EXISTS 'escalated';
ALTER TYPE collection_status ADD VALUE IF NOT EXISTS 'bad_debt';

-- =========================================================================
-- PART 2: Add missing columns to collections table
-- Uses DO blocks to check existence before adding (idempotent)
-- =========================================================================

-- buyer_id: FK to buyers table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collections' AND column_name = 'buyer_id'
  ) THEN
    ALTER TABLE collections ADD COLUMN buyer_id UUID REFERENCES buyers(id);
  END IF;
END $$;

-- face_value: invoice face value (BIGINT — raw UGX integers)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collections' AND column_name = 'face_value'
  ) THEN
    ALTER TABLE collections ADD COLUMN face_value BIGINT DEFAULT 0;
  END IF;
END $$;

-- amount_due: outstanding amount due from buyer (BIGINT — raw UGX integers)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collections' AND column_name = 'amount_due'
  ) THEN
    ALTER TABLE collections ADD COLUMN amount_due BIGINT DEFAULT 0;
  END IF;
END $$;

-- escalation_level: current escalation tier (0=none, 1=reminder, 2=formal, 3=legal)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collections' AND column_name = 'escalation_level'
  ) THEN
    ALTER TABLE collections ADD COLUMN escalation_level INTEGER DEFAULT 0;
  END IF;
END $$;

-- escalation_date: timestamp of last escalation
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collections' AND column_name = 'escalation_date'
  ) THEN
    ALTER TABLE collections ADD COLUMN escalation_date TIMESTAMPTZ;
  END IF;
END $$;

-- demand_notice_sent: whether a demand notice has been sent
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collections' AND column_name = 'demand_notice_sent'
  ) THEN
    ALTER TABLE collections ADD COLUMN demand_notice_sent BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- sar_flagged: whether this collection is flagged for SAR review
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collections' AND column_name = 'sar_flagged'
  ) THEN
    ALTER TABLE collections ADD COLUMN sar_flagged BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- total_collected: running total of payments received (NUMERIC for partial payments)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collections' AND column_name = 'total_collected'
  ) THEN
    ALTER TABLE collections ADD COLUMN total_collected NUMERIC(15,2) DEFAULT 0;
  END IF;
END $$;

-- last_payment_at: timestamp of most recent payment
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collections' AND column_name = 'last_payment_at'
  ) THEN
    ALTER TABLE collections ADD COLUMN last_payment_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add indexes on new columns
CREATE INDEX IF NOT EXISTS idx_collections_buyer_id ON collections(buyer_id);
CREATE INDEX IF NOT EXISTS idx_collections_escalation_level ON collections(escalation_level);
CREATE INDEX IF NOT EXISTS idx_collections_sar_flagged ON collections(sar_flagged) WHERE sar_flagged = true;

-- =========================================================================
-- PART 3: Create collection_payments table
-- Tracks individual payments against a collection record
-- =========================================================================

CREATE TABLE IF NOT EXISTS collection_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id     UUID          NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  amount            NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_method    VARCHAR(50)   NOT NULL CHECK (
    payment_method IN ('mtn_momo', 'airtel_money', 'bank_transfer', 'cash', 'cheque')
  ),
  payment_reference VARCHAR(255),
  paid_by           VARCHAR(255)  NOT NULL,
  paid_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  recorded_by       UUID          NOT NULL REFERENCES users(id),
  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index on collection_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_collection_payments_collection_id
  ON collection_payments(collection_id);

-- Index on payment_reference for duplicate detection
CREATE INDEX IF NOT EXISTS idx_collection_payments_payment_reference
  ON collection_payments(payment_reference) WHERE payment_reference IS NOT NULL;

-- Index on paid_at for date-range queries on dashboards
CREATE INDEX IF NOT EXISTS idx_collection_payments_paid_at
  ON collection_payments(paid_at);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_collection_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_collection_payments_updated_at ON collection_payments;
CREATE TRIGGER trg_collection_payments_updated_at
  BEFORE UPDATE ON collection_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_collection_payments_updated_at();

-- Add comment
COMMENT ON TABLE collection_payments IS 'Individual payment records against collection records for overdue invoices';
COMMENT ON COLUMN collection_payments.amount IS 'Payment amount in UGX (NUMERIC for partial payments)';
COMMENT ON COLUMN collection_payments.payment_method IS 'Payment channel: mtn_momo, airtel_money, bank_transfer, cash, cheque';
COMMENT ON COLUMN collection_payments.paid_by IS 'Name of person or entity who made the payment';
COMMENT ON COLUMN collection_payments.recorded_by IS 'MMS user who recorded this payment in the system';
