-- Migration 005: Add idempotency_key to payments table
-- Enables duplicate payment prevention on network retries and Bull job re-runs.

ALTER TABLE payments
  ADD COLUMN idempotency_key UUID NOT NULL DEFAULT uuid_generate_v4();

CREATE UNIQUE INDEX idx_payments_idempotency_key
  ON payments (idempotency_key);
