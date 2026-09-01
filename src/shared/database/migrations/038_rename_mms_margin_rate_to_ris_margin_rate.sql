-- 038_rename_mms_margin_rate_to_ris_margin_rate.sql
-- Phase 2 of MMS->RIS rebrand: rename the mms_margin_rate column in
-- risk_scoring_config and buyers to ris_margin_rate. Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'risk_scoring_config'
      AND column_name = 'mms_margin_rate'
  ) THEN
    ALTER TABLE risk_scoring_config RENAME COLUMN mms_margin_rate TO ris_margin_rate;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'buyers'
      AND column_name = 'mms_margin_rate'
  ) THEN
    ALTER TABLE buyers RENAME COLUMN mms_margin_rate TO ris_margin_rate;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'risk_scores'
      AND column_name = 'mms_margin_rate'
  ) THEN
    ALTER TABLE risk_scores RENAME COLUMN mms_margin_rate TO ris_margin_rate;
  END IF;
END $$;

COMMENT ON COLUMN buyers.ris_margin_rate IS
  'Margin rate RIS charges on this buyer''s invoices (formerly mms_margin_rate before rebrand).';

COMMENT ON COLUMN risk_scores.ris_margin_rate IS
  'Snapshotted RIS margin rate at pricing time (formerly mms_margin_rate before rebrand).';
