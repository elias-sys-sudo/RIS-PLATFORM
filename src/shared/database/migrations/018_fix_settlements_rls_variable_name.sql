-- Migration 018: Fix RLS policy variable name on settlements and profit_bookings
--
-- Migration 016 used current_setting('app.user_role', true) but pool.ts sets
-- 'app.current_user_role'. The mismatch means the variable is never found,
-- current_setting returns '' (because missing_ok=true), and ALL users are
-- silently denied access — breaking settlement functionality.
--
-- This migration drops and recreates the four affected policies with the
-- correct variable name.

-- ── settlements ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS settlements_read_policy ON settlements;
DROP POLICY IF EXISTS settlements_write_policy ON settlements;

CREATE POLICY settlements_read_policy ON settlements
  FOR SELECT
  USING (
    current_setting('app.current_user_role', true) IN ('finance_manager', 'management', 'auditor')
  );

CREATE POLICY settlements_write_policy ON settlements
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) IN ('finance_manager', 'management')
  );

-- ── profit_bookings ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS profit_bookings_read_policy ON profit_bookings;
DROP POLICY IF EXISTS profit_bookings_insert_policy ON profit_bookings;

CREATE POLICY profit_bookings_read_policy ON profit_bookings
  FOR SELECT
  USING (
    current_setting('app.current_user_role', true) IN ('finance_manager', 'management', 'auditor')
  );

CREATE POLICY profit_bookings_insert_policy ON profit_bookings
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_user_role', true) IN ('finance_manager')
  );
