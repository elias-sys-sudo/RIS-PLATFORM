-- Migration 013: Checkers.docx gap closure
-- Adds: eligibility_checks, document_comments, application_assignments tables
-- Adds columns to: suppliers (due diligence flags), approvals (credit_memo, TIER_4)

-- =========================================================================
-- New table: eligibility_checks
-- Pre-qualification gate before full supplier onboarding
-- =========================================================================

CREATE TABLE IF NOT EXISTS eligibility_checks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token      VARCHAR(64) UNIQUE NOT NULL,
  registered_company BOOLEAN NOT NULL,
  authorized_person  BOOLEAN NOT NULL,
  years_in_business  INTEGER NOT NULL CHECK (years_in_business >= 0),
  passed             BOOLEAN NOT NULL,
  ip_address         VARCHAR(45),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eligibility_session ON eligibility_checks(session_token);
CREATE INDEX IF NOT EXISTS idx_eligibility_created  ON eligibility_checks(created_at);

-- =========================================================================
-- New table: document_comments
-- Staff ↔ applicant comments on individual KYC documents
-- =========================================================================

CREATE TABLE IF NOT EXISTS document_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES invoice_documents(id),
  supplier_id  UUID NOT NULL REFERENCES suppliers(id),
  author_id    UUID NOT NULL REFERENCES users(id),
  author_role  VARCHAR(50) NOT NULL,
  comment_text TEXT NOT NULL CHECK (char_length(comment_text) BETWEEN 5 AND 2000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_comments_document ON document_comments(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_comments_supplier ON document_comments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_doc_comments_author   ON document_comments(author_id);

-- Document comments are immutable
CREATE OR REPLACE FUNCTION prevent_document_comment_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'document_comments records are immutable — UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_doc_comments_no_update'
  ) THEN
    CREATE TRIGGER trg_doc_comments_no_update
      BEFORE UPDATE ON document_comments
      FOR EACH ROW EXECUTE FUNCTION prevent_document_comment_modification();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_doc_comments_no_delete'
  ) THEN
    CREATE TRIGGER trg_doc_comments_no_delete
      BEFORE DELETE ON document_comments
      FOR EACH ROW EXECUTE FUNCTION prevent_document_comment_modification();
  END IF;
END $$;

-- =========================================================================
-- New table: application_assignments
-- Worklist: assign supplier KYC or invoice applications to specific staff
-- =========================================================================

CREATE TABLE IF NOT EXISTS application_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  VARCHAR(20) NOT NULL CHECK (entity_type IN ('supplier_kyc', 'invoice')),
  entity_id    UUID NOT NULL,
  assigned_to  UUID NOT NULL REFERENCES users(id),
  assigned_by  UUID NOT NULL REFERENCES users(id),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_unique_active
  ON application_assignments(entity_type, entity_id, assigned_to)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_assignments_assignee
  ON application_assignments(assigned_to)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_assignments_entity      ON application_assignments(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_assignments_assigned_by ON application_assignments(assigned_by);

-- =========================================================================
-- Extend suppliers table: due diligence flags + financing requirement
-- =========================================================================

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS required_financing_amount  BIGINT,
  ADD COLUMN IF NOT EXISTS consent_ursb_check         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_supplier_refs      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_litigation_check   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ursb_verified              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ursb_verified_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ursb_verified_by           UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS litigation_checked         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS litigation_checked_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS litigation_checked_by      UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS litigation_flag            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS eligibility_session_token  VARCHAR(64)
    REFERENCES eligibility_checks(session_token);

CREATE INDEX IF NOT EXISTS idx_suppliers_ursb_verified   ON suppliers(ursb_verified);
CREATE INDEX IF NOT EXISTS idx_suppliers_litigation_flag ON suppliers(litigation_flag);

-- =========================================================================
-- Extend approvals table: credit_memo field + TIER_4 support
-- =========================================================================

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS credit_memo TEXT
    CHECK (credit_memo IS NULL OR char_length(credit_memo) BETWEEN 50 AND 5000);

-- Drop the existing tier CHECK constraint (auto-named by PostgreSQL) and replace with TIER_4 support
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT constraint_name INTO v_constraint_name
  FROM information_schema.check_constraints
  WHERE constraint_schema = current_schema()
    AND constraint_name LIKE 'approvals_tier%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE approvals DROP CONSTRAINT ' || quote_ident(v_constraint_name);
  END IF;
END $$;

ALTER TABLE approvals
  ADD CONSTRAINT approvals_tier_check
    CHECK (tier IN ('AUTO', 'TIER_2', 'TIER_3', 'TIER_4'));

COMMENT ON TABLE eligibility_checks     IS 'Pre-qualification gate results before supplier onboarding (Migration 013)';
COMMENT ON TABLE document_comments      IS 'Staff/applicant comments on individual KYC documents (Migration 013)';
COMMENT ON TABLE application_assignments IS 'Staff worklist assignments for supplier KYC and invoice applications (Migration 013)';
