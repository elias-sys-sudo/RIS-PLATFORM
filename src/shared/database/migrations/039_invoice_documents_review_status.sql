-- =============================================================================
-- 039_invoice_documents_review_status.sql
-- Per-document review state for KYC documents.
--
-- Before this migration, the per-document status shown to suppliers and
-- reviewers was projected from the supplier-level kyc_status field. That
-- meant once a supplier was approved overall, every newly uploaded
-- document silently appeared "Approved" on the KYC page even though no
-- reviewer had looked at it yet — a real review-trail bug.
--
-- This migration adds a real per-row review state to invoice_documents:
--   review_status        - 'pending' | 'approved' | 'rejected'
--   reviewed_by_user_id  - reviewer's users.id
--   reviewed_at          - when the decision was recorded
--   review_comments      - reviewer's free-text rationale
--
-- Idempotent. New rows default to 'pending'. Existing rows also default
-- to 'pending' since DEFAULT applies to backfill on column add.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_documents'
      AND column_name = 'review_status'
  ) THEN
    ALTER TABLE invoice_documents
      ADD COLUMN review_status         VARCHAR(20)  NOT NULL DEFAULT 'pending',
      ADD COLUMN reviewed_by_user_id   UUID         REFERENCES users(id),
      ADD COLUMN reviewed_at           TIMESTAMPTZ,
      ADD COLUMN review_comments       TEXT;

    -- Constrain values at the DB layer too — Joi/TS isn't enough alone.
    ALTER TABLE invoice_documents
      ADD CONSTRAINT chk_invoice_documents_review_status
        CHECK (review_status IN ('pending', 'approved', 'rejected'));

    -- Index for the reviewer dashboard queries:
    --   "show me all pending documents I haven't reviewed yet"
    CREATE INDEX IF NOT EXISTS idx_invoice_documents_review_status
      ON invoice_documents (review_status)
      WHERE review_status = 'pending';

    -- Index for ownership queries combined with review status filter
    CREATE INDEX IF NOT EXISTS idx_invoice_documents_supplier_review_status
      ON invoice_documents (supplier_id, review_status);

    COMMENT ON COLUMN invoice_documents.review_status IS
      'Per-document KYC review state. Independent of suppliers.kyc_status.';
    COMMENT ON COLUMN invoice_documents.reviewed_by_user_id IS
      'Reviewer (credit_officer / compliance_officer / management) who set review_status.';
    COMMENT ON COLUMN invoice_documents.review_comments IS
      'Reviewer feedback (visible to the supplier on rejection).';
  END IF;
END $$;
