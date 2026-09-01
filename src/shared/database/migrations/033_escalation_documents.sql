-- Migration 033: Escalation documents table
-- Stores encrypted PDF documents generated during collections escalation lifecycle
-- Document types: demand_letter (T+3), legal_notice (T+7), reminder_letter (T+1)

DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS escalation_documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id     UUID          NOT NULL REFERENCES collections(id),
    document_type     VARCHAR(50)   NOT NULL,
    status            VARCHAR(20)   NOT NULL DEFAULT 'draft',
    content_encrypted TEXT,
    file_hash         VARCHAR(64),
    draft_params      JSONB         NOT NULL DEFAULT '{}',
    mime_type         VARCHAR(100)  NOT NULL DEFAULT 'application/pdf',
    generated_by      UUID          NOT NULL REFERENCES users(id),
    finalized_by      UUID          REFERENCES users(id),
    sent_at           TIMESTAMPTZ,
    sent_to_email     TEXT,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_esc_doc_type CHECK (document_type IN ('demand_letter', 'legal_notice', 'reminder_letter')),
    CONSTRAINT chk_esc_doc_status CHECK (status IN ('draft', 'finalized', 'sent'))
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_escalation_documents_collection_id ON escalation_documents(collection_id);
CREATE INDEX IF NOT EXISTS idx_escalation_documents_status ON escalation_documents(status);

CREATE OR REPLACE FUNCTION update_escalation_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_escalation_documents_updated_at ON escalation_documents;
CREATE TRIGGER trg_escalation_documents_updated_at
  BEFORE UPDATE ON escalation_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_escalation_documents_updated_at();
