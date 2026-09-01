-- =============================================================================
-- Migration 003: Add missing indexes
--
-- CLAUDE.md rule: "Index every foreign key and every status column"
-- Plus composite indexes to cover actual query patterns in repositories.
-- =============================================================================

-- -------------------------------------------------------------------------
-- 1. Missing single-column status index (rule violation)
-- -------------------------------------------------------------------------

-- collateral.is_active — status column, queried in risk-engine findBestCollateral
CREATE INDEX IF NOT EXISTS idx_collateral_is_active
  ON collateral (is_active);

-- -------------------------------------------------------------------------
-- 2. Composite indexes for invoice listing queries
-- -------------------------------------------------------------------------

-- invoices.repository: findInvoicesBySupplier
--   WHERE supplier_id = $1 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_id_created_at
  ON invoices (supplier_id, created_at DESC);

-- invoices.repository: findAllInvoices (staff view)
--   WHERE status = $1 AND buyer_id = $2 AND created_at BETWEEN ... ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_invoices_status_buyer_id_created_at
  ON invoices (status, buyer_id, created_at DESC);

-- -------------------------------------------------------------------------
-- 3. Composite indexes for verification / reminder queries
-- -------------------------------------------------------------------------

-- verification.repository: findPendingConfirmations + findInvoicesPendingReminder
--   WHERE status = 'submitted' AND buyer_confirmed_at IS NULL ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_invoices_status_confirmed_at_created_at
  ON invoices (status, buyer_confirmed_at, created_at);

-- -------------------------------------------------------------------------
-- 4. Composite indexes for audit_logs queries
-- -------------------------------------------------------------------------

-- invoices.repository: getInvoiceTimeline
--   WHERE record_id = $1 ORDER BY created_at ASC
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id_created_at
  ON audit_logs (record_id, created_at);

-- verification.repository: hasReminderBeenSent
--   WHERE record_id = $1 AND action = $2
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id_action
  ON audit_logs (record_id, action);

-- -------------------------------------------------------------------------
-- 5. Buyer listing sort
-- -------------------------------------------------------------------------

-- onboarding.repository: listBuyers
--   SELECT * FROM buyers ORDER BY created_at DESC LIMIT $1 OFFSET $2
CREATE INDEX IF NOT EXISTS idx_buyers_created_at
  ON buyers (created_at DESC);

-- -------------------------------------------------------------------------
-- 6. Partial index for active collateral lookups
-- -------------------------------------------------------------------------

-- risk-engine.repository: findBestCollateral
--   WHERE (invoice_id = $1 OR (supplier_id = $2 AND invoice_id IS NULL))
--     AND is_active = true
CREATE INDEX IF NOT EXISTS idx_collateral_active_supplier
  ON collateral (supplier_id)
  WHERE is_active = true AND invoice_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_collateral_active_invoice
  ON collateral (invoice_id)
  WHERE is_active = true AND invoice_id IS NOT NULL;
