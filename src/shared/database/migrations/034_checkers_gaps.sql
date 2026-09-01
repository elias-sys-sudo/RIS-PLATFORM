-- Migration 034: checkers.docx gap closures
-- Closes gaps G1, G3, G6, G7, G9, G10, G11 from the checkers.docx audit.
-- G4 (hidden status) and G5 (one-invoice-at-a-time) are deferred and are
-- logic-only changes with no schema impact.
-- All additions are idempotent (IF NOT EXISTS) so this migration can be
-- re-run safely.

-- =============================================================================
-- G1: EFRIS / URA e-invoice authenticity verification
-- =============================================================================
-- ura_efris_ref           : reference number returned by URA EFRIS upon e-invoice issuance
-- efris_verified_at       : timestamp when verification against URA succeeded

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ura_efris_ref     VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS efris_verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_ura_efris_ref ON invoices(ura_efris_ref);

-- =============================================================================
-- G3: Ongoing-litigation consent + disclosure
-- =============================================================================
-- consent_litigation_check : supplier consents to litigation register check
-- litigation_disclosure    : free-text disclosure of ongoing litigation (PII — TEXT, not encrypted
--                            because the content is a supplier declaration, not identifying data.
--                            Reviewers cite the text in audit; no inferred PII fields).

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS consent_litigation_check BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS litigation_disclosure    TEXT;

-- =============================================================================
-- G6: Bank details captured per invoice post-approval (not at onboarding)
-- =============================================================================
-- Encrypted columns mirror the suppliers table pattern — service layer encrypts
-- via shared/crypto.ts before INSERT/UPDATE, decrypts after SELECT.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bank_account_number_encrypted TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bank_account_name_encrypted   TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bank_name_encrypted           TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bank_details_captured_at      TIMESTAMPTZ;

-- =============================================================================
-- G7: 3-7 working-day assessment SLA
-- =============================================================================
-- assessment_due_at : set at submission time to submittedAt + 7 working days.
-- Reminder jobs fire at day 3 and day 7 via BullMQ delayed jobs.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS assessment_due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_assessment_due_at ON invoices(assessment_due_at);

-- =============================================================================
-- G9: Funding timeline reminder
-- =============================================================================
-- funding_timeline_days : supplier-declared number of days they need funding for;
--                         reminder notification scheduled at submit + N days.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS funding_timeline_days INTEGER
  CHECK (funding_timeline_days IS NULL OR funding_timeline_days > 0);

-- =============================================================================
-- G10: Review summary required before approval
-- =============================================================================
-- review_summary : credit officer's narrative summary before approve/reject.
-- Required (min 30 chars) at service layer for TIER_2 and TIER_3, optional for AUTO.

ALTER TABLE approvals ADD COLUMN IF NOT EXISTS review_summary TEXT;

-- =============================================================================
-- G11: Application allocation + tracking
-- =============================================================================
-- assigned_to_user_id : credit_officer/finance_manager currently responsible for
-- the application. Nullable — unassigned applications appear in all list views.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id);
ALTER TABLE invoices  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_suppliers_assigned_to_user_id ON suppliers(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_assigned_to_user_id  ON invoices(assigned_to_user_id);
