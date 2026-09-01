-- =============================================================================
-- Migration 031: Fix RLS variable names in pricing_disputes policies
-- =============================================================================
-- The policies in migration 030 reference app.user_id / app.user_role
-- but pool.ts sets app.current_user_id / app.current_user_role.
-- This migration drops the broken policies and recreates them with the
-- correct session variable names.
-- =============================================================================

-- Drop the broken policies
DROP POLICY IF EXISTS pricing_disputes_supplier_read ON pricing_disputes;
DROP POLICY IF EXISTS pricing_disputes_supplier_insert ON pricing_disputes;
DROP POLICY IF EXISTS pricing_disputes_staff_update ON pricing_disputes;

-- Recreate with correct variable names (app.current_user_id / app.current_user_role)
-- Note: the table uses submitted_by (not supplier_id) to identify the owner
CREATE POLICY pricing_disputes_supplier_read ON pricing_disputes
  FOR SELECT
  USING (
    submitted_by = current_setting('app.current_user_id', true)::uuid
    OR current_setting('app.current_user_role', true) IN (
      'credit_officer', 'finance_manager', 'management', 'compliance_officer', 'auditor'
    )
  );

CREATE POLICY pricing_disputes_supplier_insert ON pricing_disputes
  FOR INSERT
  WITH CHECK (
    submitted_by = current_setting('app.current_user_id', true)::uuid
  );

CREATE POLICY pricing_disputes_staff_update ON pricing_disputes
  FOR UPDATE
  USING (
    current_setting('app.current_user_role', true) IN (
      'credit_officer', 'finance_manager', 'management'
    )
  );
