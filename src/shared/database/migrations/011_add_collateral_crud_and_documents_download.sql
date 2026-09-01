-- =============================================================================
-- Migration 011: Add collateral CRUD extensions + document download support
-- Extends collateral table with CRUD fields (soft delete, document refs)
-- Adds webhook_events table for idempotent webhook processing
-- =============================================================================

-- Add deleted_at for soft delete on collateral
ALTER TABLE collateral ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Add currency column to collateral
ALTER TABLE collateral ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'UGX';

-- Create collateral_documents junction table
CREATE TABLE IF NOT EXISTS collateral_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  collateral_id UUID NOT NULL REFERENCES collateral(id),
  document_id UUID NOT NULL REFERENCES invoice_documents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collateral_documents_collateral_id ON collateral_documents (collateral_id);
CREATE INDEX IF NOT EXISTS idx_collateral_documents_document_id ON collateral_documents (document_id);

-- Webhook events table for idempotent webhook processing
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'received',
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_webhook_events_provider_event UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider ON webhook_events (provider);
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events (event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events (created_at);

-- Index for collateral soft delete queries
CREATE INDEX IF NOT EXISTS idx_collateral_deleted_at ON collateral (deleted_at);
